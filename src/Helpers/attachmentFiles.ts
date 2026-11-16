import { access, readFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import mime from 'mime-types'
import { EmailAttachment } from '../EmailAttachment.js'
import type { Attachment, BinaryAttachment } from '../Types/email-domain.types.js'
import { assertFields, assertList, validText } from './validation.js'

export async function normalizeAttachments(attachments: Attachment[]): Promise<BinaryAttachment[]> {
    assertList(attachments, 'attachments', 100)
    const result: BinaryAttachment[] = []
    const filenames = new Set<string>()
    for (const attachment of attachments) {
        let value: BinaryAttachment
        if (attachment instanceof EmailAttachment) {
            value = { filename: attachment.filename, contentType: attachment.mimeType, content: await readAttachment(attachment.tmpPath) }
        } else {
            assertFields(attachment, ['filename', 'contentType', 'content'], 'attachment')
            value = attachment
        }
        if (!validText(value.filename) || !value.filename.trim() || [...value.filename].length > 500 || /[\p{Cc}\\/:]/u.test(value.filename)
            || ['.', '..'].includes(value.filename.trim())) throw new Error('Invalid attachment filename')
        if (filenames.has(value.filename)) throw new Error('Attachment filenames must be unique per message')
        filenames.add(value.filename)
        if (typeof value.contentType !== 'string' || !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(value.contentType)) throw new Error('Invalid attachment contentType')
        if (!(value.content instanceof Uint8Array)) throw new Error('Attachment content must be Buffer or Uint8Array')
        result.push({ filename: value.filename, contentType: value.contentType.toLowerCase(), content: Buffer.from(value.content) })
    }
    return result
}

async function readAttachment(filePath: string): Promise<Buffer> {
    try {
        await access(filePath, constants.R_OK)
        if (!(await stat(filePath)).isFile()) throw new Error()
        return await readFile(filePath)
    } catch { throw new Error('Attachment must be a readable file') }
}

export async function createAttachments(paths: string[]): Promise<BinaryAttachment[]> {
    assertList(paths, 'paths')
    const result: BinaryAttachment[] = []
    for (const filePath of paths) {
        if (typeof filePath !== 'string') throw new Error('Attachment path must be a string')
        result.push({ filename: path.basename(filePath), contentType: mime.lookup(filePath) || 'application/octet-stream', content: await readAttachment(filePath) })
    }
    return normalizeAttachments(result)
}
