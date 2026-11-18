import { isDeepStrictEqual } from 'node:util'
import { actionPinsOnly, readUpdate, signedBy } from './dependabot-metadata.ts'
import type { UpdateMetadata } from './dependabot-metadata.ts'

const dependabot = 'dependabot[bot]'
const autofix = 'autofix-ci[bot]'
const ciPath = '.github/workflows/ci.yml'
const requiredJobs = ['Package checks', 'Dependency security']
const managedLabels = [
    'patch',
    'minor',
    'major',
    'security',
    'automerge',
    'manual-review',
]

type Repository = { full_name: string }
type Ref = { ref: string; sha: string; repo: Repository | null }
type Pull = {
    number: number
    state: string
    draft: boolean
    user: { login: string }
    base: Ref
    head: Ref
    body: string | null
    labels: { name: string }[]
    mergeable: boolean | null
    commits: number
    changed_files: number
}
type Commit = Parameters<typeof signedBy>[0] & {
    sha: string
    parents: { sha: string }[]
    commit: { message: string }
}
type File = { filename: string; status: string; patch?: string }
type Run = {
    id: number
    workflow_id: number
    path: string
    run_attempt: number
    event: string
    status: string
    conclusion: string | null
    head_branch: string
    head_sha: string
    head_repository: Repository | null
    pull_requests: { number: number }[]
}
type Review = {
    user: { login: string } | null
    state: string
    commit_id: string
}
type Job = { name: string; status: string; conclusion: string | null }
type Comparison = { behind_by: number }

class GitHubError extends Error {
    constructor(
        readonly status: number,
        method: string,
    ) {
        super(`GitHub ${method} request returned HTTP ${status}`)
    }
}

function client(token: string, repository: string) {
    return async function request<T>(
        path: string,
        method = 'GET',
        body?: object,
    ): Promise<T> {
        const response = await fetch(
            `https://api.github.com/repos/${repository}/${path}`,
            {
                method,
                redirect: 'error',
                headers: {
                    Accept: 'application/vnd.github+json',
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'X-GitHub-Api-Version': '2026-03-10',
                },
                ...(body ? { body: JSON.stringify(body) } : {}),
            },
        )
        if (!response.ok) throw new GitHubError(response.status, method)
        return (
            response.status === 204 ? undefined : await response.json()
        ) as T
    }
}

type Client = ReturnType<typeof client>

function sha(value: string): boolean {
    return /^[a-f0-9]{40}$/.test(value)
}

function ecosystem(
    pr: Pull,
    repository: string,
): 'bun' | 'github_actions' | undefined {
    if (
        pr.state !== 'open' ||
        pr.user.login !== dependabot ||
        pr.base.ref !== 'main' ||
        pr.base.repo?.full_name !== repository ||
        pr.head.repo?.full_name !== repository ||
        !sha(pr.head.sha) ||
        !sha(pr.base.sha)
    )
        return undefined
    if (pr.head.ref.startsWith('dependabot/bun/')) return 'bun'
    if (pr.head.ref.startsWith('dependabot/github_actions/'))
        return 'github_actions'
}

async function* pages<T>(api: Client, path: string): AsyncGenerator<T> {
    const separator = path.includes('?') ? '&' : '?'
    for (let page = 1; ; page++) {
        const values = await api<T[]>(
            `${path}${separator}per_page=100&page=${page}`,
        )
        yield* values
        if (values.length < 100) return
    }
}

async function readManifest(api: Client, ref: string): Promise<unknown> {
    const file = await api<{ encoding: string; content: string }>(
        `contents/package.json?ref=${ref}`,
    )
    if (file.encoding !== 'base64')
        throw new Error('Expected a base64-encoded manifest')
    return JSON.parse(
        Buffer.from(file.content, 'base64').toString('utf8'),
    ) as unknown
}

async function formattingOnly(api: Client, commit: Commit): Promise<boolean> {
    const parent = commit.parents[0]?.sha
    if (!parent || !sha(parent) || commit.parents.length !== 1) return false
    const details = await api<{ files: File[] }>(`commits/${commit.sha}`)
    if (
        details.files.length !== 1 ||
        details.files[0]?.filename !== 'package.json'
    )
        return false
    const manifests = await Promise.all([
        readManifest(api, parent),
        readManifest(api, commit.sha),
    ])
    return isDeepStrictEqual(manifests[0], manifests[1])
}

