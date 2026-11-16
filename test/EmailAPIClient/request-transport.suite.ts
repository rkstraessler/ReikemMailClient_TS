import { describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { createServer as createTcpServer, type Socket } from 'node:net'
import path from 'node:path'
import { EmailAPITransportError, MailStatus, type DownloadResponse } from '../../src/EmailAPIClient.ts'
import { createTemporaryDirectory, createTemporaryFile, jsonResponse, localApi, mail, payload } from './email-api-client-test.helpers.ts'

describe('v2 API responses and transport', () => {
    it('preserves idempotency snapshots, grouped IDs and HTTP 409 as values', async () => {
        const snapshot = {
            success: true, queueIds: [45], messageIds: ['m-45'], smtpMessageIds: ['smtp-45'],
            statuses: [{ queueId: 45, status: 'queued' }], filters: { filtered: 0 }, idempotencyKey: 'avv:1:v1:initial',
        }
        let saved: string | undefined
        const api = await localApi(request => {
            if (request.url === '/api/v2/history') return jsonResponse({ status: 200, data: { history: { Outbound: [{ queueId: 45, status: 'sent' }] } } })
            const serialized = request.body.toString()
            if (saved !== undefined && saved !== serialized) return jsonResponse({ status: 409, data: { success: false, error: 'Dieser Idempotenzschlüssel wurde bereits für einen anderen Inhalt verwendet.', code: 'idempotency_conflict' } }, 409)
            const replayed = saved !== undefined
            saved = serialized
            return jsonResponse({ status: 200, data: { ...snapshot, replayed } })
        })
        const options = mail({ idempotencyKey: snapshot.idempotencyKey, to: [{ email: 'a@example.com' }, { email: 'b@example.com' }] })
        const initial = await api.client().sendMail(options)
        const current = await api.client().getMailHistory({ messageIds: 45 })
        const replay = await api.client().sendMail(options)
        const conflict = await api.client().sendMail({ ...options, html: '<p>Changed</p>' })
        expect(initial.data).toEqual({ ...snapshot, replayed: false })
        expect(replay.data).toEqual({ ...snapshot, replayed: true })
        expect(initial.data.queueIds).toHaveLength(1)
        expect(current.data.history?.Outbound?.[0]?.status).toBe('sent')
        expect(replay.data.statuses?.[0]?.status).toBe('queued')
        expect(conflict.httpCode).toBe(409)
        expect(conflict.data.error).toBe('Dieser Idempotenzschlüssel wurde bereits für einen anderen Inhalt verwendet.')
        expect(conflict.data.code).toBe('idempotency_conflict')
        expect(api.calls).toHaveLength(4)
    })

    it('forwards identical mail under different business keys without a local duplicate filter', async () => {
        const api = await localApi()
        await api.client().sendMail(mail({ idempotencyKey: 'Business:One' }))
        await api.client().sendMail(mail({ idempotencyKey: 'Business:Two' }))
        await api.client().sendMail(mail())
        await api.client().sendMail(mail())
        expect(api.calls).toHaveLength(4)
        expect(api.calls.map(call => payload(call).idempotencyKey)).toEqual(['Business:One', 'Business:Two', undefined, undefined])
    })

    it('preserves numeric source tokens without rewriting JSON strings or property names', async () => {
        const api = await localApi(() => new Response('{"status":200,"data":{"9007199254740993":"literal 9223372036854775807","nested":[9007199254740993,-9007199254740993,1e+30],"escaped":"\\\"9007199254740993\\\"","safe":42}}'))
        const result = await api.client().sendMail(mail())
        expect(result.data['9007199254740993']).toBe('literal 9223372036854775807')
        expect(result.data.nested).toEqual(['9007199254740993', '-9007199254740993', '1e+30'])
        expect(result.data.escaped).toBe('"9007199254740993"')
        expect(result.data.safe).toBe(42)
    })

    it('preserves partial batch results, future statuses and AI retry details', async () => {
        const data = { success: false, queueIds: [1], results: [
            { index: 0, success: true, status: 200, data: { success: true, queueIds: [1], statuses: [{ status: 'future-status', filterDetails: { ai: { retry: { pending: true, attempt: 2, next_attempt_at: '2030-01-01', delay_seconds: 10, http_status: 429, retry_after_seconds: 10 }, result: { reason_code: 'future' } } } }] } },
            { index: 1, success: false, status: 409, data: { success: false, error: 'Dieser Idempotenzschlüssel wurde bereits für einen anderen Inhalt verwendet.', code: 'idempotency_conflict' } },
        ] }
        const api = await localApi(() => jsonResponse({ status: 207, data }, 207))
        const result = await api.client().sendPersonalizedMailBatch({ messages: [mail(), mail()] })
        expect(result.httpCode).toBe(207)
        expect(result.data).toEqual(data)
        expect(MailStatus.isKnown('queued')).toBe(true)
        expect(MailStatus.isKnown('future-status')).toBe(false)
        expect(MailStatus.all()).toHaveLength(8)
    })

    it('uses named history filters with lossless signed-64-bit request/response IDs', async () => {
        const api = await localApi(() => new Response('{"status":200,"httpCode":999,"data":{"history":{"Outbound":[{"queueId":9223372036854775807,"messageId":"123","subject":"S","html":"H","to":[{"email":"a@example.com"}],"cc":[],"bcc":[],"replyTo":[],"idempotencyKey":"k","status":"review","filterDetails":{"ai":{"retry":{"pending":true}}}}]},"queueIds":[9007199254740993],"future":1e400}}'))
        const result = await api.client().getMailHistory({ dateFrom: new Date('2024-02-29T14:30:00Z'), dateTo: '2024-03-01', messageIds: ['9223372036854775807', '000123', 123] })
        expect(api.calls[0]!.url).toBe('/api/v2/history')
        expect(api.calls[0]!.headers.authorization).toBe('Bearer test-auth')
        expect(payload(api.calls[0]!)).toEqual({ dateFrom: '2024-02-29', dateTo: '2024-03-01', messageIds: ['9223372036854775807', '123'] })
        expect(result.httpCode).toBe(200)
        expect(result.data.queueIds).toEqual(['9007199254740993'])
        expect(result.data.history?.Outbound?.[0]?.queueId).toBe('9223372036854775807')
        expect(result.data.history?.Outbound?.[0]?.subject).toBe('S')
        expect(result.data.future).toBe('1e400')
    })

    it('accepts comma-separated IDs without requiring a date', async () => {
        const api = await localApi()
        await api.client().getMailHistory({ messageIds: '123, 00456, 123' })
        expect(payload(api.calls[0]!)).toEqual({ messageIds: ['123', '456'] })
    })

    for (const options of [{}, { dateTo: '2026-01-01' }, { dateFrom: '2025-02-29' }, { dateFrom: '0000-01-01' }, { dateFrom: '2026-02-30' }, { dateFrom: '2026-11-01', dateTo: '2026-01-01' }, { dateFrom: new Date(NaN) }, { messageIds: '123abc' }, { messageIds: ['9223372036854775808'] }, { messageIds: [Number.MAX_SAFE_INTEGER + 1] }, { messageIds: [0] }, { messageIds: [-1] }, { messageIds: ['1e3'] }, { messageIds: '123', dateform: 'typo' }]) {
        it(`rejects invalid history ${JSON.stringify(options)}`, async () => {
            const api = await localApi()
            await expect(api.client().getMailHistory(options as any)).rejects.toThrow()
            expect(api.calls).toHaveLength(0)
        })
    }

    for (const [label, body] of [['invalid JSON', 'PRIVATE_RESPONSE'], ['array', '[]'], ['primitive', '"PRIVATE_RESPONSE"'], ['no data', '{"status":200}'], ['bad status', '{"status":"200","data":{}}'], ['invalid UTF8', Buffer.from([0xff])], ['invalid syntax', '{"status":200,"data":{"x":01}}']] as const) {
        it(`rejects ${label} without exposing response contents`, async () => {
            const api = await localApi(() => new Response(body, { status: 502 }))
            try {
                await api.client().sendMail(mail())
                throw new Error('Expected rejection')
            } catch (error) {
                expect((error as Error).message).toMatch(/Mail API returned (?:invalid JSON|an invalid envelope) \(HTTP 502\)/)
                expect((error as Error).message).not.toContain('PRIVATE_RESPONSE')
            }
            expect(api.calls).toHaveLength(1)
        })
    }

    it('does not follow redirects or retry HTTP failures', async () => {
        const api = await localApi(() => new Response(JSON.stringify({ status: 302, data: { success: false } }), { status: 302, headers: { location: '/redirected' } }))
        expect((await api.client().sendMail(mail())).httpCode).toBe(302)
        expect(api.calls.map(call => call.url)).toEqual(['/api/v2/send'])
    })

    it('does not retry a disconnected response', async () => {
        const api = await localApi()
        api.server.removeAllListeners('request')
        let calls = 0
        api.server.on('request', (req, res) => { calls++; res.writeHead(200); res.write('{'); req.socket.destroy() })
        await expect(api.client().sendMail(mail())).rejects.toBeInstanceOf(EmailAPITransportError)
        expect(calls).toBe(1)
    })

    it('enforces the total timeout throughout response body streaming', async () => {
        const api = await localApi()
        api.server.removeAllListeners('request')
        let calls = 0
        api.server.on('request', (_req, res) => { calls++; res.writeHead(200); res.write('{') })
        const start = Date.now()
        await expect(api.client({ requestTimeout: 1 }).sendMail(mail())).rejects.toBeInstanceOf(EmailAPITransportError)
        expect(Date.now() - start).toBeLessThan(2500)
        expect(calls).toBe(1)
    })

    it('enforces connectTimeout during an incomplete TLS handshake', async () => {
        const sockets = new Set<Socket>()
        const server = createTcpServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
        const port = (server.address() as { port: number }).port
        const api = await localApi()
        try {
            const start = Date.now()
            await expect(api.client({ baseUrl: `https://127.0.0.1:${port}`, connectTimeout: 1, requestTimeout: 4 }).sendMail(mail())).rejects.toBeInstanceOf(EmailAPITransportError)
            expect(Date.now() - start).toBeLessThan(2500)
        } finally {
            for (const socket of sockets) socket.destroy()
            await new Promise<void>(resolve => server.close(() => resolve()))
        }
    })
})

describe('v2 downloads over local HTTP', () => {
    it('downloads binary bytes with named source/fileId and header auth', async () => {
        const bytes = Buffer.from([0, 255, 128, 10, 13, 42])
        const api = await localApi(() => new Response(bytes, { headers: { 'content-type': 'application/octet-stream', 'content-disposition': "attachment; filename*=UTF-8''Gr%C3%BC%C3%9Fe.pdf" } }))
        const result = await api.client().downloadFile({ source: ' OUTBOUND ', fileId: '9223372036854775807' }) as DownloadResponse
        expect(result.content).toEqual(bytes)
        expect(result.fileName).toBe('Grüße.pdf')
        expect(result.bytes).toBe(bytes.length)
        expect(api.calls[0]!.url).toBe('/api/v2/files/download')
        expect(api.calls[0]!.headers.authorization).toBe('Bearer test-auth')
        expect(api.calls[0]!.headers['x-adapter-key']).toBe('test-adapter')
        expect(payload(api.calls[0]!)).toEqual({ source: 'outbound', fileId: '9223372036854775807' })
    })

    it('decodes raw UTF8 header bytes and writes into a directory', async () => {
        const api = await localApi(() => new Response('binary-file', { headers: { 'content-disposition': `attachment; filename="${Buffer.from('Grüße.pdf').toString('latin1')}"` } }))
        const directory = await createTemporaryDirectory()
        const result = await api.client().downloadFile({ source: 'inbound', fileId: 123, targetPath: directory }) as DownloadResponse
        expect(result.fileName).toBe('Grüße.pdf')
        expect(result.path).toBe(path.join(directory, 'Grüße.pdf'))
        expect(await readFile(result.path!, 'utf8')).toBe('binary-file')
    })

    it('creates a missing output directory and supports an exact target filename', async () => {
        const api = await localApi(() => new Response('bytes', { headers: { 'content-disposition': 'attachment; filename="a.txt"' } }))
        const directory = await createTemporaryDirectory()
        const result = await api.client().downloadFile({ source: 'inbound', fileId: 1, targetPath: path.join(directory, 'new') + path.sep }) as DownloadResponse
        expect(await readFile(result.path!, 'utf8')).toBe('bytes')
        const exact = path.join(directory, 'exact.bin')
        await api.client().downloadFile({ source: 'inbound', fileId: 1, targetPath: exact })
        expect(await readFile(exact, 'utf8')).toBe('bytes')
    })

    for (const [header, expected] of [['attachment; filename="..\\..\\safe.pdf"', 'safe.pdf'], ["attachment; filename*=UTF-8''..%2Fsafe.pdf", 'safe.pdf'], ["attachment; filename*=UTF-8''%ZZ", 'download'], ['attachment; filename=".."', 'download'], ["attachment; filename*=UTF-8''C%3Aevil.pdf", 'download'], ['attachment; filename="café.pdf"', 'café.pdf']] as const) {
        it(`handles filename ${header}`, async () => {
            const api = await localApi(() => new Response('file', { headers: { 'content-disposition': header } }))
            const result = await api.client().downloadFile({ source: 'inbound', fileId: 1 }) as DownloadResponse
            expect(result.fileName).toBe(expected)
        })
    }

    it('returns HTTP JSON errors as values without overwriting a target', async () => {
        const targetPath = await createTemporaryFile('keep.pdf', 'keep-me')
        const api = await localApi(() => new Response('{"status":404,"data":{"success":false,"queueIds":[9223372036854775807]}}', { status: 404 }))
        const result = await api.client().downloadFile({ source: 'inbound', fileId: 1, targetPath })
        expect(result).toEqual({ status: 404, httpCode: 404, data: { success: false, queueIds: ['9223372036854775807'] } })
        expect(await readFile(targetPath, 'utf8')).toBe('keep-me')
    })

    for (const contentType of ['application/json', 'application/problem+json; charset=utf-8', 'application/octet-stream']) {
        it(`does not write a 200 error envelope labelled ${contentType}`, async () => {
            const targetPath = await createTemporaryFile('keep.pdf', 'keep-me')
            const api = await localApi(() => new Response('{"status":422,"data":{"success":false}}', { headers: { 'content-type': contentType } }))
            await expect(api.client().downloadFile({ source: 'inbound', fileId: 1, targetPath })).rejects.toThrow('JSON instead of a file')
            expect(await readFile(targetPath, 'utf8')).toBe('keep-me')
        })
    }

    it('does not expose a non-JSON error download body', async () => {
        const api = await localApi(() => new Response('PRIVATE_DOWNLOAD_RESPONSE', { status: 500 }))
        await expect(api.client().downloadFile({ source: 'inbound', fileId: 1 })).rejects.toThrow('Mail API returned invalid JSON (HTTP 500)')
    })

    for (const options of [{ source: 'bad', fileId: 1 }, { source: 'inbound', fileId: '12junk' }, { source: 'inbound', fileId: '9223372036854775808' }, { source: 'inbound', fileId: Number.MAX_SAFE_INTEGER + 1 }, { source: 'inbound', fileId: 1, targetPath: '' }, { source: 'inbound', fileId: 1, config: 'typo' }]) {
        it(`rejects invalid download ${JSON.stringify(options)}`, async () => {
            const api = await localApi()
            await expect(api.client().downloadFile(options as any)).rejects.toThrow()
            expect(api.calls).toHaveLength(0)
        })
    }
})
