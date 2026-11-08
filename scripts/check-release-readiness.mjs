#!/usr/bin/env node
/**
 * 只读发布前置检查。它不 push、不打 tag、不创建 Release，也不会改写任何产物。
 * 输出用于用户确认：代码状态、远端状态、三个资产、hash、签名与仍待外部条件。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const version = JSON.parse(
  readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
).version
const releaseDir = path.join(ROOT, 'release', version)
const asset = `qinghua_${version}_x64-setup.exe`
const files = {
  exe: path.join(releaseDir, asset),
  sig: path.join(releaseDir, `${asset}.sig`),
  json: path.join(releaseDir, 'latest.json'),
  workflow: path.join(ROOT, '.github/workflows/ci.yml'),
  license: path.join(ROOT, 'LICENSE'),
  confirmation: path.join(ROOT, '.playwright-verify', `release-confirmation-${version}.md`),
}

function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  if (result.status !== 0) return null
  return result.stdout.trim()
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex').toUpperCase()
}

function signature(file) {
  if (process.platform !== 'win32' || !existsSync(file)) {
    return { applicable: false, status: 'not-checked' }
  }
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `(Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}').Status.ToString()`,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  )
  return {
    applicable: true,
    status: result.status === 0 ? result.stdout.trim() : 'check-failed',
  }
}

const head = git(['rev-parse', 'HEAD'])
const remoteHead = git(['rev-parse', 'origin/main'])
const pending = git(['rev-list', '--count', 'origin/main..HEAD'])
const trackedChanges = (git(['status', '--porcelain=v1']) ?? '')
  .split(/\r?\n/)
  .filter((row) => row && !row.startsWith('??'))
const assets = Object.fromEntries(
  Object.entries(files).map(([name, file]) => [
    name,
    existsSync(file) ? { exists: true, bytes: statSync(file).size } : { exists: false },
  ]),
)
const installerHash = assets.exe.exists ? sha256(files.exe) : null
const manifest = assets.json.exists
  ? JSON.parse(readFileSync(files.json, 'utf8'))
  : null
const confirmation = assets.confirmation.exists
  ? readFileSync(files.confirmation, 'utf8')
  : ''
const confirmationMatches = confirmation
  ? [
      `# 0.1.17 发布确认清单`,
      `release/0.1.17/qinghua_0.1.17_x64-setup.exe`,
      installerHash,
      `qinghua_0.1.17_x64-setup.exe.sig`,
      `latest.json`,
      `未经明确确认不得执行`,
    ].every((token) => confirmation.includes(token))
  : false
const updaterSignatureMatches =
  assets.sig.exists && manifest
    ? readFileSync(files.sig, 'utf8').trim() ===
      manifest.platforms?.['windows-x86_64']?.signature?.trim()
    : false
const authenticode = signature(files.exe)
const checks = {
  trackedClean: trackedChanges.length === 0,
  releaseAssets: Boolean(assets.exe.exists && assets.sig.exists && assets.json.exists),
  manifestVersion: manifest?.version === version,
  updaterSignatureMatches,
  workflowPresent: assets.workflow.exists,
  confirmationPresent: assets.confirmation.exists && confirmationMatches,
  authenticodeSigned: authenticode.status === 'Valid',
  licensePresent: assets.license.exists,
}
const externalConditions = [
  !checks.authenticodeSigned ? '代码签名证书 / Authenticode' : null,
  !checks.licensePresent ? 'LICENSE 授权选择' : null,
  '真实 Pinterest / CLI / Codex 等账号链路',
  '干净机器安装、卸载与覆盖升级',
  '用户明确授权 push / tag / GitHub Release',
].filter(Boolean)

const report = {
  ok: checks.trackedClean &&
    checks.releaseAssets &&
    checks.manifestVersion &&
    checks.updaterSignatureMatches &&
    checks.workflowPresent &&
    checks.confirmationPresent,
  generatedAt: new Date().toISOString(),
  head,
  remoteHead,
  pendingCommits: pending ? Number(pending) : null,
  version,
  installer: {
    path: `release/${version}/${asset}`,
    bytes: assets.exe.exists ? statSync(files.exe).size : null,
    sha256: installerHash,
  },
  assets,
  checks,
  blockers: externalConditions,
  authenticode,
  externalConditions,
}

console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exitCode = 1
