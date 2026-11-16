# @reikem/mail-client 2.0

TypeScript-SDK für die Reikem Mail API v2. Versand, personalisierte Stapel,
Verlauf und Dateidownloads verwenden benannte Optionsobjekte. Die API übernimmt
Filterung, Warteschlange, Zustellung und Idempotenz; das SDK validiert und kodiert
die Anfragen. Ein Versand mit mehreren To-Adressen ist **eine gruppierte Mail**
mit einem Queue-Eintrag, nicht ein Versand pro To-Adresse.

## Installation

```sh
bun add @reikem/mail-client@^2
# alternativ: npm install @reikem/mail-client@^2
```

Laufzeit: Node.js 22+ oder Bun 1.4+. Getestet mit Node.js 24.15.0 und Bun 1.4.0.
Das SDK benötigt den JSON-Reviver mit Quelltextkontext, um große Zahlen in Antworten
verlustfrei zu lesen; hierfür ist Node.js 24 nicht erforderlich.

## Client

```ts
import { EmailAPIClient } from '@reikem/mail-client'

const client = new EmailAPIClient({
    baseUrl: 'https://mail.example.de/proxy',
    authKey: process.env.MAIL_AUTH_KEY!,
    adapterKey: process.env.MAIL_ADAPTER_KEY!,
    connectTimeout: 10,
    requestTimeout: 30,
})
```

Beide Zeitlimits sind positive ganze **Sekunden**, höchstens 2147483.
`connectTimeout` gilt bis zum TCP-Verbindungsaufbau bzw. abgeschlossenen
TLS-Handshake; `requestTimeout` begrenzt die gesamte Anfrage einschließlich
Antwortkörper. Das SDK folgt keinen Weiterleitungen und führt keine automatischen
Wiederholungen durch. Transportfehler werfen `EmailAPITransportError`;
ungültige Eingaben, Antwortformate und Dateifehler werfen `Error`.
HTTP-Fehler mit gültigem API-Envelope werden als Werte zurückgegeben.

Alle vier Anfragen verwenden ausschließlich diese Zugangsdaten-Header:

```http
Authorization: Bearer <authKey>
X-Adapter-Key: <adapterKey>
```

`authKey` und `adapterKey` müssen nicht leere Strings aus druckbaren
ASCII-Zeichen von `0x21` bis `0x7E` sein. Leerzeichen sind auch innerhalb der
Schlüssel nicht erlaubt; das SDK weist sie vor einer HTTP-Anfrage ab.

Die Endpunkte sind jeweils `POST`:

| Methode | Endpunkt relativ zum Proxy-Präfix |
| --- | --- |
| `sendMail` / `sendMailList` | `/api/v2/send` |
| `sendPersonalizedMailBatch` | `/api/v2/send-batch` |
| `getMailHistory` | `/api/v2/history` |
| `downloadFile` | `/api/v2/files/download` |

`baseUrl` kann die Origin, ein Reverse-Proxy-Präfix oder eine vollständige alte
`…/api/send`- bzw. neue `…/api/v2/send`-URL sein. Auch `…/api/v2` wird unterstützt.
Das Präfix bleibt erhalten; es gibt keinen stillen Rückfall auf v1. URL-Zugangsdaten,
Query-Parameter und Fragmente werden abgewiesen.

## Versand

```ts
import { readFile } from 'node:fs/promises'

const id = 4711
const version = 2
const pdfBytes = await readFile('./Vertrag.pdf')

const response = await client.sendMail({
    idempotencyKey: `avv:${id}:v${version}:initial`,
    to: [
        { email: 'kunde@example.de', name: 'Erika Müller' },
        { email: 'team@example.de', name: null },
    ],
    cc: [],
    bcc: [],
    subject: 'Ihr Auftragsverarbeitungsvertrag',
    html: '<p>Guten Tag, anbei erhalten Sie Ihren Vertrag.</p>\n',
    attachments: [{
        filename: 'Vertrag.pdf',
        contentType: 'application/pdf',
        content: pdfBytes,
    }],
})

if (response.httpCode === 409) {
    console.log(response.data.error, response.data.code)
} else {
    console.log(response.data.queueIds, response.data.replayed)
}
```

`sendMailList(options)` ist ein Alias für `sendMail(options)` mit derselben
Objektstruktur. Es gibt keine positionalen Versandüberladungen in v2.

### Felder

