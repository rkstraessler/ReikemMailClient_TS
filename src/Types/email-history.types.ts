export type HistoryMessageIds =
    | number
    | string
    | Array<number | string>
    | null

export type HistoryDate = Date | string | null

export interface GetMailHistoryOptions {
    dateFrom?: HistoryDate
    dateTo?: HistoryDate
    messageIds?: HistoryMessageIds
}

export interface DownloadFileOptions {
    source: 'inbound' | 'outbound' | string
    fileId: number | string
    targetPath?: string | null
}
