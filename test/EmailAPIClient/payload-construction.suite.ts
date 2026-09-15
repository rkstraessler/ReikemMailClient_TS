import { describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
    EmailAttachment,
    type DownloadResponse,
} from '../../src/EmailAPIClient.ts'
import {
    createClient,
    createTemporaryDirectory,
    createTemporaryFile,
    getRequestFormData,
    installFetchMock,
    jsonResponse,
} from './email-api-client-test.helpers.ts'

describe('EmailAPIClient payload construction', () => {
    it('normalizes recipient maps and appends a delay timestamp', async () => {
        const calls = installFetchMock(() => jsonResponse({ status: 200 }))

        await createClient().sendMailList(
            {
                ' Alice@Example.com ': ' Alice ',
                'bob@example.com': '',
            },
            'Subject',
            'Content',
            [],
            1700000000,
        )

        const formData = getRequestFormData(calls[0])
        expect(formData.get('recipients[alice@example.com]')).toBe('Alice')
        expect(formData.get('recipients[bob@example.com]')).toBe('')
        expect(formData.get('delay_until')).toBe('1700000000')
    })

    it('serializes personalized messages using both supported alias styles', async () => {
        const calls = installFetchMock(() => jsonResponse({ status: 200 }))

        await createClient().sendPersonalizedMailBatch([
            {
                email: ' Alice@Example.com ',
                name: ' Alice ',
                subject: 'First subject',
                html: '<p>First</p>',
            },
            {
                recipient: 'bob@example.com',
                recipient_name: null,
                regard: 'Second subject',
                content: '<p>Second</p>',
                delay_until: 1800000000,
            },
        ])

        const formData = getRequestFormData(calls[0])
        expect(formData.get('config')).toBe('email_batch_personalized')
        expect(formData.get('messages[0][recipient]')).toBe(
            'alice@example.com',
        )
        expect(formData.get('messages[0][recipient_name]')).toBe('Alice')
        expect(formData.get('messages[0][regard]')).toBe('First subject')
        expect(formData.get('messages[0][content]')).toBe('<p>First</p>')
        expect(formData.get('messages[1][recipient]')).toBe(
            'bob@example.com',
        )
        expect(formData.get('messages[1][recipient_name]')).toBe('')
        expect(formData.get('messages[1][delay_until]')).toBe('1800000000')
    })

    it('serializes history filters and removes duplicate message IDs', async () => {
        const calls = installFetchMock(() => jsonResponse({ status: 200 }))

        await createClient().getMailHistory(
            '2026-06-01',
            '2026-06-30',
            '123, 456, 123',
        )

        const formData = getRequestFormData(calls[0])
        expect(formData.get('config')).toBe('get_mail_history')
        expect(formData.get('dateFrom')).toBe('2026-06-01')
        expect(formData.get('dateTo')).toBe('2026-06-30')
        expect(formData.get('messageIds[0]')).toBe('123')
        expect(formData.get('messageIds[1]')).toBe('456')
        expect(formData.get('messageIds[2]')).toBeNull()
    })

    it('rejects history calls without a start date or message IDs before fetch', async () => {
        const calls = installFetchMock(() => jsonResponse({ status: 200 }))

        await expect(createClient().getMailHistory()).rejects.toThrow(
            'dateFrom is required when no messageIds are provided',
        )
        expect(calls).toHaveLength(0)
    })

    it('rejects invalid recipients before fetch', async () => {
        const calls = installFetchMock(() => jsonResponse({ status: 200 }))

        await expect(
            createClient().sendMail(
                'not-an-email',
                null,
                'Subject',
                'Content',
            ),
        ).rejects.toThrow('Invalid recipient email')
        expect(calls).toHaveLength(0)
    })

    it('preserves attachment order, names, types, and contents', async () => {
        const calls = installFetchMock(() => jsonResponse({ status: 200 }))
        const firstPath = await createTemporaryFile('first.txt', 'first-file')
        const secondPath = await createTemporaryFile(
            'second.txt',
            'second-file',
        )

        await createClient().sendMail(
            'user@example.com',
            null,
            'Subject',
            'Content',
            [
                new EmailAttachment(
                    'first.txt',
                    'text/plain',
                    firstPath,
                    10,
                ),
                new EmailAttachment(
                    'second.txt',
                    'text/plain',
                    secondPath,
                    11,
                ),
            ],
        )

        const formData = getRequestFormData(calls[0])
        const firstAttachment = formData.get('attachments[0]')
        const secondAttachment = formData.get('attachments[1]')

        expect(firstAttachment).toBeInstanceOf(File)
        expect(secondAttachment).toBeInstanceOf(File)
        expect((firstAttachment as File).name).toBe('first.txt')
        expect((secondAttachment as File).name).toBe('second.txt')
        expect((firstAttachment as File).type.startsWith('text/plain')).toBe(
            true,
        )
        expect((secondAttachment as File).type.startsWith('text/plain')).toBe(
            true,
        )
        expect(await (firstAttachment as File).text()).toBe('first-file')
        expect(await (secondAttachment as File).text()).toBe('second-file')
    })

    it('creates attachment metadata from local files', async () => {
        const filePath = await createTemporaryFile(
            'invoice.pdf',
            'pdf-content',
        )

        const attachments = await createClient().createAttachments([filePath])

        expect(attachments).toHaveLength(1)
        expect(attachments[0]).toBeInstanceOf(EmailAttachment)
        expect(attachments[0]?.filename).toBe('invoice.pdf')
        expect(attachments[0]?.mimeType).toBe('application/pdf')
        expect(attachments[0]?.tmpPath).toBe(filePath)
        expect(attachments[0]?.size).toBe(11)
    })

    it('writes a successful download into an existing target directory', async () => {
        installFetchMock(
            () =>
                new Response('downloaded-content', {
                    status: 200,
                    headers: {
                        'content-type': 'text/plain',
                        'content-disposition':
                            'attachment; filename="download.txt"',
                    },
                }),
        )
        const targetDirectory = await createTemporaryDirectory(
            'reikem-mail-client-download-test-',
        )

        const result = (await createClient().downloadFile(
            'inbound',
            789,
            targetDirectory,
        )) as DownloadResponse

        const expectedPath = path.join(targetDirectory, 'download.txt')
        expect(result.path).toBe(expectedPath)
        expect(await readFile(expectedPath, 'utf8')).toBe(
            'downloaded-content',
        )
    })
})