| Feld | Bedeutung |
| --- | --- |
| `to` | Erforderliche, nicht leere Liste von `{ email, name? }` |
| `cc`, `bcc` | Optionale Adresslisten; BCC bleibt ein eigenes benanntes Wire-Feld |
| `replyTo` | Optionale Antwortadressliste desselben Formats |
| `subject` | Erforderlicher, nicht leerer Unicode-String ohne Steuerzeichen, höchstens 5000 Unicode-Zeichen (API-Limit) |
| `html` | Erforderlicher, nicht leerer Unicode-String |
| `text` | Optionaler Unicode-String; auch leer zulässig |
| `attachments` | Optionale Liste von `{ filename, contentType, content }` |
| `filterContext` | Optionaler String oder `null`, höchstens 1000 Unicode-Zeichen |
| `delayUntil` | Optional: `Date`, positive Epochensekunden als Zahl/String oder `null` |
| `idempotencyKey` | Optionaler exakter Geschäftsschlüssel, siehe unten |

Unbekannte Felder werden auch in Adressen, Anhängen und Batch-Optionen abgewiesen,
damit Tippfehler nicht unbemerkt bleiben. `undefined` bedeutet bei optionalen
Feldern „nicht angegeben“.

To, CC und BCC erlauben jeweils höchstens 100 rohe Einträge, Reply-To höchstens
10. E-Mail-Adressen werden mit PHP-ASCII-Trim normalisiert und kleingeschrieben;
Steuerzeichen werden vorher abgewiesen. Äußere Unicode-Leerzeichen wie NBSP oder
FEFF werden nicht entfernt und machen die Adresse ungültig. Die erste Adresse bleibt
bei Duplikaten erhalten: **To vor CC vor BCC**. Reply-To wird unabhängig dedupliziert.
Namen sind Strings oder `null`; ungültiges Unicode und Steuerzeichen sind nicht
zulässig. Namen werden mit PHP-ASCII-Trim normalisiert, leere Namen zu `null`.
Adressen verwenden ASCII-Mailboxen; internationale Domains als Punycode angeben.

Betreff, HTML und Text bleiben nach der Validierung unverändert, insbesondere
Leerzeichen und HTML-Zeilenenden. `filterContext` normalisiert CRLF/CR zu LF,
verwirft unerlaubte Steuerzeichen und trimmt wie PHP nur ASCII-Leerzeichen,
Tab, LF, CR, NUL und vertikalen Tab. Die Steuerzeichenprüfung erfolgt vor dem Trim;
NUL und vertikaler Tab sind deshalb nicht erlaubt. Unicode-Leerzeichen bleiben
erhalten. Ein leerer Kontext wird `null`.

`delayUntil` wird in ganze Epochensekunden umgewandelt; bei `Date` werden
Millisekunden abgerundet. Erlaubt ist 1 bis **253402300799** (SQL-DATETIME bis
Jahr 9999). Bruchteile, unsichere Zahlen, ungültige Datumsobjekte und numerische
Strings mit Restzeichen werden abgewiesen.

### Idempotenz

Der Schlüssel muss 1 bis 255 Unicode-Zeichen enthalten, darf keine Cc-Steuerzeichen
und keine äußeren PHP-ASCII-Trim-Zeichen enthalten. Das SDK trimmt oder verändert
ihn **nicht**; Groß-/Kleinschreibung und sonstige Unicode-Leerzeichen bleiben exakt.
Ohne Schlüssel wird keiner automatisch erzeugt.

- Derselbe Schlüssel und derselbe normalisierte Inhalt liefern den ursprünglichen
  Snapshot von IDs und Statuswerten mit `replayed: true` zurück.
- Derselbe Schlüssel mit anderem normalisierten Inhalt ergibt HTTP 409 mit
  `code: 'idempotency_conflict'` und einer menschenlesbaren deutschen Erklärung
  in `error` als API-Wert, nicht als Transportexception. Für die programmatische
  Erkennung `code` verwenden, nicht den Erklärungstext.
- Mit einem nicht-null Schlüssel umgeht der Server den zweiminütigen
  Hash-Duplikatfilter. Verschiedene Geschäftsschlüssel dürfen somit absichtlich
  identische Mails erzeugen. Ohne Schlüssel gilt der normale Duplikatfilter.
- Der Server speichert Snapshot, Queue-Einträge und Dateien atomar. Auch wenn ein
  Worker inzwischen den Status geändert hat, bleibt der Replay-Snapshot gleich.
  Für den aktuellen Status `getMailHistory` verwenden.

Das SDK speichert keine lokalen Idempotenz-Snapshots und erfindet keine IDs.

## Personalisierte Stapel

