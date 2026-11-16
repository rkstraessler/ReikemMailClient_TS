import { createAttachments } from './Helpers/attachmentFiles.js'
import { encodeJson, encodeMail } from './Helpers/mailFormData.js'
import { normalizeBatch, normalizeMail } from './Helpers/mailNormalization.js'
import { normalizeHistory } from './Helpers/historyNormalization.js'
import { assertFields, positiveInteger } from './Helpers/validation.js'
import { postApiRequest, postDownloadRequest } from './Services/emailApiTransport.service.js'
import type { TransportOptions } from './Services/emailApiTransport.service.js'
import type { ApiData, ApiResponse, BatchData, BatchResponse, DownloadResponse, EmailAPIClientOptions, SendData, SendResponse } from './Types/email-client.types.js'
import type { SendMailOptions, SendPersonalizedMailBatchOptions } from './Types/email-domain.types.js'
import type { DownloadFileOptions, GetMailHistoryOptions } from './Types/email-history.types.js'

export class EmailAPIClient {
    public static readonly MAX_FILTER_CONTEXT_CHARACTERS = 1000
    private readonly endpointRoot: string
    private readonly transport: TransportOptions

    constructor(options: EmailAPIClientOptions)
    constructor(baseUrl: string, authKey: string, adapterKey: string)
    constructor(options: EmailAPIClientOptions | string, authKey?: string, adapterKey?: string) {
        const config: EmailAPIClientOptions = typeof options === 'string' ? { baseUrl: options, authKey: authKey!, adapterKey: adapterKey! } : options
        assertFields(config, ['baseUrl', 'authKey', 'adapterKey', 'connectTimeout', 'requestTimeout'], 'constructor')
        const connectTimeout = config.connectTimeout === undefined ? 10 : config.connectTimeout
        const requestTimeout = config.requestTimeout === undefined ? 30 : config.requestTimeout
        if (![connectTimeout, requestTimeout].every(n => Number.isSafeInteger(n) && n > 0 && n <= 2147483)) throw new Error('Timeouts must be positive integer seconds (at most 2147483)')
        for (const key of ['authKey', 'adapterKey'] as const) {
            if (typeof config[key] !== 'string' || !config[key] || /[^\x21-\x7E]/.test(config[key])) throw new Error(`Invalid ${key}`)
        }
        let url: URL
        try {
            if (typeof config.baseUrl !== 'string') throw new Error()
            url = new URL(config.baseUrl)
        } catch { throw new Error('Invalid Mail API URL') }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid Mail API URL')
        const prefix = url.pathname.replace(/\/+$/, '').replace(/\/api\/(?:v2\/)?send$/, '').replace(/\/api\/v2$/, '')
        this.endpointRoot = `${url.origin}${prefix}/api/v2`
        this.transport = { authKey: config.authKey as string, adapterKey: config.adapterKey as string, connectTimeout, requestTimeout }
    }

    public async sendMail(options: SendMailOptions): Promise<SendResponse> {
        return postApiRequest<SendData>(`${this.endpointRoot}/send`, encodeMail([await normalizeMail(options)], false), this.transport)
    }

    public async sendMailList(options: SendMailOptions): Promise<SendResponse> {
        return this.sendMail(options)
    }

    public async sendPersonalizedMailBatch(options: SendPersonalizedMailBatchOptions): Promise<BatchResponse> {
        return postApiRequest<BatchData>(`${this.endpointRoot}/send-batch`, encodeMail(await normalizeBatch(options), true), this.transport)
    }

    public async getMailHistory(options: GetMailHistoryOptions): Promise<ApiResponse<ApiData>> {
        return postApiRequest(`${this.endpointRoot}/history`, encodeJson(normalizeHistory(options)), this.transport)
    }

    public async downloadFile(options: DownloadFileOptions): Promise<DownloadResponse | ApiResponse> {
        assertFields(options, ['source', 'fileId', 'targetPath'], 'download')
        const source = typeof options.source === 'string' ? options.source.trim().toLowerCase() : ''
        if (source !== 'inbound' && source !== 'outbound') throw new Error('source must be inbound or outbound')
        const fileId = positiveInteger(options.fileId, 'fileId')
        const targetPath = options.targetPath ?? null
        if (targetPath !== null && (typeof targetPath !== 'string' || !targetPath || targetPath.includes('\0'))) throw new Error('Invalid targetPath')
        return postDownloadRequest(`${this.endpointRoot}/files/download`, encodeJson({ source, fileId }), this.transport, targetPath)
    }

    public createAttachments(paths: string[]) { return createAttachments(paths) }
}

export { EmailAttachment } from './EmailAttachment.js'
export { createAttachments } from './Helpers/attachmentFiles.js'
export { EmailAPITransportError } from './Services/emailApiTransport.service.js'
export { MailStatus } from './Types/email-client.types.js'
export type * from './Types/email-client.types.js'
export type * from './Types/email-domain.types.js'
export type * from './Types/email-history.types.js'
