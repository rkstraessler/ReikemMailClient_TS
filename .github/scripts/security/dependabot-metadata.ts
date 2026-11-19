declare const Bun: { YAML: { parse(text: string): unknown } }

const updateTypes = {
    'version-update:semver-patch': 'patch',
    'version-update:semver-minor': 'minor',
    'version-update:semver-major': 'major',
} as const

type UpdateLevel = (typeof updateTypes)[keyof typeof updateTypes]

export interface UpdateMetadata {
    levels: UpdateLevel[]
    security: boolean
    eligible: boolean
}

interface VerifiedCommit {
    author: { login: string } | null
    committer: { login: string } | null
    commit: { verification: { verified: boolean } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function signedBy(commit: VerifiedCommit, login: string): boolean {
    return (
        commit.commit.verification.verified &&
        commit.author?.login === login &&
        (commit.committer?.login === login ||
            commit.committer?.login === 'web-flow')
    )
}

function stableVersion(value: unknown): [bigint, bigint, bigint] | undefined {
    if (typeof value !== 'string') return undefined
    const version =
        /^v?(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)$/.exec(
            value,
        )
    const { major, minor, patch } = version?.groups ?? {}
    if (major && minor && patch)
        return [BigInt(major), BigInt(minor), BigInt(patch)]
}

function semver(previous: unknown, next: unknown) {
    const from = stableVersion(previous)
    const to = stableVersion(next)
    if (!from || !to) return undefined
    if (to[0] !== from[0]) {
        if (to[0] > from[0])
            return { level: 'major', compatible: false } as const
        return undefined
    }
    if (to[1] !== from[1]) {
        if (to[1] > from[1])
            return { level: 'minor', compatible: from[0] > 0n } as const
        return undefined
    }
    if (to[2] > from[2]) return { level: 'patch', compatible: true } as const
}

export function readUpdate(message: string): UpdateMetadata {
    // Dependabot records update data in its signed commit, even for grouped PRs.
    const metadata = /^---\r?\n([\s\S]+?)\r?\n^\.\.\.$/m.exec(message)?.[1]
    const noUpdate = { levels: [], security: false, eligible: false }
    if (!metadata) return noUpdate

    let parsed: unknown
    try {
        parsed = Bun.YAML.parse(metadata)
    } catch {
        return noUpdate
    }
    if (!isRecord(parsed)) return noUpdate
    const entries: unknown = parsed['updated-dependencies']
    if (!Array.isArray(entries) || !entries.length) return noUpdate
    const security = entries.some(
        (entry: unknown) =>
            isRecord(entry) &&
            typeof entry['dependency-group'] === 'string' &&
            /^(?:security-updates|security-actions|(?:typescript|actions)-security(?:-compatible)?)$/.test(
                entry['dependency-group'],
            ),
    )

    const versions = Array.from(
        message.matchAll(
            /^Updates `([^`\s]+)` from `?([^`\s]+)`? to `?([^`\s]+)`?[ \t]*$/gm,
        ),
    )
    const single =
        /^Bumps .+ from `?([^`\s]+)`? to `?([^`\s]+)`?\.[ \t]*$/m.exec(message)
    const changes = entries.map((entry: unknown) => {
        if (!isRecord(entry) || typeof entry['dependency-name'] !== 'string')
            return undefined
        const reported = entry['update-type']
        const version = versions.find(
            (update) => update[1] === entry['dependency-name'],
        )
        const previous =
            version?.[2] ?? (entries.length === 1 ? single?.[1] : undefined)
        const next =
            version?.[3] ?? (entries.length === 1 ? single?.[2] : undefined)
        const inferred = semver(previous, next)
        const declared =
            typeof reported === 'string' && Object.hasOwn(updateTypes, reported)
                ? updateTypes[reported as keyof typeof updateTypes]
                : undefined
        return {
            level: inferred?.level ?? declared,
            eligible:
                inferred?.compatible === true &&
                inferred.level === declared &&
                next === entry['dependency-version'],
        }
    })
    return {
        levels: Array.from(
            new Set(
                changes.flatMap((change) =>
                    change?.level ? [change.level] : [],
                ),
            ),
        ),
        security,
        eligible: changes.every((change) => change?.eligible === true),
    }
}

export function actionPinsOnly(patch: string | undefined): boolean {
    if (!patch) return false
    const removed: string[] = []
    const added: string[] = []
    for (const line of patch.split('\n')) {
        if (!line.startsWith('-') && !line.startsWith('+')) continue
        const pin =
            /^[-+](\s*(?:-\s*)?uses:\s+[\w./-]+)@[a-f0-9]{40}(?:\s+#.*)?\s*$/.exec(
                line,
            )
        if (!pin?.[1]) return false
        const pins = line.startsWith('+') ? added : removed
        pins.push(pin[1])
    }
    return (
        removed.length > 0 &&
        removed.length === added.length &&
        removed.every((pin, index) => pin === added[index])
    )
}
