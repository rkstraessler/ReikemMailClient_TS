# REIKEM Mail Client for TypeScript

[![CI](https://github.com/rkstraessler/ReikemMailClient_TS/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/rkstraessler/ReikemMailClient_TS/actions/workflows/ci.yml)

`@reikem/mail-client` is the SDK for the REIKEM Mail API v2. It validates and encodes requests for sending email, sending personalized batches, querying mail history, and downloading files. The API handles filtering, queueing, delivery, and idempotency.

[npm package](https://www.npmjs.com/package/@reikem/mail-client) · [GitHub releases](https://github.com/rkstraessler/ReikemMailClient_TS/releases) · [Report an issue](https://github.com/rkstraessler/ReikemMailClient_TS/issues/new)

## Installation

You need Node.js 22+ or Bun 1.4+, a REIKEM Mail API v2 base URL, and both API keys.

```sh
bun add @reikem/mail-client@^2
# Or with npm
npm install @reikem/mail-client@^2
```

## Send your first email

```ts
import { EmailAPIClient } from '@reikem/mail-client'

const { MAIL_AUTH_KEY, MAIL_ADAPTER_KEY } = process.env
if (!MAIL_AUTH_KEY || !MAIL_ADAPTER_KEY) {
    throw new Error('MAIL_AUTH_KEY and MAIL_ADAPTER_KEY are required.')
}

const client = new EmailAPIClient({
    baseUrl: 'https://mail.example.com/proxy',
    authKey: MAIL_AUTH_KEY,
    adapterKey: MAIL_ADAPTER_KEY,
    connectTimeout: 10,
    requestTimeout: 30,
})

const response = await client.sendMail({
    to: [{ email: 'customer@example.com', name: 'Alex Morgan' }],
    subject: 'Your contract is ready',
    html: '<p>Your contract is ready to review.</p>',
    idempotencyKey: 'contract:4711:v2:ready',
})

console.log(response.httpCode, response.data)
```

`baseUrl` accepts an origin, a reverse proxy prefix, or a URL ending in `/api/send`, `/api/v2/send`, or `/api/v2`. The SDK preserves the proxy prefix and calls the v2 endpoints. It sends the keys in the `Authorization: Bearer …` and `X-Adapter-Key` headers. Keys must contain printable ASCII characters from `0x21` through `0x7E`.

Both timeouts accept positive whole seconds up to 2,147,483. `connectTimeout` covers the TCP connection and any TLS handshake. `requestTimeout` covers the entire request, including the response body.

## API

All methods use `POST` with paths relative to the proxy prefix.

| Method | Endpoint | Behavior |
| --- | --- | --- |
| `sendMail(options)` and `sendMailList(options)` | `/api/v2/send` | Multiple To recipients share one email and one queue entry. |
| `sendPersonalizedMailBatch(options)` | `/api/v2/send-batch` | Sends up to 100 messages with individual recipients, content, and results. |
| `getMailHistory(options)` | `/api/v2/history` | Looks up mail history by date range, message IDs, or both. |
| `downloadFile(options)` | `/api/v2/files/download` | Returns a `Buffer` or writes the file to the requested path. |

### Send options

| Option | Accepted value |
| --- | --- |
| `to`, `cc`, `bcc`, `replyTo` | Arrays of `{ email, name? }`. `to` requires at least one entry. To, Cc, and Bcc allow up to 100 entries each. Reply-To allows up to 10. |
| `subject`, `html`, `text` | Subject and HTML are required. The subject allows up to 5,000 Unicode characters and excludes control characters. `text` is optional. |
| `attachments` | Up to 100 attachments per message. Each has a unique `filename`, a `contentType`, and a `Buffer` or `Uint8Array` as `content`. |
| `filterContext` | A string of up to 1,000 Unicode characters, or `null`. The SDK converts CRLF and CR to LF and applies PHP ASCII trimming. |
| `delayUntil` | A `Date`, whole epoch seconds as a number or string, or `null`. Valid values range from `1` through `253402300799`. |
| `idempotencyKey` | An optional business key of 1 to 255 Unicode characters. Control characters and leading or trailing PHP ASCII trim characters are invalid. |

The SDK normalizes addresses and keeps the first occurrence of a duplicate in To, Cc, Bcc order. It deduplicates Reply-To separately. Use Punycode for international domains. Unknown option fields cause a validation error.

`createAttachments(paths)` and `client.createAttachments(paths)` read files into binary attachment descriptors. The v1 `EmailAttachment` adapter remains supported. File names can contain up to 500 Unicode characters and exclude `/`, `\`, `:`, and control characters. Requests without attachments use JSON. Requests with attachments use multipart with a `payload` field and binary parts named `attachments[0]`, `attachments[1]`, and so on.

### Idempotency and responses

When the same key and normalized content are sent again, the API returns the original snapshot with `replayed: true`. Reusing the key with different content returns HTTP 409 and `code: 'idempotency_conflict'`. When the key is omitted, the server applies its hash-based duplicate filter. Use `getMailHistory` for the current delivery status.

API responses contain `{ status, data, httpCode }`, where `httpCode` is the HTTP status. Valid API errors arrive as response values. Network errors throw `EmailAPITransportError`. Invalid inputs, response formats, and file errors throw `Error`. Large JSON numbers are preserved as exact decimal strings. Each request runs without automatic redirects or retries.

### Personalized batches

```ts
const batch = await client.sendPersonalizedMailBatch({
    replyTo: [{ email: 'support@example.com' }],
    bcc: [{ email: 'archive@example.com' }],
    messages: [
        {
            to: [{ email: 'alex@example.com', name: 'Alex Morgan' }],
            subject: 'Your contract',
            html: '<p>Hello Alex, your contract is ready.</p>',
            idempotencyKey: 'contract:4711:v2:send',
        },
        {
            to: [{ email: 'sam@example.com', name: 'Sam Wilson' }],
            subject: 'Your contract',
            html: '<p>Hello Sam, your contract is ready.</p>',
            bcc: [],
        },
    ],
})

for (const item of batch.data.results ?? []) {
    console.log(item.index, item.success, item.status, item.data)
}
```

Shared `attachments`, `filterContext`, `replyTo`, `cc`, and `bcc` act as defaults. A message-level value replaces its default. Use `[]` to clear a list, `null` to clear the filter context, or `undefined` to inherit the default. A batch may contain successful and failed results. `item.status` is the HTTP status of that result.

### Mail history and downloads

```ts
const history = await client.getMailHistory({
    dateFrom: '2026-11-01',
    dateTo: '2026-11-30',
    messageIds: ['9223372036854775807', 123],
})

for (const entry of history.data.history?.Outbound ?? []) {
    console.log(entry.subject, entry.status, entry.filterDetails)
}

const file = await client.downloadFile({
    source: 'outbound',
    fileId: '9223372036854775807',
    targetPath: './downloads/',
})
if ('success' in file && file.success) console.log(file.fileName, file.bytes)
```

`dateFrom` is required when no message IDs are supplied. Dates use `YYYY-MM-DD` or the UTC calendar date of a `Date` object. Pass IDs as an array or a comma-separated string. Use strings for IDs above `Number.MAX_SAFE_INTEGER`.

An existing directory or path ending in a separator uses the server file name. Other `targetPath` values specify the exact destination. The SDK strips path components from server file names and creates missing parent directories. Omit `targetPath` to receive the `Buffer` in `file.content`.

### Migrating from v1

Send, history, and download methods take named options objects. Send fields use `to`, `subject`, `html`, and `delayUntil`. Address fields take arrays of `{ email, name? }`. `createAttachments` returns binary descriptors. The positional constructor and `EmailAttachment` remain available for migration. [Public exports](src/EmailAPIClient.ts)

## Development

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
bun audit --audit-level=high
```

`bun run check` runs Oxlint, the Bun format check, the TypeScript checks, tests, the build, and the package dry run. The HTTP and TCP tests start local servers. `bun run format` applies safe Oxlint fixes and Bun formatting to changed files tracked by Git. Locally it compares against `HEAD`. GitHub provides the comparison base for pull requests and pushes to `main`.

### GitHub automation

- **CI** runs on pull requests and pushes to `main`. `Package checks` and `Dependency security` are required. A daily audit also checks the lockfile for high and critical advisories.
- **Dependabot** checks npm dependencies via its Bun updater and GitHub Actions daily at 03:00 in `Europe/Berlin`. It groups routine patch and minor updates by ecosystem, and opens security PRs when advisories apply.
- **Auto-merge** applies to verified patch and minor updates. The merge app updates conflict-free Dependabot branches when `main` advances. Both CI jobs must pass on the updated commit. The app submits a review and requests a squash merge for that exact SHA. Major and unclassified updates need manual review.
- **autofix.ci** fixes changed TypeScript files and selected project configuration on the PR branch. A fix commit reruns CI. Files in `.github` are checked in CI and excluded from autofix.
- **Branch protection** requires an up-to-date branch, one approving review, and both CI checks. The ruleset blocks force pushes and branch deletion for regular contributors. Repository administrators can bypass the rules. CODEOWNERS assigns ownership to `@rkstraessler`. [Ruleset](.github/main-ruleset.json)
- **Labels** cover ecosystems (`dependencies`, `typescript`, `github-actions`), updates (`patch`, `minor`, `major`, `security`), automation (`automerge`, `manual-review`, `autofix`), and project work (`bug`, `enhancement`, `documentation`, `maintenance`).

Install the official [autofix.ci GitHub App](https://github.com/apps/autofix-ci) for this repository. For Dependabot merging, install a GitHub App with `Contents: read/write` and `Pull requests: read/write` scoped to this repository. The app follows the ordinary rules for `main`. Set the Actions variables `DEPENDABOT_APP_CLIENT_ID` and `DEPENDABOT_APP_SLUG`. Store the private key as `DEPENDABOT_APP_PRIVATE_KEY` in the `dependabot` environment, which is restricted to `main`. Keep the repository-wide GitHub Actions review permission disabled.

### Releases

Publishing a GitHub release with a stable `vMAJOR.MINOR.PATCH` tag runs the npm release workflow. The tag must point to a commit in the history of `main`. The workflow checks and builds the tagged commit, sets the package version from the tag, and publishes `@reikem/mail-client` through the existing npm Trusted Publisher. It then attaches the banner and embeds it in the release notes. [Release workflow](.github/workflows/npm-publish.yml)
