import assert from 'node:assert/strict'
import { test } from 'node:test'
import { actionPinsOnly, readUpdate } from './dependabot-metadata.ts'
import { reconcile } from './dependabot.ts'

function dependabotMessage(...types: string[]): string {
    const dependencies = types.map(
        (type, index) =>
            `- dependency-name: example-${index}\n  update-type: ${type}\n  dependency-group: security-updates`,
    )
    return [
        'chore(deps): bump dependencies',
        '',
        '---',
        'updated-dependencies:',
        ...dependencies,
        '...',
    ].join('\n')
}

test('classifies every dependency in a signed update, including grouped security updates', () => {
    assert.deepEqual(
        readUpdate(
            dependabotMessage(
                'version-update:semver-patch',
                'version-update:semver-minor',
            ),
        ),
        {
            levels: ['patch', 'minor'],
            security: true,
            eligible: true,
        },
    )
    assert.equal(
        readUpdate(
            dependabotMessage(
                'version-update:semver-patch',
                'version-update:semver-major',
            ),
        ).eligible,
        false,
    )
    assert.equal(
        readUpdate(dependabotMessage('version-update:semver-patch', 'unknown'))
            .eligible,
        false,
    )
    assert.equal(readUpdate('chore(deps): bump dependencies').eligible, false)
})

test('requires review for a major version even if upstream metadata reports a patch', () => {
    const metadata = dependabotMessage('version-update:semver-patch')
    const message = metadata.replace(
        '\n\n',
        '\n\nBumps example-0 from v1.9.9 to v2.0.0.\n\n',
    )
    assert.deepEqual(readUpdate(message).levels, ['major'])
    assert.equal(readUpdate(message).eligible, false)
})

test('allows pinned ref updates without allowing workflow edits or action substitutions', () => {
    const before = `-    uses: actions/checkout@${'a'.repeat(40)} # v7.0.0`
    const after = `+    uses: actions/checkout@${'b'.repeat(40)} # v7.0.1`
    assert.equal(actionPinsOnly(`@@ -1 +1 @@\n${before}\n${after}`), true)
    assert.equal(
        actionPinsOnly(`${before}\n${after}\n+    run: echo changed`),
        false,
    )
    assert.equal(
        actionPinsOnly(`${before}\n${after.replace('checkout', 'cache')}`),
        false,
    )
    assert.equal(
        actionPinsOnly(`${before}\n+    uses: actions/checkout@main`),
        false,
    )
})

type Scenario = {
    update?: string
    author?: string
    committer?: string
    conclusion?: string
    behind?: number
    conflict?: boolean
    headChanged?: boolean
    matchPull?: boolean
}

async function reconcileFixture(scenario: Scenario = {}) {
    const repository = 'owner/library'
    const bot = 'dependabot[bot]'
    const head = 'a'.repeat(40)
    const base = 'b'.repeat(40)
    const headBranch = 'dependabot/bun/routine-updates-01'
    const pr = {
        number: 1,
        user: { login: scenario.author ?? bot },
        draft: false,
        state: 'open',
        head: { ref: headBranch, sha: head, repo: { full_name: repository } },
        base: { ref: 'main', sha: base, repo: { full_name: repository } },
        mergeable: !scenario.conflict,
        commits: 1,
        changed_files: 1,
    }
    let prReads = 0
    const api = async <T>(path: string): Promise<T> => {
        if (path === 'actions/workflows/ci.yml')
            return { id: 1, path: '.github/workflows/ci.yml' } as T
        if (path.startsWith('pulls?')) return [pr] as T
        if (path === 'pulls/1') {
            prReads++
            if (scenario.headChanged && prReads > 1) {
                return { ...pr, head: { ...pr.head, sha: 'c'.repeat(40) } } as T
            }
            return pr as T
        }
        if (path.startsWith('pulls/1/commits')) {
            return [
                {
                    sha: head,
                    author: { login: bot },
                    committer: { login: scenario.committer ?? 'web-flow' },
                    parents: [{ sha: base }],
                    commit: {
                        verification: { verified: true },
                        message: dependabotMessage(
                            scenario.update ?? 'version-update:semver-patch',
                        ),
                    },
                },
            ] as T
        }
        if (path.startsWith('pulls/1/files'))
            return [{ filename: 'bun.lock', status: 'modified' }] as T
        if (path.startsWith('compare/'))
            return { behind_by: scenario.behind ?? 0 } as T
        if (path.startsWith('actions/workflows/1/runs?')) {
            return {
                workflow_runs: [
                    {
                        id: 2,
                        workflow_id: 1,
                        path: '.github/workflows/ci.yml',
                        run_attempt: 1,
                        event: 'pull_request',
                        status: 'completed',
                        conclusion: 'success',
                        head_branch: headBranch,
                        head_sha: head,
                        head_repository: { full_name: repository },
                        pull_requests:
                            scenario.matchPull === false ? [{ number: 2 }] : [],
                    },
                ],
            } as T
        }
        if (path.startsWith('actions/runs/2/attempts/1/jobs?')) {
            return {
                jobs: [
                    {
                        name: 'Package checks',
                        status: 'completed',
                        conclusion: 'success',
                    },
                    {
                        name: 'Dependency security',
                        status: 'completed',
                        conclusion: scenario.conclusion ?? 'success',
                    },
                ],
            } as T
        }
        if (path.startsWith('pulls/1/reviews?')) return [] as T
        throw new Error(`Unexpected read ${path}`)
    }
    const writes: {
        path: string
        method: string | undefined
        body: object | undefined
    }[] = []
    const app = async <T>(
        path: string,
        method?: string,
        body?: object,
    ): Promise<T> => {
        writes.push({ path, method, body })
        return { merged: true } as T
    }
    await reconcile(api, app, repository, 'merge-app[bot]')
    return { writes, head }
}

test('reviews and squash-merges exactly the head that passed both CI jobs', async () => {
    const { writes, head } = await reconcileFixture()
    assert.deepEqual(writes, [
        {
            path: 'pulls/1/reviews',
            method: 'POST',
            body: { event: 'APPROVE', commit_id: head },
        },
        {
            path: 'pulls/1/merge',
            method: 'PUT',
            body: { sha: head, merge_method: 'squash' },
        },
    ])
})

test('updates a clean outdated branch and waits for checks on the new head', async () => {
    const { writes, head } = await reconcileFixture({ behind: 1 })
    assert.deepEqual(writes, [
        {
            path: 'pulls/1/update-branch',
            method: 'PUT',
            body: { expected_head_sha: head },
        },
    ])
})

test('skips merges on failed security checks, major updates, human commits and head changes', async () => {
    const scenarios = [
        { conclusion: 'failure' },
        { conclusion: 'skipped' },
        { update: 'version-update:semver-major' },
        { author: 'contributor' },
        { committer: 'contributor' },
        { matchPull: false },
        { conflict: true, behind: 1 },
        { headChanged: true },
        { headChanged: true, behind: 1 },
    ]
    for (const scenario of scenarios) {
        const { writes } = await reconcileFixture(scenario)
        assert.deepEqual(writes, [], JSON.stringify(scenario))
    }
})