```ts
const batch = await client.sendPersonalizedMailBatch({
    filterContext: 'Vertragsunterlagen für bestehende Kunden',
    replyTo: [{ email: 'service@example.de', name: 'Kundenservice' }],
    cc: [],
    bcc: [{ email: 'ablage@example.de' }],
    attachments: [{ filename: 'Vertrag.pdf', contentType: 'application/pdf', content: pdfBytes }],
    messages: [
        {
            idempotencyKey: 'avv:4711:v2:initial',
            to: [{ email: 'erika@example.de', name: 'Erika Müller' }],
            subject: 'Vertrag für Erika',
            html: '<p>Guten Tag Frau Müller!</p>',
        },
        {
            idempotencyKey: 'avv:4712:v1:initial',
            to: [{ email: 'max@example.de', name: 'Max' }],
            subject: 'Vertrag für Max',
            html: '<p>Guten Tag Max!</p>',
            bcc: [],
            attachments: [],
            filterContext: null,
        },
    ],
})

for (const result of batch.data.results ?? []) {
    console.log(result.index, result.success, result.status, result.data)
}
```

Gemeinsame `attachments`, `filterContext`, `replyTo`, `cc` und `bcc` sind Defaults.
Ein Nachrichtenfeld ersetzt den jeweiligen Default vollständig; Listen werden
nicht angehängt. `[]` entfernt Listen-Defaults, `null` entfernt den Kontext und
`undefined` erbt den Default. Das SDK expandiert die Defaults vor dem Versand.
Auf dem Wire steht ausschließlich `{ messages: [vollständige Nachrichten] }`.

Teilweise erfolgreiche Batches bleiben unverändert auswertbar:
`data.results` enthält `{ index, success, status, data }`, wobei `status` der
HTTP-Status dieses Ergebnisses ist. Zusätzlich gibt es aggregierte `queueIds`
und `success`. Antworttypen bleiben für zukünftige Felder und Statuswerte offen.

## Anhänge und Wire-Format

`content` akzeptiert `Buffer` und `Uint8Array`, keine JSON-Zahlenarrays. Dateinamen
müssen pro Nachricht eindeutig sein, höchstens 500 Unicode-Zeichen enthalten und
dürfen weder `/`, `\`, `:` noch Steuerzeichen enthalten. MIME-Typen sind reine
`type/subtype`-Werte ohne Parameter und werden kleingeschrieben.

```ts
import { createAttachments, EmailAttachment } from '@reikem/mail-client'

const attachments = await createAttachments(['./Vertrag.pdf'])
// Auch client.createAttachments(paths) liest lesbare Dateien in Binärdeskriptoren.
// Für Migration weiterhin akzeptiert:
const legacy = new EmailAttachment('Vertrag.pdf', 'application/pdf', './Vertrag.pdf', 123)
```

Ohne Anhänge wird `application/json` gesendet. Mit Anhängen enthält Multipart
ein Textfeld `payload` mit dem JSON-Objekt und Binärteile `attachments[0]`,
`attachments[1]` usw. Jeder JSON-Anhang enthält ausschließlich
`{ filename, contentType, uploadIndex }`. Die Indizes sind numerisch und bei
Batches über alle Nachrichten hinweg fortlaufend. Gemeinsame Bytes dürfen dabei
mehrfach hochgeladen werden. Der Server unterstützt für direkte JSON-Aufrufer
auch Base64-Inhalte; das SDK verwendet bewusst Binär-Multipart.
Es gibt keine v1-Felder `config`, `auth_key`, `regard` oder `content` im Request.

## Verlauf

```ts
const history = await client.getMailHistory({
    dateFrom: '2026-11-01',
    dateTo: '2026-11-30',
    messageIds: ['9223372036854775807', 123],
})
// Nur IDs sind ebenfalls ausreichend:
await client.getMailHistory({ messageIds: '123, 456, 123' })

