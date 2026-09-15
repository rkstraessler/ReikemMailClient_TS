import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
    ApiResponse,
    DownloadResponse,
} from '../Types/email-client.types.js'

const REQUEST_TIMEOUT_MS = 30000

export async function postApiRequest(
    url: string,
    formData: FormData,
): Promise<ApiResponse> {
    try {
        const response = await postFormData(url, formData)
        const responseText = await response.text()
        return decodeApiResponse(responseText, response.status)
    } catch (error: unknown) {
        throw createFetchError(error)
    }
}

export async function postDownloadRequest(
    url: string,
    formData: FormData,
    targetPath: string | null = null,
): Promise<DownloadResponse | ApiResponse> {
    try {
        const response = await postFormData(url, formData)
        const arrayBuffer = await response.arrayBuffer()
        const body = Buffer.from(arrayBuffer)
        const contentType = response.headers.get('content-type')

        if (!response.ok) {
            return decodeDownloadErrorResponse(body, response.status)
        }

        const fileName =
            extractDownloadFileName(
                response.headers.get('content-disposition'),
            ) ?? 'download'

        if (targetPath !== null) {
            const outputPath = await resolveDownloadOutputPath(
                targetPath,
                fileName,
            )
            await mkdir(path.dirname(outputPath), { recursive: true })
            await writeFile(outputPath, body)

            return {
                success: true,
                httpCode: response.status,
                fileName,
                contentType,
                bytes: body.length,
                path: outputPath,
            }
        }

        return {
            success: true,
            httpCode: response.status,
            fileName,
            contentType,
            bytes: body.length,
            content: body,
        }
    } catch (error: unknown) {
        throw createFetchError(error)
    }
}

async function postFormData(
    url: string,
    formData: FormData,
): Promise<Response> {
    return fetch(url, {
        method: 'POST',
        body: formData,
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
}

function decodeApiResponse(responseText: string, status: number): ApiResponse {
    let decoded: unknown

    try {
        decoded = JSON.parse(responseText)
    } catch {
        throw new Error('Invalid JSON response')
    }

    if (typeof decoded !== 'object' || decoded === null) {
        throw new Error('Invalid JSON response format')
    }

    const apiResponse = decoded as ApiResponse
    apiResponse.httpCode = status
    return apiResponse
}

function decodeDownloadErrorResponse(
    body: Buffer,
    status: number,
): ApiResponse {
    let decoded: unknown

    try {
        decoded = JSON.parse(body.toString('utf8'))
    } catch {
        throw new Error(
            `Download failed with HTTP ${status}: Invalid JSON response`,
        )
    }

    if (typeof decoded !== 'object' || decoded === null) {
        throw new Error(
            `Download failed with HTTP ${status}: Invalid JSON response format`,
        )
    }

    const apiResponse = decoded as ApiResponse
    apiResponse.httpCode = status
    return apiResponse
}

function extractDownloadFileName(
    contentDisposition: string | null,
): string | null {
    if (contentDisposition === null) {
        return null
    }

    const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition)
    if (utf8Match?.[1]) {
        return path.basename(decodeURIComponent(utf8Match[1].trim()))
    }

    const quotedMatch = /filename="([^"]+)"/i.exec(contentDisposition)
    if (quotedMatch?.[1]) {
        return path.basename(quotedMatch[1].trim())
    }

    const plainMatch = /filename=([^;]+)/i.exec(contentDisposition)
    if (plainMatch?.[1]) {
        return path.basename(plainMatch[1].trim())
    }

    return null
}

async function resolveDownloadOutputPath(
    targetPath: string,
    fileName: string,
): Promise<string> {
    try {
        const targetStats = await stat(targetPath)
        if (targetStats.isDirectory()) {
            return path.join(targetPath, fileName)
        }
    } catch {
        if (
            targetPath.endsWith(path.sep) ||
            targetPath.endsWith('/') ||
            targetPath.endsWith('\\')
        ) {
            return path.join(targetPath, fileName)
        }
    }

    return targetPath
}

function createFetchError(error: unknown): Error {
    if (error instanceof Error) {
        return new Error(`Fetch error: ${error.message}`)
    }

    return new Error('An unknown error occurred during fetch')
}
