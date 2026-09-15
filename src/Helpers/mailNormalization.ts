import type {
    DelayUntil,
    NormalizedPersonalizedEmailMessage,
    PersonalizedEmailMessage,
} from '../Types/email-domain.types.js'

export function isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
}

export function normalizeRecipientsMap(
    recipients: Record<string, unknown>,
): Record<string, string | null> {
    const normalizedRecipients: Record<string, string | null> = {}

    for (const [rawEmail, name] of Object.entries(recipients)) {
        const email = rawEmail.toLowerCase().trim()
        if (email === '') {
            continue
        }

        if (!isValidEmail(email)) {
            throw new Error(`Invalid recipient email: ${email}`)
        }

        if (name === null || name === undefined) {
            normalizedRecipients[email] = null
            continue
        }

        const normalizedName = String(name).trim()
        normalizedRecipients[email] =
            normalizedName === '' ? null : normalizedName
    }

    if (Object.keys(normalizedRecipients).length === 0) {
        throw new Error('Recipients list is empty')
    }

    return normalizedRecipients
}

export function normalizePersonalizedMessages(
    messages: Array<PersonalizedEmailMessage>,
): Array<NormalizedPersonalizedEmailMessage> {
    const normalizedMessages: Array<NormalizedPersonalizedEmailMessage> = []

    for (const [index, message] of messages.entries()) {
        const recipient = String(message.recipient ?? message.email ?? '')
            .toLowerCase()
            .trim()

        if (recipient === '' || !isValidEmail(recipient)) {
            throw new Error(
                `Invalid recipient email at index ${index}: ${recipient}`,
            )
        }

        const rawName =
            message.recipient_name ??
            message.recipientName ??
            message.name ??
            null
        const recipientName =
            rawName === null || rawName === undefined
                ? null
                : String(rawName).trim() || null

        const regard = String(message.regard ?? message.subject ?? '').trim()
        if (regard === '') {
            throw new Error(`Missing regard/subject at message index ${index}`)
        }

        const content = String(message.content ?? message.html ?? '').trim()
        if (content === '') {
            throw new Error(`Missing content/html at message index ${index}`)
        }

        normalizedMessages.push({
            recipient,
            recipient_name: recipientName,
            regard,
            content,
            delay_until:
                message.delay_until ?? message.delayUntil ?? null,
        })
    }

    if (normalizedMessages.length === 0) {
        throw new Error('Personalized messages list is empty')
    }

    return normalizedMessages
}

export function normalizeDelayUntil(
    delayUntil: Exclude<DelayUntil, null>,
): number {
    if (delayUntil instanceof Date) {
        const timestamp = Math.floor(delayUntil.getTime() / 1000)
        if (!Number.isFinite(timestamp) || timestamp <= 0) {
            throw new Error(`Invalid delay_until value: ${delayUntil}`)
        }

        return timestamp
    }

    const timestamp =
        typeof delayUntil === 'number'
            ? delayUntil
            : parseInt(delayUntil, 10)
    if (isNaN(timestamp) || timestamp <= 0) {
        throw new Error(`Invalid delay_until value: ${delayUntil}`)
    }

    return timestamp
}
