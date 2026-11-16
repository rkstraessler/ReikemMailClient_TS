import { isIP } from 'node:net'
import type { DelayUntil, MailAddress, NormalizedMail, SendMailOptions, SendPersonalizedMailBatchOptions } from '../Types/email-domain.types.js'
import { normalizeAttachments } from './attachmentFiles.js'
import { assertFields, assertList, phpTrim, positiveInteger, validText } from './validation.js'

export function isValidEmail(email: string): boolean {
    if (!validText(email) || email.length > 254 || /[^\x20-\x7E]/.test(email)) return false
    const at = email.lastIndexOf('@')
    const local = email.slice(0, at)
    const domain = email.slice(at + 1)
    if (at < 1 || local.length > 64) return false
    const atom = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i
    const quoted = /^"(?:[\x20-\x21\x23-\x5B\x5D-\x7E]|\\[\x20-\x7E])*"$/
    if (!atom.test(local) && !quoted.test(local)) return false
    if (domain.startsWith('[') && domain.endsWith(']')) return isIP(domain.slice(1, -1).replace(/^IPv6:/i, '')) !== 0
    return domain.length <= 253 && domain.includes('.') && domain.split('.').every(label =>
        label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))
}

export function normalizeAddresses(value: MailAddress[], field: string, seen = new Set<string>()): MailAddress[] {
    assertList(value, field, field === 'replyTo' ? 10 : 100)
    const result: MailAddress[] = []
    for (const address of value) {
        assertFields(address, ['email', 'name'], field)
        if (!validText(address.email) || /\p{Cc}/u.test(address.email) || !isValidEmail(phpTrim(address.email))) throw new Error(`Invalid ${field} email`)
        const email = phpTrim(address.email).toLowerCase()
        const name = address.name
        if (name != null && (!validText(name) || /\p{Cc}/u.test(name))) throw new Error(`Invalid ${field} name`)
        if (!seen.has(email)) {
            seen.add(email)
            result.push({ email, ...(name === undefined ? {} : { name: name === null ? null : phpTrim(name) || null }) })
        }
    }
    return result
}

export function normalizeFilterContext(value: unknown): string | null {
    if (value === null) return null
    if (!validText(value)) throw new Error('filterContext must be valid Unicode text or null')
    const normalized = value.replace(/\r\n?/g, '\n')
    if (/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u.test(normalized)) throw new Error('filterContext contains unsupported controls')
    const trimmed = phpTrim(normalized)
    if ([...trimmed].length > 1000) throw new Error('filterContext exceeds 1000 Unicode characters')
    return trimmed || null
}

export function normalizeDelayUntil(value: DelayUntil): number | null {
    if (value === null) return null
    const digits = positiveInteger(value instanceof Date ? Math.floor(value.getTime() / 1000) : value, 'delayUntil')
    const timestamp = Number(digits)
    if (!Number.isSafeInteger(timestamp) || timestamp > 253402300799) throw new Error('delayUntil must be a positive integer at most 253402300799 (SQL year 9999)')
    return timestamp
}

export async function normalizeMail(options: SendMailOptions): Promise<NormalizedMail> {
    assertFields(options, ['idempotencyKey', 'to', 'cc', 'bcc', 'replyTo', 'subject', 'html', 'text', 'attachments', 'filterContext', 'delayUntil'], 'mail')
    const seen = new Set<string>()
    const to = normalizeAddresses(options.to, 'to', seen)
    if (!to.length) throw new Error('to must not be empty')
    const result: NormalizedMail = { to, subject: options.subject, html: options.html }
    if (!validText(options.subject) || !options.subject.trim() || [...options.subject].length > 5000 || /\p{Cc}/u.test(options.subject)) throw new Error('Invalid subject')
    if (!validText(options.html) || !options.html.trim()) throw new Error('Invalid html')
    if (options.idempotencyKey !== undefined) {
        const key = options.idempotencyKey
        if (!validText(key) || !key || [...key].length > 255 || /\p{Cc}/u.test(key) || phpTrim(key) !== key) throw new Error('Invalid idempotencyKey')
        result.idempotencyKey = key
    }
    if (options.cc !== undefined) result.cc = normalizeAddresses(options.cc, 'cc', seen)
    if (options.bcc !== undefined) result.bcc = normalizeAddresses(options.bcc, 'bcc', seen)
    if (options.replyTo !== undefined) result.replyTo = normalizeAddresses(options.replyTo, 'replyTo')
    if (options.text !== undefined) {
        if (!validText(options.text)) throw new Error('Invalid text')
        result.text = options.text
    }
    if (options.filterContext !== undefined) result.filterContext = normalizeFilterContext(options.filterContext)
    if (options.delayUntil !== undefined) result.delayUntil = normalizeDelayUntil(options.delayUntil)
    if (options.attachments !== undefined) result.attachments = await normalizeAttachments(options.attachments)
    return result
}

export async function normalizeBatch(options: SendPersonalizedMailBatchOptions): Promise<NormalizedMail[]> {
    const fields = ['attachments', 'filterContext', 'replyTo', 'cc', 'bcc'] as const
    assertFields(options, ['messages', ...fields], 'batch')
    assertList(options.messages, 'messages', 100)
    if (!options.messages.length) throw new Error('messages must not be empty')
    const defaults: Partial<SendMailOptions> = {}
    if (options.attachments !== undefined) defaults.attachments = await normalizeAttachments(options.attachments)
    if (options.filterContext !== undefined) defaults.filterContext = normalizeFilterContext(options.filterContext)
    if (options.replyTo !== undefined) defaults.replyTo = normalizeAddresses(options.replyTo, 'replyTo')
    if (options.cc !== undefined) defaults.cc = normalizeAddresses(options.cc, 'cc')
    if (options.bcc !== undefined) defaults.bcc = normalizeAddresses(options.bcc, 'bcc')
    const result: NormalizedMail[] = []
    for (const message of options.messages) {
        // Undefined means inherit; explicit null/empty values override a default.
        assertFields(message, ['to', 'subject', 'html', 'text', 'idempotencyKey', 'delayUntil', ...fields], 'mail')
        const merged = { ...message }
        for (const field of fields) {
            if (message[field] === undefined && defaults[field] !== undefined) Object.assign(merged, { [field]: defaults[field] })
        }
        result.push(await normalizeMail(merged))
    }
    return result
}
