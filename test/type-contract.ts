import { EmailAPIClient, MailStatus } from '../src/EmailAPIClient.js'
import type {
    AIRetry, ApiInteger, BatchResponse, DownloadResponse, IdempotencyConflictResponse,
    MailAddress, QueueStatus, SendMailOptions, SendResponse,
} from '../src/EmailAPIClient.js'

// Compiled by typecheck, not executed: public v2 signatures and intentional v1 breaks.
async function contract(client: EmailAPIClient, pdfBytes: Buffer, id: string, version: number) {
    const options = {
        idempotencyKey: `avv:${id}:v${version}:initial`,
        to: [{ email: 'a@example.com', name: 'Erika Müller' }, { email: 'b@example.com', name: null }],
        cc: [], bcc: [], subject: 'Vertrag', html: '<p>Hallo!</p>',
        attachments: [{ filename: 'Vertrag.pdf', contentType: 'application/pdf', content: pdfBytes }],
    } satisfies SendMailOptions
    const response: SendResponse = await client.sendMail(options)
    const same: SendResponse = await client.sendMailList(options)
    const batch: BatchResponse = await client.sendPersonalizedMailBatch({ messages: [options], replyTo: [{ email: 'reply@example.com' }] })
    const queueId: ApiInteger | undefined = response.data.queueIds?.[0]
    const status: QueueStatus | undefined = batch.data.results?.[0]?.data.statuses?.[0]?.status
    const history = await client.getMailHistory({ messageIds: ['9223372036854775807'] })
    const to: MailAddress[] | undefined = history.data.history?.Outbound?.[0]?.to
    const details = history.data.history?.Outbound?.[0]?.filterDetails
    const retry: AIRetry | undefined = details && !Array.isArray(details) ? details.ai?.retry : undefined
    const download = await client.downloadFile({ source: 'outbound', fileId: '9223372036854775807' })
    if ('success' in download && download.success === true) {
        const file = download as DownloadResponse
        const bytes: Buffer | undefined = file.content
        void bytes
    }
    // @ts-expect-error v1 positional sendMail is deliberately removed
    await client.sendMail('a@example.com', null, 'S', 'H')
    // @ts-expect-error address objects replace recipient maps
    await client.sendMail({ to: { 'a@example.com': null }, subject: 'S', html: 'H' })
    // @ts-expect-error numeric arrays must not become JSON attachment content
    await client.sendMail({ ...options, attachments: [{ filename: 'a', contentType: 'text/plain', content: [1, 2] }] })
    // @ts-expect-error misspelled fields are not accepted by the public options type
    await client.sendMail({ ...options, filterContex: 'typo' })
    // @ts-expect-error batch itself is an options object, not an array
    await client.sendPersonalizedMailBatch([options])
    // @ts-expect-error history now has named options
    await client.getMailHistory('2026-11-01')
    // @ts-expect-error downloads now have named options
    await client.downloadFile('outbound', 123)
    void [same, queueId, status, to, retry, MailStatus.QUEUED]
}

const conflict: IdempotencyConflictResponse = {
    status: 409, httpCode: 409,
    data: { success: false, error: 'Dieser Idempotenzschlüssel wurde bereits für einen anderen Inhalt verwendet.', code: 'idempotency_conflict' },
}
void [contract, conflict]
