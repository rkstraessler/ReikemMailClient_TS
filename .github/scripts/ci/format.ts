import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, lstatSync } from 'node:fs'

const configs = [
    'package.json',
    'tsconfig.json',
    'tsconfig.type-tests.json',
    '.oxlintrc.json',
    'bunfig.toml',
]

function git(...args: string[]): string {
    return execFileSync('git', args, { encoding: 'utf8' })
}

function paths(...args: string[]): string[] {
    return git(...args)
        .split('\0')
        .filter(Boolean)
}

function runBun(...args: string[]): void {
    const result = spawnSync(process.execPath, ['--no-env-file', ...args], {
        stdio: 'inherit',
    })
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status ?? 1)
}

const mode = process.argv[2]
if (mode !== 'check' && mode !== 'fix') throw new Error('Expected check or fix')

const base = process.env.FORMAT_BASE || 'HEAD'
if (base !== 'HEAD' && !/^[a-f0-9]{40}$/.test(base))
    throw new Error('Invalid formatting base')
const start = /^0{40}$/.test(base)
    ? 'HEAD'
    : git('merge-base', base, 'HEAD').trim()
const changed = paths(
    'diff',
    '--name-only',
    '--diff-filter=ACMR',
    '-z',
    start,
    '--',
    'src',
    'test',
    ...configs,
)
const sources = changed.filter(
    (path) => path.endsWith('.ts') && !/\.(?:gen|generated)\./.test(path),
)
const fixable = [
    ...sources,
    ...changed.filter((path) => configs.includes(path)),
]

for (const path of fixable) {
    if (!lstatSync(path).isFile())
        throw new Error('Formatting requires regular files')
}

if (mode === 'check') {
    runBun(
        'fmt',
        '--no-script',
        '--check',
        ...configs,
        '.github/scripts',
        ...sources,
    )
} else {
    if (sources.length)
        runBun('x', '--no-install', 'oxlint', '--fix', ...sources)
    if (fixable.length) runBun('fmt', '--no-script', ...fixable)

    const output = process.env.GITHUB_OUTPUT
    if (output) {
        // The app collects the whole diff. Accept only the selected tracked files.
        const modified = paths('diff', '--name-only', '-z', 'HEAD')
        const untracked = paths(
            'ls-files',
            '--others',
            '--exclude-standard',
            '-z',
        )
        if (
            untracked.length ||
            modified.some((path) => !fixable.includes(path))
        ) {
            throw new Error(
                'Autofix produced changes outside the selected files',
            )
        }
        appendFileSync(output, `changed=${modified.length > 0}\n`)
    }
}
