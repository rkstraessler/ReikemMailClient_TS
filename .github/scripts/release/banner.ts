import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repository = 'rkstraessler/ReikemMailClient_TS'
const assetName = 'new-release-banner.png'
const assetPath = fileURLToPath(
    new URL(`../../assets/release-banners/${assetName}`, import.meta.url),
)
const marker = '<!-- reikem-release-banner -->'

type Release = {
    id: number
    tag_name: string
    body: string | null
    draft: boolean
    prerelease: boolean
    assets: { name: string; digest: string; state: string }[]
}

function gh(args: string[], input?: string): string {
    return execFileSync('gh', args, { encoding: 'utf8', input })
}

function release(tag: string): Release {
    const result = JSON.parse(
        gh(['api', `repos/${repository}/releases/tags/${tag}`]),
    ) as Release
    if (
        !Number.isSafeInteger(result.id) ||
        result.tag_name !== tag ||
        result.draft ||
        result.prerelease
    ) {
        throw new Error('Expected an existing stable GitHub release')
    }
    return result
}

const tag = process.argv[2]
if (!tag || !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) {
    throw new Error('Expected a release tag of the form vMAJOR.MINOR.PATCH')
}
if (
    process.env.GITHUB_REPOSITORY &&
    process.env.GITHUB_REPOSITORY !== repository
) {
    throw new Error('Unexpected release repository')
}

const initial = release(tag)
if (process.env.RELEASE_ID && Number(process.env.RELEASE_ID) !== initial.id) {
    throw new Error('The released GitHub object has changed')
}
const notes = initial.body ?? ''
const banner = `${marker}\n![REIKEM Mail Client for TypeScript – Release Notes](https://github.com/${repository}/releases/download/${tag}/${assetName})\n${marker}`
const managedStart = notes.indexOf(marker)
const managedEnd = notes.indexOf(marker, managedStart + marker.length)
if (
    managedStart >= 0 &&
    (managedEnd < 0 || notes.indexOf(marker, managedEnd + marker.length) >= 0)
) {
    throw new Error('The release contains invalid banner markers')
}
const body =
    managedStart < 0
        ? `${banner}${notes ? `\n\n${notes}` : ''}`
        : `${notes.slice(0, managedStart)}${banner}${notes.slice(managedEnd + marker.length)}`

const digest = `sha256:${createHash('sha256').update(readFileSync(assetPath)).digest('hex')}`
if (!initial.assets.some((asset) => asset.name === assetName)) {
    gh(['release', 'upload', tag, assetPath, '--repo', repository])
}
const fresh = release(tag)
const asset = fresh.assets.find((item) => item.name === assetName)
if (asset?.state !== 'uploaded' || asset.digest !== digest) {
    throw new Error(
        'The GitHub release banner does not match the committed image',
    )
}
if (fresh.id !== initial.id || (fresh.body ?? '') !== notes) {
    throw new Error('The release changed while applying the banner')
}
if (body !== notes) {
    const updated = JSON.parse(
        gh(
            [
                'api',
                '--method',
                'PATCH',
                `repos/${repository}/releases/${fresh.id}`,
                '--input',
                '-',
            ],
            JSON.stringify({ body }),
        ),
    ) as Release
    if (updated.id !== fresh.id || updated.body !== body)
        throw new Error('GitHub did not save the expected release notes')
}
console.log(`Verified release banner for ${tag}.`)
