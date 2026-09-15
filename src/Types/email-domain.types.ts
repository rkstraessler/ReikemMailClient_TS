export type DelayUntil = Date | number | string | null

export interface PersonalizedEmailMessage {
    recipient?: string
    email?: string
    recipient_name?: string | null
    recipientName?: string | null
    name?: string | null
    regard?: string
    subject?: string
    content?: string
    html?: string
    delay_until?: DelayUntil
    delayUntil?: DelayUntil
}

export type NormalizedPersonalizedEmailMessage = {
    recipient: string
    recipient_name: string | null
    regard: string
    content: string
    delay_until: DelayUntil
}
