import type { GetMailHistoryOptions, HistoryDate, HistoryMessageIds } from '../Types/email-history.types.js'
import { assertFields, assertList, positiveInteger } from './validation.js'

export function normalizeHistoryMessageIds(value: HistoryMessageIds | undefined): string[] {
    if (value === null || value === undefined || value === '') return []
    if (!Array.isArray(value) && typeof value !== 'number' && typeof value !== 'string') throw new Error('Invalid messageIds')
    const raw = Array.isArray(value) ? value : typeof value === 'number' ? [value] : value.trim().split(/\s*,\s*/).filter(Boolean)
    assertList(raw, 'messageIds')
    return [...new Set(raw.filter(id => id !== '').map(id => positiveInteger(id, 'messageId')))]
}

export function normalizeHistoryDate(date: Exclude<HistoryDate, null>, field: string): string {
    if (date instanceof Date) {
        if (!Number.isFinite(date.getTime())) throw new Error(`Invalid ${field}`)
        return normalizeHistoryDate(date.toISOString().slice(0, 10), field)
    }
    if (typeof date !== 'string') throw new Error(`Invalid ${field}`)
    const value = date.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid ${field}`)
    const parsed = new Date(`${value}T00:00:00Z`)
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value.startsWith('0000')) throw new Error(`Invalid ${field}`)
    return value
}

export function normalizeHistory(options: GetMailHistoryOptions): Record<string, unknown> {
    assertFields(options, ['dateFrom', 'dateTo', 'messageIds'], 'history')
    const ids = normalizeHistoryMessageIds(options.messageIds)
    const from = options.dateFrom == null || options.dateFrom === '' ? undefined : normalizeHistoryDate(options.dateFrom, 'dateFrom')
    const to = options.dateTo == null || options.dateTo === '' ? undefined : normalizeHistoryDate(options.dateTo, 'dateTo')
    if (!from && !ids.length) throw new Error('dateFrom is required when no messageIds are provided')
    if (from && to && from > to) throw new Error('dateFrom must not be after dateTo')
    return { ...(from ? { dateFrom: from } : {}), ...(to ? { dateTo: to } : {}), ...(ids.length ? { messageIds: ids } : {}) }
}
