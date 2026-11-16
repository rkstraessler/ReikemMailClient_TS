import { describe, expect, it } from 'bun:test'
import { EmailAPIClient, EmailAttachment, createAttachments, type SendMailOptions } from '../../src/EmailAPIClient.ts'
import { createTemporaryDirectory, createTemporaryFile, localApi, mail, multipart, payload } from './email-api-client-test.helpers.ts'

describe('v2 payload construction over local HTTP', () => {
    it('sends the exact user schema with binary PDF, grouped To, CC and BCC', async () => {
        const api = await localApi()
        const id = 42, version = 3
        const pdfBytes = Buffer.from([0, 255, 37, 80, 68, 70, 13, 10])
        await api.client().sendMail({
            idempotencyKey: `avv:${id}:v${version}:initial`,
            to: [{ email: ' ALICE@Example.com ', name: 'Alice' }, { email: 'bob@example.com', name: null }],
            cc: [], bcc: [{ email: 'private@example.com', name: 'Private' }],
            subject: '  Auftrag  ', html: '\n<p>Hallo</p>\r\n<p>Tschüss</p>\n',
            attachments: [{ filename: 'Vertrag.pdf', contentType: 'Application/PDF', content: pdfBytes }],
        })
        expect(api.calls).toHaveLength(1)
        const call = api.calls[0]!
        expect(call.url).toBe('/api/v2/send')
        expect(call.headers.authorization).toBe('Bearer test-auth')
        expect(call.headers['x-adapter-key']).toBe('test-adapter')
        const form = await multipart(call)
        expect([...form.keys()]).toEqual(['payload', 'attachments[0]'])
        expect(JSON.parse(form.get('payload') as string)).toEqual({
            idempotencyKey: 'avv:42:v3:initial',
            to: [{ email: 'alice@example.com', name: 'Alice' }, { email: 'bob@example.com', name: null }],
            cc: [], bcc: [{ email: 'private@example.com', name: 'Private' }], subject: '  Auftrag  ',
            html: '\n<p>Hallo</p>\r\n<p>Tschüss</p>\n',
            attachments: [{ filename: 'Vertrag.pdf', contentType: 'application/pdf', uploadIndex: 0 }],
        })
        const file = form.get('attachments[0]') as File
        expect(file.name).toBe('Vertrag.pdf')
        expect(file.type).toBe('application/pdf')
        expect(Buffer.from(await file.arrayBuffer())).toEqual(pdfBytes)
        expect(call.body.toString()).not.toContain('"content":[')
    })

    it('uses JSON without attachments and preserves original HTML, subject and text', async () => {
        const api = await localApi()
        const options = mail({ html: ' \n<p>A\nB\r\nC</p>\r ', subject: '  Betreff ä  ', text: '\n raw text\r\n', delayUntil: new Date('2030-01-01T00:00:00Z') })
        await api.client().sendMailList(options)
        expect(api.calls[0]!.headers['content-type']).toBe('application/json')
        expect(payload(api.calls[0]!)).toEqual({ ...options, delayUntil: 1893456000 })
        expect(api.calls[0]!.body.toString()).not.toMatch(/auth_key|adapter_key|config/)
    })

    it('deduplicates To > CC > BCC but keeps Reply-To independent', async () => {
        const api = await localApi()
        await api.client().sendMail(mail({
            to: [{ email: 'A@example.com' }, { email: ' a@example.com ', name: 'duplicate' }],
            cc: [{ email: 'A@example.com' }, { email: 'B@example.com', name: ' B ' }],
            bcc: [{ email: 'B@example.com' }, { email: 'C@example.com' }],
            replyTo: [{ email: 'A@example.com', name: ' Antwort ' }],
        }))
        expect(payload(api.calls[0]!)).toMatchObject({
            to: [{ email: 'a@example.com' }], cc: [{ email: 'b@example.com', name: 'B' }],
            bcc: [{ email: 'c@example.com' }], replyTo: [{ email: 'a@example.com', name: 'Antwort' }],
        })
    })

    it('expands batch defaults per message and flattens every attachment', async () => {
        const api = await localApi()
        const shared = { filename: 'shared.txt', contentType: 'text/plain', content: new Uint8Array([65, 0, 66]) }
        const own = { filename: 'own.pdf', contentType: 'application/pdf', content: Buffer.from('PDF') }
        await api.client().sendPersonalizedMailBatch({
            attachments: [shared], filterContext: ' default ', replyTo: [{ email: 'reply@example.com' }],
            cc: [{ email: 'copy@example.com' }], bcc: [{ email: 'hidden@example.com' }],
            messages: [mail(), mail({ attachments: [own], filterContext: null, cc: [], replyTo: [] }), mail({ attachments: [] })],
        })
        expect(api.calls[0]!.url).toBe('/api/v2/send-batch')
        const form = await multipart(api.calls[0]!)
        const data = JSON.parse(form.get('payload') as string)
        expect(Object.keys(data)).toEqual(['messages'])
        expect(data.messages[0]).toMatchObject({ filterContext: 'default', cc: [{ email: 'copy@example.com' }], bcc: [{ email: 'hidden@example.com' }], replyTo: [{ email: 'reply@example.com' }], attachments: [{ filename: 'shared.txt', contentType: 'text/plain', uploadIndex: 0 }] })
        expect(data.messages[1]).toMatchObject({ filterContext: null, cc: [], replyTo: [], attachments: [{ filename: 'own.pdf', contentType: 'application/pdf', uploadIndex: 1 }] })
        expect(data.messages[2].attachments).toEqual([])
        expect(Buffer.from(await (form.get('attachments[0]') as File).arrayBuffer())).toEqual(Buffer.from([65, 0, 66]))
        expect(await (form.get('attachments[1]') as File).text()).toBe('PDF')
        expect(form.has('attachments[2]')).toBe(false)
    })

    it('uses JSON for attachment-free batch defaults without mutating inputs', async () => {
        const api = await localApi()
        const message = mail({ cc: [{ email: 'USER@example.com' }] })
        const original = JSON.stringify(message)
        await api.client().sendPersonalizedMailBatch({ messages: [message], bcc: [{ email: 'hidden@example.com' }] })
        expect(api.calls[0]!.headers['content-type']).toBe('application/json')
        expect(payload(api.calls[0]!).messages[0].cc).toEqual([])
        expect(JSON.stringify(message)).toBe(original)
    })

    it('allows the same filename in different messages and uploads shared bytes twice', async () => {
        const api = await localApi()
        await api.client().sendPersonalizedMailBatch({ messages: [mail(), mail()], attachments: [{ filename: 'Grüße.txt', contentType: 'TEXT/PLAIN', content: Buffer.from('shared') }] })
        const form = await multipart(api.calls[0]!)
        const data = JSON.parse(form.get('payload') as string)
        expect(data.messages.map((message: any) => message.attachments[0].uploadIndex)).toEqual([0, 1])
        expect((form.get('attachments[0]') as File).name).toBe('Grüße.txt')
        expect(await (form.get('attachments[1]') as File).text()).toBe('shared')
    })

    it('normalizes PHP context whitespace and CRLF without trimming Unicode spaces', async () => {
        const api = await localApi()
        for (const [input, expected] of [[' \t A\r\nB\rC \n', 'A\nB\nC'], ['\u00a0value\u00a0', '\u00a0value\u00a0'], ['  ', null], ['😀'.repeat(1000), '😀'.repeat(1000)]] as const) {
            await api.client().sendMail(mail({ filterContext: input }))
            expect(payload(api.calls.at(-1)!).filterContext).toBe(expected)
        }
    })

    it('supports readable-file descriptors and the legacy attachment adapter', async () => {
        const api = await localApi()
        const filePath = await createTemporaryFile('invoice.pdf', Buffer.from([0, 255, 10]))
        const descriptors = await createAttachments([filePath])
        expect(descriptors[0]).toEqual({ filename: 'invoice.pdf', contentType: 'application/pdf', content: Buffer.from([0, 255, 10]) })
        await api.client().sendMail(mail({ attachments: [new EmailAttachment('legacy.pdf', 'application/pdf', filePath, 3)] }))
        const form = await multipart(api.calls[0]!)
        expect((form.get('attachments[0]') as File).name).toBe('legacy.pdf')
        await expect(api.client().createAttachments([await createTemporaryDirectory()])).rejects.toThrow('readable file')
        await expect(createAttachments([filePath + '.missing'])).rejects.toThrow('readable file')
    })

    for (const suffix of ['', '/', '/proxy', '/proxy/', '/proxy/api/send', '/proxy/api/send/', '/proxy/api/v2/send', '/proxy/api/v2/']) {
        it(`builds v2 endpoints from ${suffix || 'origin'}`, async () => {
            const api = await localApi()
            const client = new EmailAPIClient(api.baseUrl + suffix, 'test-auth', 'test-adapter')
            await client.sendMail(mail())
            expect(api.calls[0]!.url).toBe(`${suffix.includes('proxy') ? '/proxy' : ''}/api/v2/send`)
        })
    }
})

