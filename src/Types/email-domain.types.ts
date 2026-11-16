import type { EmailAttachment } from '../EmailAttachment.js'

export type DelayUntil = Date | number | string | null
export interface MailAddress {
    email: string
    name?: string | null
}
export type ReplyTo = MailAddress[]
export interface BinaryAttachment {
    filename: string
    contentType: string
    content: Buffer | Uint8Array
}
export type Attachment = BinaryAttachment | EmailAttachment
export interface SendMailOptions {
    idempotencyKey?: string
    to: MailAddress[]
    cc?: MailAddress[]
    bcc?: MailAddress[]
    replyTo?: ReplyTo
    subject: string
    html: string
    text?: string
    attachments?: Attachment[]
    filterContext?: string | null
    delayUntil?: DelayUntil
}
export type PersonalizedEmailMessage = SendMailOptions
export interface SendPersonalizedMailBatchOptions {
    messages: SendMailOptions[]
    attachments?: Attachment[]
    filterContext?: string | null
    replyTo?: ReplyTo
    cc?: MailAddress[]
    bcc?: MailAddress[]
}
export interface NormalizedMail extends Omit<SendMailOptions, 'attachments' | 'delayUntil'> {
    attachments?: BinaryAttachment[]
    delayUntil?: number | null
}
