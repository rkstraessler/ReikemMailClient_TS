# Reikem Mail Client

This repository contains the Bun-first TypeScript client for the Reikem mail API endpoint handled by **`EmailAPIHandler`**. The published package is `@reikem/mail-client`.

## What this client does

`EmailAPIClient` sends a **multipart/form-data** `POST` request (via native `fetch` and `FormData`) to your backend email endpoint. It exposes these public methods:

- `EmailAPIClient.sendMail(...)`: send the same mail to exactly one recipient (email + optional name)
- `EmailAPIClient.sendMailList(...)`: send the same mail to **many** recipients at once (as a key/value map `email => name`)
- `EmailAPIClient.sendPersonalizedMailBatch(...)`: send many individualized messages in one request
- `EmailAPIClient.getMailHistory(...)`: fetch mail history by date range and/or message IDs
- `EmailAPIClient.downloadFile(...)`: download inbound or outbound attachment files
- `EmailAPIClient.createAttachments(...)`: helper to build `EmailAttachment` objects from local file paths

## Requirements

- Bun 1.3.14 or newer
- The backend returns a **JSON** response body
- Access to your Reikem mail API endpoint

## Install the package

Install the public package from npm with npm:

```bash
npm install @reikem/mail-client
```

Or install it with Bun:

```bash
bun add @reikem/mail-client
```

## Repository setup

Install the locked development dependencies after cloning the repository:

```bash
bun install
```

Run all local checks with:

```bash
bun run check
```

CI and release jobs must use the committed lockfile without changing it:

```bash
bun install --frozen-lockfile
```

## Keeping the package updated

Update the dependency through Bun and commit the resulting `package.json` and `bun.lock` changes:

```bash
bun update @reikem/mail-client
```

## Usage

Use an ES module or TypeScript import:

```javascript
import { EmailAPIClient } from '@reikem/mail-client'

const client = new EmailAPIClient(
  'https://your-backend.example.com/api/send', // EmailAPIHandler endpoint
  'YOUR_AUTH_KEY',
  'YOUR_ADAPTER_KEY',
)
```

### Send to one recipient

Even for a single recipient, the client sends the request using the `recipients` map internally, so the server only needs to support one input format.

```javascript
const result = await client.sendMail(
  'user@example.com',
  'Jane Doe', // can be null
  'Welcome',
  '<p>Hello!</p>',
  [],
  null
);
console.log(result);
```

### Send to many recipients (KVP)

`sendMailList()` takes an object map (`email => name|null`).

```javascript
const result = await client.sendMailList(
  {
    'alice@example.com': 'Alice',
    'bob@example.com': null,
    'carol@example.com': 'Carol Example',
  },
  'Release notes',
  'Hello everyone, ...',
  [],
  null
);
console.log(result);
```

> Note: The backend may deduplicate recipients by normalized email (lowercase + trim). If the same email appears multiple times, it may only be queued once.

## Scheduling / Delay (`delay_until`)

`delayUntil` is optional. If provided, the client will send `delay_until` as a **Unix timestamp (seconds)**. Accepted types:

- `number|string`: cast to integer and treated as a Unix timestamp (seconds)
- `Date`: converted via `Math.floor(date.getTime() / 1000)`

Example using a Unix timestamp:

```javascript
const result = await client.sendMail(
  'user@example.com',
  null,
  'Scheduled mail',
  'This will be sent later.',
  [],
  Math.floor(Date.now() / 1000) + 3600 // +1 hour
);
```

Example using a `Date` object:

```javascript
const result = await client.sendMail(
  'user@example.com',
  null,
  'Scheduled mail',
  'This will be sent later.',
  [],
  new Date(Date.now() + 3600 * 1000)
);
```

On the backend, `delay_until` can be converted to a UTC `DATETIME` string before storing it in the queue.

## Personalized batch mails

`sendPersonalizedMailBatch()` sends multiple individualized messages in one API request. Each message accepts either the PHP-client field names or JS-friendly aliases:

- `recipient` or `email`
- `recipient_name`, `recipientName`, or `name`
- `regard` or `subject`
- `content` or `html`
- `delay_until` or `delayUntil`

```javascript
const result = await client.sendPersonalizedMailBatch([
  {
    email: 'alice@example.com',
    name: 'Alice',
    subject: 'Hi Alice',
    html: '<p>Your personal content.</p>',
  },
  {
    recipient: 'bob@example.com',
    recipientName: 'Bob',
    regard: 'Hi Bob',
    content: '<p>Your different content.</p>',
    delayUntil: new Date(Date.now() + 3600 * 1000),
  },
]);
console.log(result);
```

The request uses `config=email_batch_personalized` and fields like `messages[0][recipient]`.

## Mail history

`getMailHistory()` mirrors the PHP client. You can request history by `dateFrom`, optional `dateTo`, and optional message IDs. If no message IDs are provided, `dateFrom` is required.

```javascript
const history = await client.getMailHistory(
  '2026-06-01',
  '2026-06-17',
  [123, 456]
);
console.log(history);
```

Message IDs can also be passed as a comma-separated string:

```javascript
const history = await client.getMailHistory(null, null, '123,456');
```

## File download

`downloadFile()` downloads an `inbound` or `outbound` file by ID. Without a target path, the binary content is returned as a `Buffer`.