describe('v2 input validation before HTTP', () => {
    const invalid: Array<[string, unknown]> = [
        ['positional', 'user@example.com'], ['null', null], ['unknown field', { ...mail(), regard: 'typo' }],
        ['no To', mail({ to: [] })], ['To map', mail({ to: {} as any })], ['sparse To', mail({ to: new Array(2) })],
        ['address typo', mail({ to: [{ email: 'user@example.com', names: 'typo' } as any] })],
        ['bad email', mail({ to: [{ email: 'a..b@example.com' }] })], ['control email', mail({ to: [{ email: '\nuser@example.com' }] })],
        ['Unicode name', mail({ to: [{ email: 'user@example.com', name: '\ud800' }] })], ['control name', mail({ to: [{ email: 'user@example.com', name: 'A\nB' }] })],
        ['empty subject', mail({ subject: ' ' })], ['nonstring subject', mail({ subject: 3 as any })], ['empty html', mail({ html: ' \n' })],
        ['invalid html Unicode', mail({ html: '\udfff' })], ['text type', mail({ text: null as any })],
        ['empty key', mail({ idempotencyKey: '' })], ['trim key', mail({ idempotencyKey: ' key' })], ['Unicode trim key', mail({ idempotencyKey: 'key\u0085' })],
        ['key controls', mail({ idempotencyKey: 'key\n' })], ['key Unicode', mail({ idempotencyKey: '\ud800' })], ['long key', mail({ idempotencyKey: '😀'.repeat(256) })],
        ['long context', mail({ filterContext: '😀'.repeat(1001) })], ['context control', mail({ filterContext: '\x00context' })], ['context Unicode', mail({ filterContext: '\ud800' })],
        ['fraction delay', mail({ delayUntil: 1.5 })], ['junk delay', mail({ delayUntil: '123abc' })], ['negative delay', mail({ delayUntil: -1 })],
        ['unsafe delay', mail({ delayUntil: Number.MAX_SAFE_INTEGER + 1 })], ['bad Date', mail({ delayUntil: new Date(NaN) })],
        ['unpersistable delay', mail({ delayUntil: 253402300800 })],
        ['long filename', mail({ attachments: [{ filename: '😀'.repeat(501), contentType: 'application/pdf', content: Buffer.alloc(0) }] })],
        ['duplicate filename', mail({ attachments: [1, 2].map(() => ({ filename: 'a.pdf', contentType: 'application/pdf', content: Buffer.alloc(0) })) })],
        ['nonbinary attachment', mail({ attachments: [{ filename: 'a.pdf', contentType: 'application/pdf', content: [1, 2] as any }] })],
        ['bad content type', mail({ attachments: [{ filename: 'a.pdf', contentType: 'text/plain\r\nx: y', content: Buffer.alloc(0) }] })],
        ['bad filename', mail({ attachments: [{ filename: '../a.pdf', contentType: 'application/pdf', content: Buffer.alloc(0) }] })],
        ['attachment typo', mail({ attachments: [{ filename: 'a.pdf', contentType: 'application/pdf', content: Buffer.alloc(0), path: 'typo' } as any] })],
        ...(['to', 'cc', 'bcc', 'replyTo'] as const).map(group => [`${group} raw limit`, mail({ [group]: Array.from({ length: group === 'replyTo' ? 11 : 101 }, () => ({ email: 'same@example.com' })) })] as [string, unknown]),
    ]
    for (const [label, options] of invalid) {
        it(`rejects ${label}`, async () => {
            const api = await localApi()
            await expect(api.client().sendMail(options as SendMailOptions)).rejects.toThrow()
            expect(api.calls).toHaveLength(0)
        })
    }

    it('accepts a 255-codepoint exact idempotency key without generating missing keys', async () => {
        const api = await localApi()
        const idempotencyKey = '😀'.repeat(255)
        await api.client().sendMail(mail({ idempotencyKey }))
        await api.client().sendMail(mail())
        expect(payload(api.calls[0]!).idempotencyKey).toBe(idempotencyKey)
        expect(payload(api.calls[1]!)).not.toHaveProperty('idempotencyKey')
    })

    for (const group of ['to', 'cc', 'bcc', 'replyTo'] as const) {
        for (const [label, whitespace] of [['NBSP', '\u00a0'], ['FEFF', '\ufeff']] as const) {
            for (const position of ['leading', 'trailing'] as const) {
                it(`rejects ${position} ${label} in ${group} before HTTP`, async () => {
                    const api = await localApi()
                    const email = position === 'leading' ? `${whitespace}other@example.com` : `other@example.com${whitespace}`
                    await expect(api.client().sendMail(mail({ [group]: [{ email }] }))).rejects.toThrow(`Invalid ${group} email`)
                    expect(api.calls).toHaveLength(0)
                })
            }
        }
    }

    it('accepts and preserves exactly 5000 Unicode subject characters', async () => {
        const api = await localApi()
        const subject = ` ${'😀'.repeat(4998)} `
        await api.client().sendMail(mail({ subject }))
        expect(payload(api.calls[0]!).subject).toBe(subject)
    })

    it('rejects 5001 Unicode subject characters in single and batch mail before HTTP', async () => {
        const api = await localApi()
        const message = mail({ subject: '😀'.repeat(5001) })
        await expect(api.client().sendMail(message)).rejects.toThrow('Invalid subject')
        await expect(api.client().sendPersonalizedMailBatch({ messages: [message] })).rejects.toThrow('Invalid subject')
        expect(api.calls).toHaveLength(0)
    })

    for (const key of ['authKey', 'adapterKey'] as const) {
        for (const value of [' leading', 'trailing ', 'internal space', '\tkey', 'key\x7f', 'clé']) {
            it(`rejects invalid ${key} ${JSON.stringify(value)} locally`, () => {
                expect(() => new EmailAPIClient({ baseUrl: 'http://127.0.0.1:1', authKey: 'auth', adapterKey: 'adapter', [key]: value })).toThrow(`Invalid ${key}`)
            })
        }
    }

    it('accepts printable non-space ASCII credential boundaries', async () => {
        const api = await localApi()
        await api.client({ authKey: '!auth~', adapterKey: '!adapter~' }).sendMail(mail())
        expect(api.calls[0]!.headers.authorization).toBe('Bearer !auth~')
        expect(api.calls[0]!.headers['x-adapter-key']).toBe('!adapter~')
    })

    it('preserves non-PHP outer Unicode whitespace and key case exactly', async () => {
        const api = await localApi()
        const idempotencyKey = '\u00a0Business:Key\u00a0'
        await api.client().sendMail(mail({ idempotencyKey, delayUntil: '253402300799', attachments: [{ filename: '😀'.repeat(500), contentType: 'Application/PDF', content: Buffer.alloc(0) }] }))
        const form = await multipart(api.calls[0]!)
        const data = JSON.parse(form.get('payload') as string)
        expect(data.idempotencyKey).toBe(idempotencyKey)
        expect(data.delayUntil).toBe(253402300799)
        expect(data.attachments[0].contentType).toBe('application/pdf')
    })

    it('accepts exactly 100 batch messages', async () => {
        const api = await localApi()
        await api.client().sendPersonalizedMailBatch({ messages: Array.from({ length: 100 }, () => mail()) })
        expect(payload(api.calls[0]!).messages).toHaveLength(100)
    })

    it('rejects 101 batch messages before HTTP', async () => {
        const api = await localApi()
        await expect(api.client().sendPersonalizedMailBatch({ messages: Array.from({ length: 101 }, () => mail()) })).rejects.toThrow('messages must be an indexed array with at most 100 entries')
        expect(api.calls).toHaveLength(0)
    })

    it('accepts exactly 100 attachments per message, not per batch', async () => {
        const api = await localApi()
        const attachments = Array.from({ length: 100 }, (_, index) => ({ filename: `${index}.txt`, contentType: 'text/plain', content: Buffer.from('file') }))
        await api.client().sendMail(mail({ attachments }))
        const single = await multipart(api.calls[0]!)
        expect(JSON.parse(single.get('payload') as string).attachments).toHaveLength(100)
        await api.client().sendPersonalizedMailBatch({ messages: [mail(), mail()], attachments })
        const batch = await multipart(api.calls[1]!)
        const data = JSON.parse(batch.get('payload') as string)
        expect(data.messages.map((message: any) => message.attachments.length)).toEqual([100, 100])
        expect(data.messages[1].attachments[99].uploadIndex).toBe(199)
        expect(batch.has('attachments[199]')).toBe(true)
    })

    it('rejects 101 attachments in single mail, batch messages and batch defaults before HTTP', async () => {
        const api = await localApi()
        const attachments = Array.from({ length: 101 }, (_, index) => ({ filename: `${index}.txt`, contentType: 'text/plain', content: Buffer.from('file') }))
        const error = 'attachments must be an indexed array with at most 100 entries'
        await expect(api.client().sendMail(mail({ attachments }))).rejects.toThrow(error)
        await expect(api.client().sendPersonalizedMailBatch({ messages: [mail({ attachments })] })).rejects.toThrow(error)
        await expect(api.client().sendPersonalizedMailBatch({ messages: [mail()], attachments })).rejects.toThrow(error)
        expect(api.calls).toHaveLength(0)
    })

    it('applies the 100-attachment limit through the readable-file helper', async () => {
        const filePath = await createTemporaryFile('limit.txt', 'file')
        const paths = Array.from({ length: 101 }, () => filePath)
        const error = 'attachments must be an indexed array with at most 100 entries'
        await expect(createAttachments(paths)).rejects.toThrow(error)
        const api = await localApi()
        await expect(api.client().createAttachments(paths)).rejects.toThrow(error)
        expect(api.calls).toHaveLength(0)
    })

    it('rejects invalid batch defaults even when overridden', async () => {
        const api = await localApi()
        await expect(api.client().sendPersonalizedMailBatch({ messages: [mail({ cc: [] })], cc: [{ email: 'bad' }] })).rejects.toThrow()
        await expect(api.client().sendPersonalizedMailBatch({ messages: [] })).rejects.toThrow()
        await expect(api.client().sendPersonalizedMailBatch({ messages: [mail()], subject: 'typo' } as any)).rejects.toThrow('Unknown')
        expect(api.calls).toHaveLength(0)
    })

    for (const override of [{ baseUrl: 'ftp://example.com' }, { baseUrl: 'https://u:p@example.com' }, { baseUrl: 'https://example.com?key=x' }, { baseUrl: 'https://example.com/#x' }, { baseUrl: null }, { authKey: '' }, { adapterKey: 'a\nb' }, { connectTimeout: 0 }, { connectTimeout: null }, { requestTimeout: null }, { requestTimeout: 1.5 }, { requestTimeout: 2147484 }, { requestTimeot: 3 }]) {
        it(`rejects constructor ${JSON.stringify(override)}`, () => {
            expect(() => new EmailAPIClient({ baseUrl: 'https://example.com', authKey: 'a', adapterKey: 'b', ...override } as any)).toThrow()
        })
    }
})
