import { normalizeHistoryDate } from './historyNormalization.js'
import { normalizeDelayUntil } from './mailNormalization.js'
import type {
    DelayUntil,
    NormalizedPersonalizedEmailMessage,
} from '../Types/email-domain.types.js'
import type { HistoryDate } from '../Types/email-history.types.js'

export function createAuthenticatedFormData(
    config: string,
    authKey: string,
    adapterKey: string,
): FormData {
    const formData = new FormData()
    formData.append('config', config)
    formData.append('auth_key', authKey)
    formData.append('adapter_key', adapterKey)
    return formData
}

export function addRecipientsToFormData(
    formData: FormData,
    recipients: Record<string, string | null>,
): void {
    for (const [email, name] of Object.entries(recipients)) {
        formData.append(`recipients[${email}]`, name ?? '')
    }
}

export function addPersonalizedMessagesToFormData(
    formData: FormData,
    messages: Array<NormalizedPersonalizedEmailMessage>,
): void {
    for (const [index, message] of messages.entries()) {
        formData.append(`messages[${index}][recipient]`, message.recipient)
        formData.append(
            `messages[${index}][recipient_name]`,
            message.recipient_name ?? '',
        )
        formData.append(`messages[${index}][regard]`, message.regard)
        formData.append(`messages[${index}][content]`, message.content)

        if (message.delay_until !== null) {
            formData.append(
                `messages[${index}][delay_until]`,
                normalizeDelayUntil(message.delay_until).toString(),
            )
        }
    }
}

export function addDelayUntilToFormData(
    formData: FormData,
    delayUntil: DelayUntil,
): void {
    if (delayUntil === null) {
        return
    }

    formData.append(
        'delay_until',
        normalizeDelayUntil(delayUntil).toString(),
    )
}

export function addHistoryFiltersToFormData(
    formData: FormData,
    dateFrom: HistoryDate,
    dateTo: HistoryDate,
    messageIds: Array<number>,
): void {
    if (dateFrom !== null && dateFrom !== '') {
        formData.append(
            'dateFrom',
            normalizeHistoryDate(dateFrom, 'dateFrom'),
        )
    }

    if (dateTo !== null && dateTo !== '') {
        formData.append('dateTo', normalizeHistoryDate(dateTo, 'dateTo'))
    }

    for (const [index, messageId] of messageIds.entries()) {
        formData.append(`messageIds[${index}]`, messageId.toString())
    }
}
