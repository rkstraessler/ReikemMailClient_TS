import type { MailAddress } from './email-domain.types.js'

export interface EmailAPIClientOptions {
    baseUrl: string
    authKey: string
    adapterKey: string
    /** Positive integer seconds. Default: 10. */
    connectTimeout?: number
    /** Total request time, including the response body, in seconds. Default: 30. */
    requestTimeout?: number
}
export type ApiInteger = number | string
export const MailStatus = {
    FILTERING: 'filtering', QUEUED: 'queued', REVIEW: 'review', REJECTED: 'rejected',
    SENT: 'sent', FAILED: 'failed', PREPARING: 'preparing', SENDING: 'sending',
    all(): string[] { return ['filtering', 'queued', 'review', 'rejected', 'sent', 'failed', 'preparing', 'sending'] },
    isKnown(status: string): boolean { return this.all().includes(status) },
} as const
export type QueueStatus = typeof MailStatus[keyof Omit<typeof MailStatus, 'all' | 'isKnown'>] | (string & {})
export interface Rejection {
    status?: QueueStatus
    code?: string
    reason?: string
    filter?: string
    [key: string]: unknown
}
export interface FilterResults {
    filtered?: number
    reasons?: string[]
    rejections?: Record<string, Rejection> | []
    [key: string]: unknown
}
export interface AIRetry {
    pending?: boolean
    attempt?: ApiInteger
    next_attempt_at?: string | null
    delay_seconds?: ApiInteger
    http_status?: number | null
    retry_after_seconds?: ApiInteger | null
    [key: string]: unknown
}
export interface AIResult {
    decision?: string
    reason_code?: string
    confidence?: number
    reason?: string
    model?: string
    model_display_name?: string
    prompt_version?: string
    prompt_hash?: string
    [key: string]: unknown
}
export interface MailEntry {
    queueId?: ApiInteger
    messageId?: string
    smtpMessageId?: string
    status?: QueueStatus
    index?: number
    success?: boolean
    error?: unknown
    errors?: unknown
    recipient?: string
    subject?: string
    html?: string
    text?: string | null
    to?: MailAddress[]
    cc?: MailAddress[]
    bcc?: MailAddress[]
    replyTo?: MailAddress[]
    idempotencyKey?: string | null
    regard?: string
    content?: string
    filters?: FilterResults
    rejectionCode?: string | null
    rejectionReason?: string | null
    filteredAt?: string | null
    filterNextAttemptAt?: string | null
    filterDetails?: {
        ai?: { attempt?: ApiInteger; last_error_at?: string; retry?: AIRetry; result?: AIResult; [key: string]: unknown }
        [key: string]: unknown
    } | []
    [key: string]: unknown
}
export interface SendData {
    success?: boolean
    error?: unknown
    code?: 'idempotency_conflict' | (string & {})
    queueIds?: ApiInteger[]
    messageIds?: string[]
    smtpMessageIds?: string[]
    statuses?: MailEntry[]
    filters?: FilterResults
    idempotencyKey?: string | null
    replayed?: boolean
    [key: string]: unknown
}
export interface BatchResult {
    index: number
    success: boolean
    status: number
    data: SendData
    [key: string]: unknown
}
export interface ApiData extends SendData {
    results?: BatchResult[] | FilterResults
    history?: { Outbound?: MailEntry[]; Inbound?: MailEntry[]; [key: string]: unknown }
}
export interface BatchData extends SendData { results?: BatchResult[] }
export interface IdempotencyConflictData extends SendData {
    success: false
    error: string
    code: 'idempotency_conflict'
}
export interface ApiResponse<T = ApiData> {
    status: number
    data: T
    httpCode: number
    error?: unknown
    code?: string
    [key: string]: unknown
}
export type SendResponse = ApiResponse<SendData>
export type BatchResponse = ApiResponse<BatchData>
export interface IdempotencyConflictResponse extends ApiResponse<IdempotencyConflictData> {
    httpCode: 409
}
export interface DownloadResponse {
    success: true
    httpCode: number
    fileName: string
    contentType: string | null
    bytes: number
    path?: string
    content?: Buffer
}
