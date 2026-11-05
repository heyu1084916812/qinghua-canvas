import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

const root = path.resolve(import.meta.dirname, '..')
const script = path.join(root, 'scripts/gen-runninghub-models.mjs')
const fixtureCatalog = path.join(root, '.probe-tmp/rh-fixture-capabilities.json')
const expectedFiles = [
  'src/platform/channels/runninghubEndpoints.ts',
  'src/platform/channels/runninghubEndpoints/types.ts',
  'src/platform/channels/runninghubEndpoints/contracts.ts',
  'src/platform/channels/runninghubEndpoints/endpointSpecs.partA.ts',
  'src/platform/channels/runninghubEndpoints/endpointSpecs.partB.ts',
  'src/platform/channels/runninghubEndpoints/endpointSpecs.partC.ts',
  'src/platform/channels/runninghubEndpoints/models.ts',
]

function snapshot() {
  return Object.fromEntries(
    expectedFiles.map((file) => [
      file,
      fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n'),
    ]),
  )
}

function run(args) {
  return execFileSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
  })
}

function readTranspiled(file) {
  const source = fs.readFileSync(
    path.join(root, 'src/platform/channels/runninghubEndpoints', file),
    'utf8',
  )
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
}

async function synthesizeCatalog() {
  const parts = [
    'endpointSpecs.partA.ts',
    'endpointSpecs.partB.ts',
    'endpointSpecs.partC.ts',
  ].map(
    (file) =>
      `data:text/javascript;base64,${Buffer.from(readTranspiled(file)).toString('base64')}`,
  )
  await Promise.all(parts.map((url) => import(url)))
  const fixturePath = path.join(
    root,
    'src/platform/channels/runninghubEndpoints/catalogFixture.ts',
  )
  const fixtureSource = fs
    .readFileSync(fixturePath, 'utf8')
    .replace(/from '\.\/endpointSpecs\.partA'/g, `from '${parts[0]}'`)
    .replace(/from '\.\/endpointSpecs\.partB'/g, `from '${parts[1]}'`)
    .replace(/from '\.\/endpointSpecs\.partC'/g, `from '${parts[2]}'`)
    .replace(/from '\.\/types'/g, "from 'data:text/javascript,export%20{}'")
  const fixtureJs = ts.transpileModule(fixtureSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const fixture = await import(
    `data:text/javascript;base64,${Buffer.from(fixtureJs).toString('base64')}`,
  )
  return fixture.createCatalogFixture()
}

describe('gen-runninghub-models.mjs', () => {
  it('replays committed generated files from the committed catalog data', async () => {
    const before = snapshot()
    fs.mkdirSync(path.dirname(fixtureCatalog), { recursive: true })
    fs.writeFileSync(fixtureCatalog, JSON.stringify(await synthesizeCatalog()), 'utf8')
    expect(run([fixtureCatalog, '--dry-run'])).toContain('dry-run 一致 7 个文件')
    expect(snapshot()).toEqual(before)
    run([fixtureCatalog])
    expect(snapshot()).toEqual(before)
    expect(run([fixtureCatalog, '--dry-run'])).toContain('dry-run 一致 7 个文件')
  })
})
