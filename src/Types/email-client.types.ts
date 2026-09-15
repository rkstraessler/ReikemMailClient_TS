export interface ApiResponse {
    httpCode: number
    [key: string]: unknown
}

export interface DownloadResponse {
    success: true
    httpCode: number
    fileName: string
    contentType: string | null
    bytes: number
    path?: string
    content?: Buffer
}
