export class EmailAttachment {
    public filename: string
    public mimeType: string
    public tmpPath: string
    public size: number

    constructor(
        filename: string,
        mimeType: string,
        tmpPath: string,
        size: number,
    ) {
        this.filename = filename
        this.mimeType = mimeType
        this.tmpPath = tmpPath
        this.size = size
    }
}