```javascript
const download = await client.downloadFile('outbound', 123);
console.log(download.fileName, download.bytes, download.content);
```

Pass a file path or directory path to write the download to disk:

```javascript
const download = await client.downloadFile('inbound', 456, './downloads');
console.log(download.path);
```

## Attachments

Attachments must be instances of `EmailAttachment` and the file must exist on disk.

```javascript
import { EmailAttachment } from '@reikem/mail-client'

const filePath = './tmp/invoice.pdf'
const file = Bun.file(filePath)

const attachment = new EmailAttachment(
  'invoice.pdf',
  'application/pdf',
  filePath,
  file.size,
)

const result = await client.sendMail(
  'user@example.com',
  null,
  'Your invoice',
  'See attachment.',
  [attachment],
)
```

### createAttachments helper

```javascript
const attachments = await client.createAttachments([
  './tmp/invoice.pdf',
  './tmp/terms.pdf',
]);

const result = await client.sendMail(
  'user@example.com',
  null,
  'Your documents',
  'See attachments.',
  attachments
);
```

## What the client sends (backend contract)

The client sends a `POST` request with these fields:

- `config`: fixed value `email`
- `auth_key`: auth key passed into the client constructor
- `adapter_key`: adapter key passed into the client constructor
- `recipients[...]`: recipients map (KVP), sent as form fields like `recipients[alice@example.com] = Alice` or `recipients[bob@example.com] = ""`
- `regard`: subject/title (field name kept as-is)
- `content`: mail body (string; HTML or text depending on backend)
- `delay_until`: optional Unix timestamp (seconds)
- `attachments[i]`: file uploads added as `Blob` objects (`attachments[0]`, `attachments[1]`, ...)

Additional configs used by specialized methods:

- `email_batch_personalized`: personalized batch send with `messages[i][...]` fields
- `get_mail_history`: history lookup with `dateFrom`, `dateTo`, and `messageIds[i]`
- `filedownload`: file download with `source` and `fileId`

## Backend behavior (important)

- The backend creates **one queue row per recipient**, so each recipient can be monitored independently.
- For multiple recipients with attachments, the server may write each attachment file to disk **only once** (for the first queued recipient). For all other queued recipients, it may only create additional DB rows referencing the same stored file path.

## Response format

The backend uses a JSON envelope like:

```json
{
  "status": 200,
  "data": {}
}
```

`EmailAPIClient` returns the decoded JSON as an object and adds:

- `httpCode`: the HTTP status code returned by the backend

Valid JSON responses resolve as `ApiResponse` even when the HTTP status is outside the `200` to `299` range. Callers must inspect `httpCode` and the backend `status` field to decide whether the API operation succeeded. Transport failures and invalid response bodies reject with an `Error`.

### Success example

The handler may return queue IDs created for the request:

```json
{
  "status": 200,
  "data": {
    "success": true,
    "queueIds": [123]
  },
  "httpCode": 200
}
```

### Failure example

```json
{
  "status": 400,
  "data": {
    "success": false,
    "logs": {
      "error": ["..."]
    }
  },
  "httpCode": 400
}
```

## Error handling (client)

The client throws standard JavaScript `Error` objects for common error cases:

- Invalid recipient emails
- Invalid `delayUntil` values
- Wrong attachment object types
- Missing attachment files
- Network failures during `fetch`
- Invalid JSON in the backend response

Example:

```javascript
try {
  const response = await client.sendMail(
    'user@example.com',
    'Jane Doe',
    'Welcome',
    '<p>Hello!</p>'
  );
  console.log(response);
} catch (error) {
  console.error('Failed to send email:', error.message);
}
```

## Public API overview

### `new EmailAPIClient(apiUrl, authKey, adapterKey)`
Creates a new client instance.
- `apiUrl`: backend endpoint URL
- `authKey`: authentication key
- `adapterKey`: adapter key

### `await client.sendMail(recipientEmail, recipientName, regard, content, attachments = [], delayUntil = null)`
Sends one email to one recipient.

### `await client.sendMailList(recipients, regard, content, attachments = [], delayUntil = null)`
Sends one email to multiple recipients.

### `await client.sendPersonalizedMailBatch(messages, attachments = [])`
Sends many personalized emails in one request.

### `await client.getMailHistory(dateFrom = null, dateTo = null, messageIds = null)`
Fetches mail history. `dateFrom` is required unless `messageIds` are provided.

### `await client.downloadFile(source, fileId, targetPath = null)`
Downloads an inbound or outbound file. Returns a `Buffer` in `content`, or writes to `targetPath` when provided.

### `await client.createAttachments(paths)`
Creates an array of `EmailAttachment` objects from local file paths.

### `new EmailAttachment(filename, mimeType, tmpPath, size)`
Creates an attachment DTO manually.

## Example implementation

```javascript
import { EmailAPIClient } from '@reikem/mail-client'

async function main() {
  const client = new EmailAPIClient(
    'https://your-backend.example.com/api/send',
    'YOUR_AUTH_KEY',
    'YOUR_ADAPTER_KEY',
  )

  const attachments = await client.createAttachments([
    './tmp/invoice.pdf',
  ])

  const result = await client.sendMail(
    'user@example.com',
    'Jane Doe',
    'Your invoice',
    '<p>Please find your invoice attached.</p>',
    attachments,
  )

  console.log(result)
}

main().catch((err) => {
  console.error(err)
})
```
