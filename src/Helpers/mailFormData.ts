import { randomBytes } from 'node:crypto'
import type { BinaryAttachment, NormalizedMail } from '../Types/email-domain.types.js'

export interface RequestBody { body: Buffer; contentType: string }

export function encodeJson(payload: unknown): RequestBody {
    return { body: Buffer.from(JSON.stringify(payload)), contentType: 'application/json' }
}

export function encodeMail(messages: NormalizedMail[], batch: boolean): RequestBody {
    const uploads: BinaryAttachment[] = []
    const expanded = messages.map(message => ({
        ...message,
        ...(message.attachments === undefined ? {} : { attachments: message.attachments.map(attachment => {
            const uploadIndex = uploads.length
            uploads.push(attachment)
            return { filename: attachment.filename, contentType: attachment.contentType, uploadIndex }
        }) }),
    }))
    const payload = batch ? { messages: expanded } : expanded[0]
    if (!uploads.length) return encodeJson(payload)
    const boundary = `rkmail-${randomBytes(24).toString('hex')}`
    const quote = (value: string) => value.replace(/[\r\n"]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase())
    const parts = [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(payload)}\r\n`)]
    uploads.forEach((attachment, index) => {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="attachments[${index}]"; filename="${quote(attachment.filename)}"\r\nContent-Type: ${attachment.contentType}\r\n\r\n`), Buffer.from(attachment.content), Buffer.from('\r\n'))
    })
    parts.push(Buffer.from(`--${boundary}--\r\n`))
    return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` }
}
