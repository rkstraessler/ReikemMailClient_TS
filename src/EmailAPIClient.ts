import { EmailAttachment } from './EmailAttachment.js'
import {
    addDelayUntilToFormData,
    addHistoryFiltersToFormData,
    addPersonalizedMessagesToFormData,
    addRecipientsToFormData,
    createAuthenticatedFormData,
} from './Helpers/mailFormData.js'
import {
    isValidEmail,
    normalizePersonalizedMessages,
    normalizeRecipientsMap,
} from './Helpers/mailNormalization.js'
import { normalizeHistoryMessageIds } from './Helpers/historyNormalization.js'
import {
    addAttachmentsToFormData,
    createAttachments,
    validateAttachments,
} from './Helpers/attachmentFiles.js'
import {
    postApiRequest,
    postDownloadRequest,
} from './Services/emailApiTransport.service.js'
import type {
    ApiResponse,
    DownloadResponse,
} from './Types/email-client.types.js'
import type {
    DelayUntil,
    PersonalizedEmailMessage,
} from './Types/email-domain.types.js'
import type {
    HistoryDate,
    HistoryMessageIds,
} from './Types/email-history.types.js'

export class EmailAPIClient {
    private readonly apiUrl: string
    private readonly authKey: string
    private readonly adapterKey: string

    constructor(apiUrl: string, authKey: string, adapterKey: string) {
        this.apiUrl = apiUrl.replace(/\/$/, '')
        this.authKey = authKey
        this.adapterKey = adapterKey
    }

    public async sendMail(
        recipientEmail: string,
        recipientName: string | null,
        regard: string,
        content: string,
        attachments: Array<EmailAttachment> = [],
        delayUntil: DelayUntil = null,
    ): Promise<ApiResponse> {
        if (!isValidEmail(recipientEmail)) {
            throw new Error(`Invalid recipient email: ${recipientEmail}`)
        }

        return this.sendMailList(
            { [recipientEmail]: recipientName },
            regard,
            content,
            attachments,
            delayUntil,
        )
    }

    public async sendMailList(
        recipients: Record<string, string | null | undefined>,
        regard: string,
        content: string,
        attachments: Array<EmailAttachment> = [],
        delayUntil: DelayUntil = null,
    ): Promise<ApiResponse> {
        const normalizedRecipients = normalizeRecipientsMap(recipients)
        await validateAttachments(attachments)

        const formData = this.createRequestFormData('email')
        formData.append('regard', regard)
        formData.append('content', content)

        addRecipientsToFormData(formData, normalizedRecipients)
        addDelayUntilToFormData(formData, delayUntil)
        await addAttachmentsToFormData(formData, attachments)

        return postApiRequest(this.apiUrl, formData)
    }

    public async sendPersonalizedMailBatch(
        messages: Array<PersonalizedEmailMessage>,
        attachments: Array<EmailAttachment> = [],
    ): Promise<ApiResponse> {
        const normalizedMessages = normalizePersonalizedMessages(messages)
        await validateAttachments(attachments)

        const formData = this.createRequestFormData(
            'email_batch_personalized',
        )

        addPersonalizedMessagesToFormData(formData, normalizedMessages)
        await addAttachmentsToFormData(formData, attachments)

        return postApiRequest(this.apiUrl, formData)
    }

    public async getMailHistory(
        dateFrom: HistoryDate = null,
        dateTo: HistoryDate = null,
        messageIds: HistoryMessageIds = null,
    ): Promise<ApiResponse> {
        const normalizedMessageIds = normalizeHistoryMessageIds(messageIds)

        if (dateFrom === null && normalizedMessageIds.length === 0) {
            throw new Error(
                'dateFrom is required when no messageIds are provided',
            )
        }

        const formData = this.createRequestFormData('get_mail_history')
        addHistoryFiltersToFormData(
            formData,
            dateFrom,
            dateTo,
            normalizedMessageIds,
        )

        return postApiRequest(this.apiUrl, formData)
    }

    public async downloadFile(
        source: 'inbound' | 'outbound' | string,
        fileId: number | string,
        targetPath: string | null = null,
    ): Promise<DownloadResponse | ApiResponse> {
        const normalizedSource = source.toLowerCase().trim()
        if (
            normalizedSource !== 'inbound' &&
            normalizedSource !== 'outbound'
        ) {
            throw new Error('source must be inbound or outbound')
        }

        const normalizedFileId =
            typeof fileId === 'number' ? fileId : parseInt(fileId, 10)
        if (isNaN(normalizedFileId) || normalizedFileId <= 0) {
            throw new Error('Invalid fileId')
        }

        const formData = this.createRequestFormData('filedownload')
        formData.append('source', normalizedSource)
        formData.append('fileId', normalizedFileId.toString())

        return postDownloadRequest(this.apiUrl, formData, targetPath)
    }

    public async createAttachments(
        paths: Array<string>,
    ): Promise<Array<EmailAttachment>> {
        return createAttachments(paths)
    }

    private createRequestFormData(config: string): FormData {
        return createAuthenticatedFormData(
            config,
            this.authKey,
            this.adapterKey,
        )
    }
}

export { EmailAttachment }
export type {
    ApiResponse,
    DelayUntil,
    DownloadResponse,
    HistoryDate,
    HistoryMessageIds,
    PersonalizedEmailMessage,
}
