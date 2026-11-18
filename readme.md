# REIKEM Mail Client für TypeScript

`@reikem/mail-client` ist das SDK für die REIKEM Mail API v2. Es validiert und kodiert Anfragen für den Mailversand, personalisierte Stapel, den Versandverlauf und Dateidownloads. Die API verwaltet Filterung, Warteschlange, Zustellung und Idempotenz.

[npm-Paket](https://www.npmjs.com/package/@reikem/mail-client) · [GitHub-Releases](https://github.com/rkstraessler/ReikemMailClient_TS/releases) · [Fehler melden](https://github.com/rkstraessler/ReikemMailClient_TS/issues/new)

## Installation

Voraussetzungen sind Node.js 22+ oder Bun 1.4+ sowie die Basis-URL und die beiden Schlüssel einer REIKEM Mail API v2.

```sh
bun add @reikem/mail-client@^2
# Alternativ mit npm
npm install @reikem/mail-client@^2
```

## Erste Mail versenden

```ts
import { createAttachments, EmailAPIClient } from '@reikem/mail-client'

const { MAIL_AUTH_KEY, MAIL_ADAPTER_KEY } = process.env
if (!MAIL_AUTH_KEY || !MAIL_ADAPTER_KEY) {
    throw new Error('MAIL_AUTH_KEY und MAIL_ADAPTER_KEY sind erforderlich.')
}

const client = new EmailAPIClient({
    baseUrl: 'https://mail.example.de/proxy',
    authKey: MAIL_AUTH_KEY,
    adapterKey: MAIL_ADAPTER_KEY,
    connectTimeout: 10,
    requestTimeout: 30,
})

const response = await client.sendMail({
    to: [{ email: 'kunde@example.de', name: 'Erika Müller' }],
    subject: 'Ihr Vertrag',
    html: '<p>Anbei erhalten Sie Ihren Vertrag.</p>',
    attachments: await createAttachments(['./Vertrag.pdf']),
    idempotencyKey: 'vertrag:4711:v2:versand',
})

console.log(response.httpCode, response.data)
```

`baseUrl` akzeptiert eine Origin, ein Reverse-Proxy-Präfix oder eine URL mit `/api/send`, `/api/v2/send` oder `/api/v2`. Das SDK behält das Präfix bei und verwendet die v2-Endpunkte. Die Schlüssel gehen als `Authorization: Bearer …` und `X-Adapter-Key` an die API. Erlaubt sind druckbare ASCII-Zeichen von `0x21` bis `0x7E`.

Beide Zeitlimits sind positive ganze Sekunden bis 2.147.483. `connectTimeout` deckt den TCP-Aufbau und gegebenenfalls den TLS-Handshake ab. `requestTimeout` begrenzt die gesamte Anfrage einschließlich Antwortkörper.

## API

Alle Methoden nutzen `POST` relativ zum Proxy-Präfix.

| Methode | Endpunkt | Verhalten |
| --- | --- | --- |
| `sendMail(options)` und `sendMailList(options)` | `/api/v2/send` | Mehrere To-Adressen bilden eine gruppierte Mail mit einem Queue-Eintrag. |
| `sendPersonalizedMailBatch(options)` | `/api/v2/send-batch` | Versendet bis zu 100 Nachrichten mit eigenen Empfängern, Inhalten und Ergebnissen. |
| `getMailHistory(options)` | `/api/v2/history` | Fragt den Verlauf nach Zeitraum, Nachrichten-IDs oder beidem ab. |
| `downloadFile(options)` | `/api/v2/files/download` | Liefert Dateiinhalte als `Buffer` oder schreibt sie an den angegebenen Zielpfad. |

### Versandoptionen

| Feld | Erwarteter Wert |
| --- | --- |
| `to`, `cc`, `bcc`, `replyTo` | Listen von `{ email, name? }`. `to` ist erforderlich und enthält mindestens einen Eintrag. To, CC und BCC erlauben jeweils bis zu 100 Einträge, Reply-To bis zu 10. |
| `subject`, `html`, `text` | Betreff und HTML sind erforderlich. Der Betreff enthält bis zu 5.000 Unicode-Zeichen ohne Steuerzeichen. `text` ist optional. |
| `attachments` | Bis zu 100 Anhänge pro Nachricht mit eindeutigem `filename`, `contentType` und `content` als `Buffer` oder `Uint8Array`. |
| `filterContext` | Bis zu 1.000 Unicode-Zeichen oder `null`. CRLF und CR werden zu LF, Leerraum am Rand wird nach PHP-ASCII-Regeln getrimmt. |
| `delayUntil` | `Date`, ganze Epochensekunden als Zahl oder String oder `null`. Gültige Werte liegen zwischen `1` und `253402300799`. |
| `idempotencyKey` | Optionaler Geschäftsschlüssel mit 1 bis 255 Unicode-Zeichen ohne Steuerzeichen oder PHP-ASCII-Trim-Zeichen am Rand. |

Das SDK normalisiert Adressen und behält bei Duplikaten die erste Adresse in der Reihenfolge To, CC, BCC. Reply-To wird separat dedupliziert. Internationale Domains werden als Punycode übergeben. Unbekannte Optionsfelder lösen einen Validierungsfehler aus.

`createAttachments(paths)` und `client.createAttachments(paths)` lesen Dateien als Binärdeskriptoren ein. Der v1-Adapter `EmailAttachment` wird weiterhin akzeptiert. Dateinamen dürfen bis zu 500 Unicode-Zeichen enthalten. `/`, `\`, `:` und Steuerzeichen sind unzulässig. Ohne Anhänge sendet das SDK JSON. Mit Anhängen sendet es Multipart mit `payload` und den Binärteilen `attachments[0]`, `attachments[1]` usw.

### Idempotenz und Antworten

Bei identischem Schlüssel und normalisiertem Inhalt liefert die API den ursprünglichen Snapshot mit `replayed: true`. Bei geändertem Inhalt antwortet sie mit HTTP 409 und `code: 'idempotency_conflict'`. Ohne Schlüssel greift der serverseitige Hash-Duplikatfilter. Für den aktuellen Zustellstatus eignet sich `getMailHistory`.

API-Antworten enthalten `{ status, data, httpCode }`. `httpCode` ist der HTTP-Status. Ein gültiger API-Fehler wird als Wert zurückgegeben. Netzwerkfehler werfen `EmailAPITransportError`, ungültige Eingaben, Antwortformate und Dateifehler werfen `Error`. Große numerische JSON-Werte bleiben als exakte Dezimalstrings erhalten. Das SDK führt einzelne Anfragen ohne Weiterleitungen oder Wiederholungen aus.

### Personalisierte Stapel

```ts
const batch = await client.sendPersonalizedMailBatch({
    replyTo: [{ email: 'service@example.de' }],
    bcc: [{ email: 'archiv@example.de' }],
    messages: [
        {
            to: [{ email: 'erika@example.de', name: 'Erika Müller' }],
            subject: 'Vertrag für Erika',
            html: '<p>Guten Tag Frau Müller!</p>',
            idempotencyKey: 'vertrag:4711:v2:versand',
        },
        {
            to: [{ email: 'max@example.de' }],
            subject: 'Vertrag für Max',
            html: '<p>Guten Tag Max!</p>',
            bcc: [],
        },
    ],
})

for (const item of batch.data.results ?? []) {
    console.log(item.index, item.success, item.status, item.data)
}
```

Gemeinsame `attachments`, `filterContext`, `replyTo`, `cc` und `bcc` dienen als Vorgaben. Ein Nachrichtenfeld ersetzt seine Vorgabe vollständig. `[]` entfernt eine Liste, `null` entfernt den Filterkontext und `undefined` übernimmt die Vorgabe. Ein Stapel kann teils erfolgreiche und teils fehlgeschlagene Ergebnisse enthalten. `item.status` ist der jeweilige HTTP-Status.

### Verlauf und Dateien abrufen

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

Beim Verlauf ist `dateFrom` erforderlich, wenn keine IDs vorliegen. Datumsangaben sind Kalenderdaten in `YYYY-MM-DD` oder `Date`-Objekte mit UTC-Auswertung. Mehrere IDs können als Liste oder kommagetrennter String übergeben werden. IDs jenseits von `Number.MAX_SAFE_INTEGER` werden als Strings übergeben.

Beim Download verwendet ein Verzeichnis oder ein Pfad mit abschließendem Separator den Serverdateinamen. Sonst gilt `targetPath` als vollständiger Dateipfad. Das SDK entfernt Pfadanteile aus Serverdateinamen und erstellt fehlende Elternverzeichnisse. Ohne `targetPath` steht der `Buffer` in `file.content`.

### Migration von v1

Versand, Verlauf und Downloads verwenden benannte Optionsobjekte. Versandfelder heißen `to`, `subject`, `html` und `delayUntil`. Adressfelder erhalten Listen von `{ email, name? }`. `createAttachments` liefert eingelesene Binärdeskriptoren. Der positionale Konstruktor und die Klasse `EmailAttachment` stehen für die Migration weiterhin zur Verfügung. Die exportierten Typen beschreiben die v2-Verträge. [Öffentliche Exporte](src/EmailAPIClient.ts)

## Entwicklung

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
bun audit --audit-level=high
```

`bun run check` führt Oxlint, den Bun-Formatierungscheck, den Typecheck, die Tests, den Build und die Paketprüfung aus. Die HTTP- und TCP-Tests starten ihre eigenen lokalen Server. `bun run format` wendet sichere Oxlint-Fixes und Bun-Formatierung auf geänderte, von Git verfolgte Dateien an. Lokal gilt `HEAD` als Vergleichsbasis. In Pull Requests und bei Pushes auf `main` liefert GitHub die Basis für den Vergleich.

### GitHub-Automatisierung

- **CI** prüft Pull Requests und Pushes auf `main`. `Package checks` und `Dependency security` sind die Pflichtprüfungen. Bun prüft die aufgelösten Abhängigkeiten täglich zusätzlich auf Sicherheitslücken ab Schweregrad `high`.
- **Dependabot** aktualisiert npm-Pakete mit dem Bun-Updater für `bun.lock` und GitHub Actions täglich um 03:00 Uhr in `Europe/Berlin`. Reguläre Patch- und Minor-Updates werden pro Ökosystem gruppiert. Security-Updates laufen zusätzlich bei Advisories.
- **Auto-Merge** ist für verifizierte Patch- und Minor-PRs vorgesehen. Bei Änderungen an `main` aktualisiert die Merge-App konfliktfreie Bot-Branches. Der aktualisierte Commit durchläuft erneut beide CI-Jobs. Die App reicht eine Freigabe für den geprüften Commit ein und fordert einen Squash-Merge mit genau dessen SHA an. Major-Updates und uneindeutige Updates durchlaufen ein manuelles Review.
- **autofix.ci** korrigiert geänderte TypeScript-Dateien und ausgewählte Projektkonfigurationen auf dem PR-Branch. Ein Fix-Commit startet CI erneut. `.github`-Dateien werden von CI geprüft und sind von automatischen Fixes ausgeschlossen.
- **Branch-Schutz** verlangt für `main` einen aktuellen Branch, ein genehmigendes Review und beide CI-Checks. GitHub verhindert Force-Pushes und Löschungen für reguläre Benutzer. Die Administratorrolle hat einen ausdrücklich konfigurierten Bypass. CODEOWNERS weist das Repository `@rkstraessler` zu. [Ruleset](.github/main-ruleset.json)
- **Labels** kennzeichnen Ökosystem (`dependencies`, `typescript`, `github-actions`), Update-Typ (`patch`, `minor`, `major`, `security`) und Bearbeitung (`automerge`, `manual-review`, `autofix`). Die Projektlabels sind `bug`, `enhancement`, `documentation` und `maintenance`.

Für Autofix die offizielle [autofix.ci-App](https://github.com/apps/autofix-ci) für dieses Repository installieren. Für die Merge-Automatisierung eine GitHub App mit `Contents: read/write` und `Pull requests: read/write` ausschließlich für dieses Repository installieren. Für die App gelten die regulären Regeln für `main`. `DEPENDABOT_APP_CLIENT_ID` und `DEPENDABOT_APP_SLUG` sind Actions-Variablen. Der private Schlüssel gehört als `DEPENDABOT_APP_PRIVATE_KEY` in die nur für `main` freigegebene Umgebung `dependabot`. GitHubs allgemeine Review-Freigabe für Actions bleibt deaktiviert.

### Releases

Ein veröffentlichtes GitHub-Release mit einem stabilen Tag `vMAJOR.MINOR.PATCH` löst die npm-Publikation aus. Der Tag muss auf einen Commit in der Historie von `main` zeigen. Der Workflow überprüft und baut den Tag-Commit, übernimmt die Paketversion aus dem Tag und veröffentlicht `@reikem/mail-client` über den bestehenden npm Trusted Publisher. Anschließend hängt er den Release-Banner an und bindet ihn in die vorhandenen Release Notes ein. [Release-Workflow](.github/workflows/npm-publish.yml)
