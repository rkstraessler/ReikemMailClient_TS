import { afterEach, mock } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EmailAPIClient } from '../../src/EmailAPIClient.ts'
import type { FetchCall } from './email-api-client-test.types.ts'

const originalFetch = globalThis.fetch
const temporaryDirectories = new Set<string>()

afterEach(async () => {
    globalThis.fetch = originalFetch

    await Promise.all(
        [...temporaryDirectories].map((directory) =>
            rm(directory, { recursive: true, force: true }),
        ),
    )
    temporaryDirectories.clear()
})

export function createClient(): EmailAPIClient {
    return new EmailAPIClient(
        'https://mail.example.test/api/send/',
        'test-auth-key',
        'test-adapter-key',
    )
}

export function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'content-type': 'application/json',
        },
    })
}

export function installFetchMock(
    responseFactory: () => Response,
): FetchCall[] {
    const calls: FetchCall[] = []
    const fetchMock = mock(
        async (
            input: Parameters<typeof fetch>[0],
            init?: RequestInit,
        ): Promise<Response> => {
            calls.push({ input, init })
            return responseFactory()
        },
    )

    globalThis.fetch = fetchMock as unknown as typeof fetch
    return calls
}

export function getRequestFormData(call: FetchCall | undefined): FormData {
    const body = call?.init?.body
    if (!(body instanceof FormData)) {
        throw new Error('Expected request body to be FormData')
    }

    return body
}

export async function createTemporaryDirectory(
    prefix: string,
): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), prefix))
    temporaryDirectories.add(directory)

    return directory
}

export async function createTemporaryFile(
    filename: string,
    content: string,
): Promise<string> {
    const directory = await createTemporaryDirectory(
        'reikem-mail-client-test-',
    )
    const filePath = path.join(directory, filename)
    await writeFile(filePath, content)

    return filePath
}

export async function captureError(promise: Promise<unknown>): Promise<Error> {
    try {
        await promise
    } catch (error) {
        if (error instanceof Error) {
            return error
        }

        throw new Error('Expected an Error instance')
    }

    throw new Error('Expected promise to reject')
}
