import {
    access,
    readFile,
    stat,
} from 'node:fs/promises'
import path from 'node:path'
import mime from 'mime-types'
import { EmailAttachment } from '../EmailAttachment.js'

export async function validateAttachments(
    attachments: Array<EmailAttachment>,
): Promise<void> {
    for (const attachment of attachments) {
        if (!(attachment instanceof EmailAttachment)) {
            throw new Error('Attachments must be EmailAttachment objects')
        }

        try {
            await access(attachment.tmpPath)
        } catch {
            throw new Error(
                `Attachment file does not exist: ${attachment.tmpPath}`,
            )
        }
    }
}

export async function addAttachmentsToFormData(
    formData: FormData,
    attachments: Array<EmailAttachment>,
): Promise<void> {
    for (const [index, attachment] of attachments.entries()) {
        const fileBuffer = await readFile(attachment.tmpPath)
        const blob = new Blob([fileBuffer], { type: attachment.mimeType })
        formData.append(
            `attachments[${index}]`,
            blob,
            attachment.filename,
        )
    }
}

export async function createAttachments(
    paths: Array<string>,
): Promise<Array<EmailAttachment>> {
    const attachments: Array<EmailAttachment> = []

    for (const filePath of paths) {
        try {
            const fileStats = await stat(filePath)
            if (!fileStats.isFile()) {
                throw new Error()
            }

            attachments.push(
                new EmailAttachment(
                    path.basename(filePath),
                    mime.lookup(filePath) || 'application/octet-stream',
                    filePath,
                    fileStats.size,
                ),
            )
        } catch {
            throw new Error(
                `File does not exist or cannot be accessed: ${filePath}`,
            )
        }
    }

    return attachments
}
