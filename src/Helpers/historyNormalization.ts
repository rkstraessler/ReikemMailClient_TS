import type {
    HistoryDate,
    HistoryMessageIds,
} from '../Types/email-history.types.js'

export function normalizeHistoryMessageIds(
    messageIds: HistoryMessageIds,
): Array<number> {
    if (messageIds === null || messageIds === '') {
        return []
    }

    const rawMessageIds = Array.isArray(messageIds)
        ? messageIds
        : String(messageIds)
              .trim()
              .split(/\s*,\s*/)
              .filter((messageId) => messageId !== '')

    const normalizedMessageIds: Array<number> = []
    for (const rawMessageId of rawMessageIds) {
        const messageId = String(rawMessageId).trim()
        if (messageId === '') {
            continue
        }

        if (!/^\d+$/.test(messageId)) {
            throw new Error(`Invalid messageId value: ${messageId}`)
        }

        normalizedMessageIds.push(parseInt(messageId, 10))
    }

    return [...new Set(normalizedMessageIds)]
}

export function normalizeHistoryDate(
    date: Exclude<HistoryDate, null>,
    fieldName: string,
): string {
    if (date instanceof Date) {
        if (isNaN(date.getTime())) {
            throw new Error(`Invalid ${fieldName} value: ${date}`)
        }

        return date.toISOString().slice(0, 10)
    }

    const normalizedDate = String(date).trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
        throw new Error(`Invalid ${fieldName} value: ${normalizedDate}`)
    }

    return normalizedDate
}
