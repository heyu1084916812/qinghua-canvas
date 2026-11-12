import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'

const workflowPath = fileURLToPath(
  new URL('../.github/workflows/ci.yml', import.meta.url),
)
const source = readFileSync(workflowPath, 'utf8')
const lines = source.split(/\r?\n/)

const indentOf = (line) => line.match(/^ */)[0].length

function scalar(value) {
  return value
    .trim()
    .replace(/\s+#.*$/, '')
    .replace(/^(['"])(.*)\1$/, '$2')
}

function topLevelBlock(key) {
  const start = lines.findIndex((line) =>
    new RegExp(`^${key}:\\s*(?:#.*)?$`).test(line),
  )
  assert.notEqual(start, -1, `missing top-level ${key}: block`)

  let end = start + 1
  while (end < lines.length && !/^[A-Za-z0-9_-]+:\s*(?:#.*)?$/.test(lines[end])) {
    end += 1
  }
  return lines.slice(start + 1, end)
}

function mappingAtIndent(block, indent) {
  const entries = new Map()
  for (const line of block) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const match = line.match(/^(\s+)([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match || match[1].length !== indent) continue
    entries.set(match[2], scalar(match[3]))
  }
  return entries
}

function parseJobs() {
  const jobsBlock = topLevelBlock('jobs')
  const jobs = new Map()

  for (let index = 0; index < jobsBlock.length; index += 1) {
    const header = jobsBlock[index].match(
      /^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/,
    )
    if (!header) continue

    let end = index + 1
    while (
      end < jobsBlock.length &&
      !/^ {2}[A-Za-z0-9_-]+:\s*(?:#.*)?$/.test(jobsBlock[end])
    ) {
      end += 1
    }
    jobs.set(header[1], jobsBlock.slice(index + 1, end))
    index = end - 1
  }

  return jobs
}

function parseSteps(jobName, jobLines) {
  const stepsIndex = jobLines.findIndex((line) => /^ {4}steps:\s*$/.test(line))
  assert.notEqual(stepsIndex, -1, `${jobName} must declare steps`)

  const steps = []
  let current = null

  for (const line of jobLines.slice(stepsIndex + 1)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const indent = indentOf(line)
    if (indent <= 4) break

    const first = line.match(/^ {6}- ([A-Za-z0-9_-]+):\s*(.*)$/)
    if (first) {
      current = { [first[1]]: scalar(first[2]) }
      steps.push(current)
      continue
    }

    const property = line.match(/^ {8}([A-Za-z0-9_-]+):\s*(.*)$/)
    if (property && current) {
      current[property[1]] = scalar(property[2])
    }
  }

  return steps
}

const jobs = parseJobs()
const parsedJobs = new Map(
  [...jobs].map(([name, jobLines]) => [name, {
    lines: jobLines,
    runsOn: mappingAtIndent(jobLines, 4).get('runs-on'),
    steps: parseSteps(name, jobLines),
  }]),
)

it('declares the required triggers and read-only contents permission', () => {
  const triggers = mappingAtIndent(topLevelBlock('on'), 2)
  assert.deepEqual(
    [...triggers.keys()].sort(),
    ['pull_request', 'push', 'workflow_dispatch'],
  )

  const permissions = mappingAtIndent(topLevelBlock('permissions'), 2)
  assert.equal(permissions.get('contents'), 'read')
  assert.ok(
    [...permissions.values()].every((value) => value === 'read'),
    'CI permissions must remain read-only',
  )
})

it('Linux verify job runs the required Node delivery gates', () => {
  const verify = parsedJobs.get('verify')
  assert.equal(verify?.runsOn, 'ubuntu-latest')
  const runs = verify.steps.flatMap((step) => step.run ? [step.run] : [])

  for (const command of [
    'npm ci',
    'npm test',
    'npm run check',
    'node scripts/check-versions.mjs',
    'npm run build',
  ]) {
    assert.ok(runs.includes(command), `Linux verify job is missing: ${command}`)
  }
  assert.match(
    verify.lines.join('\n'),
    /uses:\s*actions\/checkout@v4\s*\n\s+with:\s*\n\s+fetch-depth:\s*0/,
    'Linux verify job needs full history for module-governance baseline checks',
  )
})

it('Windows job runs Tauri Rust and both MCP harnesses', () => {
  const windows = parsedJobs.get('windows-rust-mcp')
  assert.equal(windows?.runsOn, 'windows-latest')
  const runs = windows.steps.flatMap((step) => step.run ? [step.run] : [])

  for (const command of [
    'npm ci',
    'npm run prepare:ffmpeg',
    'cargo test --manifest-path src-tauri/Cargo.toml',
    'npm run test:canvas-mcp',
    'npm run test:canvas-mcp:inspector',
  ]) {
    assert.ok(runs.includes(command), `Windows job is missing: ${command}`)
  }
  assert.ok(
    runs.indexOf('npm run prepare:ffmpeg') <
      runs.indexOf('cargo test --manifest-path src-tauri/Cargo.toml'),
    'Windows job must prepare Tauri resources before cargo test',
  )
})

it('a Linux job runs the shared-store Rust suite', () => {
  const sharedStoreJobs = [...parsedJobs.values()].filter((job) => {
    const runs = job.steps.flatMap((step) => step.run ? [step.run] : [])
    return job.runsOn === 'ubuntu-latest' && runs.includes(
      'cargo test --manifest-path shared-store/Cargo.toml',
    )
  })

  assert.equal(sharedStoreJobs.length, 1)
})

it('CI cannot push, publish, upload releases, or use secrets', () => {
  const steps = [...parsedJobs.values()].flatMap((job) => job.steps)
  const commands = steps.flatMap((step) => step.run ? [step.run] : [])
  const actions = steps.flatMap((step) => step.uses ? [step.uses] : [])

  for (const command of commands) {
    assert.doesNotMatch(command, /\bpush\b/i, `automatic push found: ${command}`)
    assert.doesNotMatch(
      command,
      /\bgh\s+release\s+upload\b|\b(?:npm|cargo|docker)\s+publish\b/i,
      `publish command found: ${command}`,
    )
  }

  for (const action of actions) {
    assert.doesNotMatch(
      action,
      /\bpush\b|\bpublish\b/i,
      `automatic push/publish action found: ${action}`,
    )
    assert.doesNotMatch(
      action,
      /action-gh-release|upload-release|release.*upload|upload.*release/i,
      `release upload action found: ${action}`,
    )
  }

  assert.doesNotMatch(source, /\bsecrets\b/i, 'CI must not consume or write secrets')
  assert.doesNotMatch(source, /\bwrite-all\b|:\s*write\b/i, 'CI permissions must stay read-only')
})
