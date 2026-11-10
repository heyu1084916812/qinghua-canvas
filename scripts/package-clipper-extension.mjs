import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'browser-extension/qinghua-clipper')
const manifest = JSON.parse(
  await readFile(resolve(source, 'manifest.json'), 'utf8'),
)
const releaseRoot = resolve(root, 'release')
const destination = resolve(
  releaseRoot,
  `qinghua-clipper-${manifest.version}.zip`,
)

await mkdir(releaseRoot, { recursive: true })
await rm(destination, { force: true })
execFileSync('powershell.exe', [
  '-NoProfile',
  '-Command',
  `Compress-Archive -Path '${source}\\*' -DestinationPath '${destination}'`,
], { stdio: 'inherit' })

const bytes = await readFile(destination)
const info = await stat(destination)
console.log(JSON.stringify({
  path: destination,
  bytes: info.size,
  sha256: createHash('sha256').update(bytes).digest('hex').toUpperCase(),
}, null, 2))
