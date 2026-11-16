import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ApiResponse, DownloadResponse, EmailAPIClientOptions } from '../Types/email-client.types.js'
import type { RequestBody } from '../Helpers/mailFormData.js'
import { validText } from '../Helpers/validation.js'

export class EmailAPITransportError extends Error {
    override readonly name = 'EmailAPITransportError'
}

export interface TransportOptions extends Required<Pick<EmailAPIClientOptions, 'connectTimeout' | 'requestTimeout' | 'authKey' | 'adapterKey'>> {}
interface HttpResult { body: Buffer; httpCode: number; headers: IncomingHttpHeaders }

export function request(url: string, payload: RequestBody, options: TransportOptions): Promise<HttpResult> {
    return new Promise((resolve, reject) => {
        const target = new URL(url)
        let response: IncomingMessage | undefined
        const req = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
            method: 'POST', agent: false,
            headers: {
                Authorization: `Bearer ${options.authKey}`,
                'X-Adapter-Key': options.adapterKey,
                'Content-Type': payload.contentType,
                'Content-Length': payload.body.length,
            },
        })
        let settled = false
        const cleanup = () => { clearTimeout(connectTimer); clearTimeout(totalTimer) }
        const failure = () => {
            if (settled) return
            settled = true
            cleanup()
            response?.destroy()
            req.destroy()
            reject(new EmailAPITransportError('Mail API transport failed or timed out'))
        }
        const connectTimer = setTimeout(failure, options.connectTimeout * 1000)
        const totalTimer = setTimeout(failure, options.requestTimeout * 1000)
        req.once('socket', socket => {
            socket.once(target.protocol === 'https:' ? 'secureConnect' : 'connect', () => clearTimeout(connectTimer))
        })
        req.once('error', failure)
        req.once('response', incoming => {
            response = incoming
            const chunks: Buffer[] = []
            incoming.on('data', chunk => chunks.push(Buffer.from(chunk)))
            incoming.once('error', failure)
            incoming.once('aborted', failure)
            incoming.once('end', () => {
                if (settled) return
                settled = true
                cleanup()
                resolve({ body: Buffer.concat(chunks), httpCode: incoming.statusCode ?? 0, headers: incoming.headers })
            })
        })
        req.end(payload.body)
    })
}

export function decodeApiResponse<T>(body: Buffer, httpCode: number): ApiResponse<T> {
    let decoded: unknown
    try {
        const json = new TextDecoder('utf-8', { fatal: true }).decode(body)
        decoded = JSON.parse(json, (_key, value: unknown, context?: { source?: string }) => {
            if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) {
                // The parser validates syntax; the source token preserves integers without rounding.
                if (context?.source === undefined) throw new Error('JSON source context is required')
                return context.source
            }
            return value
        })
    } catch { throw new Error(`Mail API returned invalid JSON (HTTP ${httpCode})`) }
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)
        || !Number.isSafeInteger((decoded as ApiResponse).status)
        || typeof (decoded as ApiResponse).data !== 'object' || (decoded as ApiResponse).data === null) {
        throw new Error(`Mail API returned an invalid envelope (HTTP ${httpCode})`)
    }
    return { ...decoded, httpCode } as ApiResponse<T>
}

export async function postApiRequest<T>(url: string, payload: RequestBody, options: TransportOptions): Promise<ApiResponse<T>> {
    const result = await request(url, payload, options)
    return decodeApiResponse<T>(result.body, result.httpCode)
}

export async function postDownloadRequest(url: string, payload: RequestBody, options: TransportOptions, targetPath: string | null): Promise<DownloadResponse | ApiResponse> {
    const { body, httpCode, headers } = await request(url, payload, options)
    if (httpCode < 200 || httpCode >= 300) return decodeApiResponse(body, httpCode)
    const contentType = headers['content-type'] ?? null
    if (contentType && /(?:application\/json|\+json)(?:;|$)/i.test(contentType)) throw new Error('Mail API returned JSON instead of a file')
    const text = body.toString('utf8').trimStart()
    if (/^[{\[]/.test(text)) {
        let parsed: unknown
        try { parsed = JSON.parse(text) } catch { /* Non-JSON file content is allowed. */ }
        if (typeof parsed === 'object' && parsed !== null && Number.isSafeInteger((parsed as ApiResponse).status)
            && typeof (parsed as ApiResponse).data === 'object' && (parsed as ApiResponse).data !== null) {
            throw new Error('Mail API returned JSON instead of a file')
        }
    }
    const fileName = extractDownloadFileName(headers['content-disposition'] ?? null) ?? 'download'
    const result: DownloadResponse = { success: true, httpCode, fileName, contentType, bytes: body.length }
    if (targetPath === null) return { ...result, content: body }
    let outputPath = targetPath
    try {
        if ((await stat(outputPath)).isDirectory()) outputPath = path.join(outputPath, fileName)
    } catch {
        if (/[\\/]$/.test(outputPath)) outputPath = path.join(outputPath, fileName)
    }
    try {
        await mkdir(path.dirname(outputPath), { recursive: true })
        await writeFile(outputPath, body)
    } catch { throw new Error('Cannot save the downloaded file completely') }
    return { ...result, path: outputPath }
}

function extractDownloadFileName(disposition: string | null): string | null {
    if (disposition === null) return null
    let filename: string | undefined
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1]
    if (encoded !== undefined) {
        try { filename = decodeURIComponent(encoded.trim()) } catch { return null }
    } else {
        filename = /filename="([^"]+)"/i.exec(disposition)?.[1] ?? /filename=([^;]+)/i.exec(disposition)?.[1]
        if (filename !== undefined) {
            try { filename = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(filename, 'latin1')) }
            catch { /* Retain legacy Latin1 if not valid UTF-8. */ }
        }
    }
    if (filename === undefined || !validText(filename) || /[\p{Cc}:]/u.test(filename)) return null
    filename = filename.trim().replace(/\\/g, '/').split('/').pop()
    return filename && !['.', '..'].includes(filename) ? filename : null
}
