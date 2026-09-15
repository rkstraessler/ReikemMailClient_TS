export type FetchCall = {
    input: Parameters<typeof fetch>[0]
    init: RequestInit | undefined
}
