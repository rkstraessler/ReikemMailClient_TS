import { afterEach } from 'bun:test'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EmailAPIClient, type EmailAPIClientOptions, type SendMailOptions } from '../../src/EmailAPIClient.ts'

export interface CapturedRequest { url: string; headers: IncomingHttpHeaders; body: Buffer }
const servers = new Set<Server>()
const directories = new Set<string>()

afterEach(async () => {
    for (const server of servers) {
        server.closeAllConnections()
        await new Promise<void>(resolve => server.close(() => resolve()))
    }
    servers.clear()
    for (const directory of directories) await rm(directory, { recursive: true, force: true })
    directories.clear()
})

export function jsonResponse(body: unknown = { status: 200, data: { success: true } }, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

export async function localApi(handler: (request: CapturedRequest) => Response | Promise<Response> = () => jsonResponse()) {
    const calls: CapturedRequest[] = []
    const server = createServer(async (request, response) => {
        try {
            const chunks: Buffer[] = []
            for await (const chunk of request) chunks.push(Buffer.from(chunk))
            const captured = { url: request.url!, headers: request.headers, body: Buffer.concat(chunks) }
            calls.push(captured)
            const result = await handler(captured)
            response.writeHead(result.status, Object.fromEntries(result.headers))
            response.end(Buffer.from(await result.arrayBuffer()))
        } catch {
            response.writeHead(500)
            response.end('test handler failed')
        }
    })
    servers.add(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No local port')
    const baseUrl = `http://127.0.0.1:${address.port}`
    const client = (options: Partial<EmailAPIClientOptions> = {}) => new EmailAPIClient({ baseUrl, authKey: 'test-auth', adapterKey: 'test-adapter', ...options })
    return { calls, baseUrl, client, server }
}

export function mail(overrides: Partial<SendMailOptions> = {}): SendMailOptions {
    return { to: [{ email: 'user@example.com' }], subject: 'Subject', html: '<p>Content</p>', ...overrides }
}

export function payload(call: CapturedRequest): any { return JSON.parse(call.body.toString('utf8')) }

export async function multipart(call: CapturedRequest): Promise<FormData> {
    return new Request('http://localhost', { method: 'POST', headers: { 'content-type': call.headers['content-type']! }, body: call.body }).formData()
}

export async function createTemporaryDirectory(): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), 'reikem-v2-'))
    directories.add(directory)
    return directory
}

export async function createTemporaryFile(filename: string, content: string | Buffer): Promise<string> {
    const filePath = path.join(await createTemporaryDirectory(), filename)
    await writeFile(filePath, content)
    return filePath
}