async function verifiedUpdates(
    api: Client,
    pr: Pull,
    appLogin: string,
): Promise<UpdateMetadata[]> {
    const commits = await api<Commit[]>(
        `pulls/${pr.number}/commits?per_page=100`,
    )
    if (
        !commits.length ||
        commits.length !== pr.commits ||
        commits.at(-1)?.sha !== pr.head.sha
    )
        return []

    const updates: UpdateMetadata[] = []
    for (const commit of commits) {
        if (!sha(commit.sha)) return []
        if (commit.parents.length === 1 && signedBy(commit, dependabot)) {
            updates.push(readUpdate(commit.commit.message))
            continue
        }
        if (!updates.length) return []
        if (signedBy(commit, autofix) && (await formattingOnly(api, commit)))
            continue
        const mergedBase = commit.parents[1]?.sha
        if (
            commit.parents.length === 2 &&
            mergedBase &&
            sha(mergedBase) &&
            (signedBy(commit, appLogin) || signedBy(commit, dependabot))
        ) {
            const comparison = await api<Comparison>(
                `compare/${mergedBase}...${pr.base.sha}?per_page=1`,
            )
            if (comparison.behind_by === 0) continue
        }
        return []
    }
    return updates
}

async function validFiles(
    api: Client,
    pr: Pull,
    kind: 'bun' | 'github_actions',
): Promise<boolean> {
    const files = await api<File[]>(`pulls/${pr.number}/files?per_page=100`)
    if (
        files.length !== pr.changed_files ||
        files.some((file) => file.status !== 'modified')
    )
        return false
    if (kind === 'bun') {
        return (
            files.some((file) => file.filename === 'bun.lock') &&
            files.every((file) =>
                ['package.json', 'bun.lock'].includes(file.filename),
            )
        )
    }
    return (
        files.length > 0 &&
        files.every((file) => {
            return (
                /^\.github\/workflows\/[\w.-]+\.ya?ml$/.test(file.filename) &&
                actionPinsOnly(file.patch)
            )
        })
    )
}

async function decide(
    api: Client,
    pr: Pull,
    kind: 'bun' | 'github_actions',
    appLogin: string,
) {
    const [updates, scoped] = await Promise.all([
        verifiedUpdates(api, pr, appLogin),
        validFiles(api, pr, kind),
    ])
    return {
        verified: updates.length > 0 && scoped,
        eligible:
            updates.length > 0 &&
            scoped &&
            updates.every((update) => update.eligible) &&
            !pr.draft &&
            !pr.body?.includes('Maintainer changes'),
        levels: updates.flatMap((update) => update.levels),
        security:
            updates.some((update) => update.security) ||
            (updates.length > 0 &&
                /\*\*This update includes (?:a security fix|security fixes)\.\*\*/.test(
                    pr.body ?? '',
                )),
    }
}

async function label(
    api: Client,
    repository: string,
    appLogin: string,
    number: number,
    expectedHead: string,
) {
    const pull = `pulls/${number}`
    const pr = await api<Pull>(pull)
    if (
        pr.state !== 'open' ||
        pr.base.ref !== 'main' ||
        pr.head.sha !== expectedHead
    )
        return

    const issue = `issues/${number}/labels`
    const existing = new Set(pr.labels.map((item) => item.name))
    const desired = new Set<string>()
    // GitHub supplies the workflow actor for the app's synchronize event.
    if (process.env.GITHUB_ACTOR === autofix) desired.add('autofix')
    const kind = ecosystem(pr, repository)
    if (kind) {
        const decision = await decide(api, pr, kind, appLogin)
        desired.add('dependencies')
        desired.add(kind === 'bun' ? 'typescript' : 'github-actions')
        for (const level of decision.levels) desired.add(level)
        if (decision.security) desired.add('security')
        desired.add(decision.eligible ? 'automerge' : 'manual-review')
    }

    const fresh = await api<Pull>(pull)
    if (fresh.head.sha !== pr.head.sha || fresh.state !== 'open') return
    const additions = Array.from(desired).filter((name) => !existing.has(name))
    if (additions.length) await api(issue, 'POST', { labels: additions })
    if (kind) {
        for (const name of managedLabels) {
            if (existing.has(name) && !desired.has(name)) {
                await writeIfCurrent(
                    api,
                    `${issue}/${name}`,
                    'DELETE',
                    undefined,
                    [404],
                )
            }
        }
    }
}

export function matchingRun(
    run: Run,
    pr: Pick<Pull, 'number' | 'head'>,
    workflowId: number,
): boolean {
    return (
        run.workflow_id === workflowId &&
        run.path === ciPath &&
        run.event === 'pull_request' &&
        run.head_branch === pr.head.ref &&
        run.head_sha === pr.head.sha &&
        run.head_repository?.full_name === pr.head.repo?.full_name &&
        (run.pull_requests.length === 0 ||
            run.pull_requests.some((pull) => pull.number === pr.number))
    )
}