for (const entry of history.data.history?.Outbound ?? []) {
    console.log(entry.subject, entry.to, entry.status, entry.filterDetails)
}
```

Ohne IDs ist `dateFrom` erforderlich. Daten sind echte Kalenderdaten im Format
`YYYY-MM-DD` oder gültige `Date`-Objekte (UTC-Kalendertag). `dateFrom` darf nicht
nach `dateTo` liegen. IDs sind positive signed-64-bit-Werte bis
`9223372036854775807`; große IDs als Strings übergeben. Unsichere JavaScript-Zahlen
werden abgewiesen, IDs kanonisch als Dezimalstrings gesendet und dedupliziert.

Outbound-Einträge enthalten `subject`, `html`, `text`, `to`, `cc`, `bcc`, `replyTo`
und `idempotencyKey`; Adresslisten bestehen aus Objekten mit Namen. Legacy-Felder
bleiben gegebenenfalls erhalten. Inbound-/Antwort-Einträge bieten ebenfalls
`subject`-/`html`-Aliasse. `statuses`, `filterDetails`, Filterentscheidungen und
KI-Retry-Metadaten bleiben erhalten. `MailStatus`, `QueueStatus`, `MailEntry`,
`FilterResults`, `AIRetry` und `AIResult` sind exportiert.

## Downloads

```ts
const file = await client.downloadFile({
    source: 'outbound',
    fileId: '9223372036854775807',
    // optional: targetPath: './downloads/',
})
if ('success' in file && file.success === true) {
    console.log(file.fileName, file.bytes, file.content)
}
```

Ohne `targetPath` enthält das Ergebnis einen `Buffer`. Ein vorhandenes Verzeichnis
oder ein Pfad mit abschließendem Separator verwendet den Serverdateinamen;
sonst ist `targetPath` der genaue Zielpfad. Fehlende Elternverzeichnisse werden
erstellt. UTF-8-`filename*`, rohe UTF-8-Header und ältere Latin1-Namen werden
unterstützt; Pfadanteile werden entfernt. Nicht nutzbare Namen ergeben `download`.
HTTP-JSON-Fehler werden als API-Werte zurückgegeben. Eine als Datei gelieferte
200-JSON-Fehlerantwort wird abgewiesen, bevor eine Zieldatei überschrieben wird.

## Antworten und Migration

Antworten verwenden `{ status, data, httpCode }`; `httpCode` ist immer der echte
HTTP-Status. Versanddaten enthalten je nach Ergebnis `success`, `queueIds`,
`messageIds`, `smtpMessageIds`, `statuses`, `filters`, `idempotencyKey`, `replayed`
oder Fehlerdetails. Große numerische JSON-Tokens werden über den Source-Reviver
als exakte Strings erhalten, nicht gerundet. Neue Antwortfelder gehen nicht
verloren. Ungültige JSON-Antworten werden ohne Wiedergabe des Antwortkörpers
abgewiesen.

`SendResponse`, `BatchResponse`, `BatchResult`, `ApiResponse`, `SendData` und
`IdempotencyConflictResponse` sind als Typen exportiert. Der Konflikttyp beschreibt
HTTP 409 mit `IdempotencyConflictData` (`error: string`,
`code: 'idempotency_conflict'`); die tatsächliche Antwort weiterhin anhand
von `httpCode` und den Fehlerfeldern prüfen.

Migration von v1 ist ein bewusst brechender Wechsel:

| v1 | v2 |
| --- | --- |
| `new EmailAPIClient(url, auth, adapter)` | Optionsobjekt empfohlen; diese Konstruktorüberladung bleibt möglich |
| `sendMail(email, name, regard, content, ...)` | `sendMail({ to: [{ email, name }], subject, html, ... })` |
| `sendMailList({ [email]: name }, ...)` | `sendMail({ to: [{ email, name }], ... })` |
| `sendPersonalizedMailBatch(messages, attachments, ...)` | `sendPersonalizedMailBatch({ messages, attachments, ... })` |
| Nachrichtenaliase `recipient`, `regard`, `content`, `delay_until` | Nur `to`, `subject`, `html`, `delayUntil` |
| Reply-To-Map und CC-Stringliste | `replyTo` / `cc` / `bcc` als `{ email, name? }[]` |
| `getMailHistory(from, to, ids)` | `getMailHistory({ dateFrom, dateTo, messageIds })` |
| `downloadFile(source, id, path)` | `downloadFile({ source, fileId, targetPath })` |
| Dateimetadaten aus `createAttachments` | Bereits eingelesene Binärdeskriptoren; `EmailAttachment` bleibt als Adapter verfügbar |
| Ein v1-Multiplex-Endpunkt mit `config` | Vier feste v2-Endpunkte mit Header-Authentifizierung |

Die Paketbezeichnung bleibt `@reikem/mail-client`. Bestehende positionale
Versandaufrufe müssen geändert werden; ein unveränderter v1-Aufruf wird nicht
heimlich an die alte API geschickt.

## Entwicklung

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
bun run pack:check
```

Die Bun-Suiten verwenden lokale HTTP-/TCP-Server für JSON, Multipart,
Binärdownloads und Zeitlimits; ein laufender Mailserver ist nicht erforderlich.
