import { describe, expect, it, mock, spyOn } from 'bun:test'
import type {
    ApiResponse,
    DownloadResponse,
} from '../../src/EmailAPIClient.ts'
import {
    captureError,
    createClient,
    getRequestFormData,
    installFetchMock,
    jsonResponse,
} from './email-api-client-test.helpers.ts'

describe('EmailAPIClient request transport', () => {
    it('uses a guarded request and sends the documented single-mail fields', async () => {
        const calls = installFetchMock(() =>
            jsonResponse({ status: 200, data: { success: true } }),
        )
        const timeoutSpy = spyOn(AbortSignal, 'timeout')

        try {
            const result = await createClient().sendMail(
                'User@Example.com',
                'Example User',
                'Subject',
                '<p>Content</p>',
            )

            expect(result.httpCode).toBe(200)
            expect(calls).toHaveLength(1)
            expect(calls[0]?.input).toBe(
                'https://mail.example.test/api/send',
            )
            expect(calls[0]?.init?.method).toBe('POST')
            expect(calls[0]?.init?.redirect).toBe('error')
            expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal)
            expect(timeoutSpy).toHaveBeenCalledTimes(1)
            expect(timeoutSpy).toHaveBeenCalledWith(30000)

            const formData = getRequestFormData(calls[0])
            expect(formData.get('config')).toBe('email')
            expect(formData.get('auth_key')).toBe('test-auth-key')
            expect(formData.get('adapter_key')).toBe('test-adapter-key')
            expect(formData.get('recipients[user@example.com]')).toBe(
                'Example User',
            )
            expect(formData.get('regard')).toBe('Subject')
            expect(formData.get('content')).toBe('<p>Content</p>')
        } finally {
            timeoutSpy.mockRestore()
        }
    })

    it('keeps HTTP error responses as resolved API envelopes', async () => {
        installFetchMock(() =>
            jsonResponse(
                {
                    status: 422,
                    data: { success: false, reason: 'invalid-request' },
                },
                422,
            ),
        )

        const result = await createClient().sendMail(
            'user@example.com',
            null,
            'Subject',
            'Content',
        )

        expect(result).toEqual({
            status: 422,
            data: { success: false, reason: 'invalid-request' },
            httpCode: 422,
        })
    })

    it('does not expose an invalid JSON response body in an error', async () => {
        const responseBody = 'PRIVATE_BACKEND_RESPONSE_BODY'
        installFetchMock(() => new Response(responseBody, { status: 502 }))

        const error = await captureError(
            createClient().sendMail(
                'user@example.com',
                null,
                'Subject',
                'Content',
            ),
        )

        expect(error.message).toBe('Fetch error: Invalid JSON response')
        expect(error.message).not.toContain(responseBody)
    })

    it('does not expose a non-object JSON response body in an error', async () => {
        const responseBody = 'PRIVATE_JSON_STRING'
        installFetchMock(() => jsonResponse(responseBody))

        const error = await captureError(
            createClient().sendMail(
                'user@example.com',
                null,
                'Subject',
                'Content',
            ),
        )

        expect(error.message).toBe(
            'Fetch error: Invalid JSON response format',
        )
        expect(error.message).not.toContain(responseBody)
    })

    it('wraps a network failure without changing the public error prefix', async () => {
        globalThis.fetch = mock(async () => {
            throw new Error('connection closed')
        }) as unknown as typeof fetch

        await expect(
            createClient().sendMail(
                'user@example.com',
                null,
                'Subject',
                'Content',
            ),
        ).rejects.toThrow('Fetch error: connection closed')
    })

    it('uses the same redirect and timeout guards for downloads', async () => {
        const calls = installFetchMock(
            () =>
                new Response('file-content', {
                    status: 200,
                    headers: {
                        'content-type': 'text/plain',
                        'content-disposition':
                            'attachment; filename="example.txt"',
                    },
                }),
        )
        const timeoutSpy = spyOn(AbortSignal, 'timeout')

        try {
            const result = (await createClient().downloadFile(
                'outbound',
                123,
            )) as DownloadResponse

            expect(result.success).toBe(true)
            expect(result.httpCode).toBe(200)
            expect(result.fileName).toBe('example.txt')
            expect(result.contentType).toBe('text/plain')
            expect(result.bytes).toBe(12)
            expect(result.content?.toString('utf8')).toBe('file-content')
            expect(calls[0]?.init?.redirect).toBe('error')
            expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal)
            expect(timeoutSpy).toHaveBeenCalledTimes(1)
            expect(timeoutSpy).toHaveBeenCalledWith(30000)

            const formData = getRequestFormData(calls[0])
            expect(formData.get('config')).toBe('filedownload')
            expect(formData.get('source')).toBe('outbound')
            expect(formData.get('fileId')).toBe('123')
        } finally {
            timeoutSpy.mockRestore()
        }
    })

    it('keeps download HTTP error responses as resolved API envelopes', async () => {
        installFetchMock(() =>
            jsonResponse(
                { status: 404, data: { success: false } },
                404,
            ),
        )

        const result = (await createClient().downloadFile(
            'inbound',
            456,
        )) as ApiResponse

        expect(result).toEqual({
            status: 404,
            data: { success: false },
            httpCode: 404,
        })
    })

    it('does not expose a non-JSON download error body', async () => {
        const responseBody = 'PRIVATE_DOWNLOAD_RESPONSE_BODY'
        installFetchMock(() => new Response(responseBody, { status: 500 }))

        const error = await captureError(
            createClient().downloadFile('inbound', 456),
        )

        expect(error.message).toBe(
            'Fetch error: Download failed with HTTP 500: Invalid JSON response',
        )
        expect(error.message).not.toContain(responseBody)
    })
})