async function ciPassed(
    api: Client,
    pr: Pull,
    workflow: { id: number; path: string },
): Promise<boolean> {
    if (workflow.path !== ciPath || !Number.isSafeInteger(workflow.id))
        return false
    const query = new URLSearchParams({
        event: 'pull_request',
        head_sha: pr.head.sha,
        per_page: '30',
    })
    const { workflow_runs } = await api<{ workflow_runs: Run[] }>(
        `actions/workflows/${workflow.id}/runs?${query}`,
    )
    const run = workflow_runs.find((candidate) =>
        matchingRun(candidate, pr, workflow.id),
    )
    if (run?.status !== 'completed' || run.conclusion !== 'success')
        return false
    const { jobs } = await api<{ jobs: Job[] }>(
        `actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,
    )
    return requiredJobs.every((required) => {
        const matches = jobs.filter((job) => job.name === required)
        return (
            matches.length === 1 &&
            matches[0]?.status === 'completed' &&
            matches[0]?.conclusion === 'success'
        )
    })
}

async function writeIfCurrent(
    api: Client,
    path: string,
    method: string,
    body: object | undefined,
    retryable: number[],
) {
    try {
        return { value: await api<{ merged?: boolean }>(path, method, body) }
    } catch (error) {
        if (error instanceof GitHubError && retryable.includes(error.status)) {
            console.log(
                `GitHub deferred ${method} ${path} (HTTP ${error.status}).`,
            )
            return undefined
        }
        throw error
    }
}

function current(pr: Pull, previous: Pull, repository: string): boolean {
    return (
        Boolean(ecosystem(pr, repository)) &&
        !pr.draft &&
        pr.mergeable === true &&
        pr.head.sha === previous.head.sha &&
        pr.base.sha === previous.base.sha
    )
}

export async function reconcile(
    api: Client,
    app: Client,
    repository: string,
    appLogin: string,
) {
    const workflow = await api<{ id: number; path: string }>(
        'actions/workflows/ci.yml',
    )
    for await (const summary of pages<Pull>(
        api,
        'pulls?state=open&base=main',
    )) {
        if (!ecosystem(summary, repository) || summary.draft) continue
        const path = `pulls/${summary.number}`
        const pr = await api<Pull>(path)
        const kind = ecosystem(pr, repository)
        if (!kind || pr.draft || pr.mergeable !== true) continue
        const decision = await decide(api, pr, kind, appLogin)
        if (!decision.verified) continue

        const comparison = await api<Comparison>(
            `compare/${pr.base.sha}...${pr.head.sha}?per_page=1`,
        )
        if (comparison.behind_by > 0) {
            if (!current(await api<Pull>(path), pr, repository)) continue
            await writeIfCurrent(
                app,
                `${path}/update-branch`,
                'PUT',
                { expected_head_sha: pr.head.sha },
                [409, 422],
            )
            continue
        }
        if (!decision.eligible || !(await ciPassed(api, pr, workflow))) continue

        const reviews = await api<Review[]>(`${path}/reviews?per_page=100`)
        const ownReview = reviews.findLast(
            (review) =>
                review.user?.login === appLogin && review.state !== 'COMMENTED',
        )
        const fresh = await api<Pull>(path)
        if (
            !current(fresh, pr, repository) ||
            fresh.body?.includes('Maintainer changes')
        )
            continue
        if (
            ownReview?.state !== 'APPROVED' ||
            ownReview.commit_id !== pr.head.sha
        ) {
            const review = await writeIfCurrent(
                app,
                `${path}/reviews`,
                'POST',
                { event: 'APPROVE', commit_id: pr.head.sha },
                [409, 422],
            )
            if (!review) continue
        }
        if (!current(await api<Pull>(path), pr, repository)) continue

        // Never leave auto-merge armed for a later head. GitHub still enforces the ruleset.
        const merge = await writeIfCurrent(
            app,
            `${path}/merge`,
            'PUT',
            { sha: pr.head.sha, merge_method: 'squash' },
            [405, 409, 422],
        )
        if (merge?.value.merged)
            console.log(`Squash-merged verified Dependabot PR #${pr.number}.`)
    }
}

if (import.meta.main) {
    const repository = process.env.GITHUB_REPOSITORY
    const token = process.env.GH_TOKEN
    const appSlug = process.env.MERGE_APP_SLUG
    if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !token)
        throw new Error('Missing GitHub context')
    const appLogin =
        appSlug && /^[\w-]+$/.test(appSlug) ? `${appSlug}[bot]` : ''
    const api = client(token, repository)
    if (process.argv[2] === 'label') {
        const number = Number(process.env.PR_NUMBER)
        const head = process.env.EVENT_HEAD
        if (!Number.isSafeInteger(number) || number < 1 || !head || !sha(head))
            throw new Error('Invalid pull request event')
        await label(api, repository, appLogin, number, head)
    } else if (process.argv[2] === 'reconcile') {
        const appToken = process.env.MERGE_APP_TOKEN
        if (
            process.env.GITHUB_REF !== 'refs/heads/main' ||
            !appLogin ||
            !appToken
        )
            throw new Error('Missing trusted merge app context')
        await reconcile(api, client(appToken, repository), repository, appLogin)
    } else {
        throw new Error('Expected label or reconcile')
    }
}
