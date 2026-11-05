import fs from 'node:fs'
import path from 'node:path'
import { validateGovernance } from './module-governance-lib.mjs'

const root = path.resolve(import.meta.dirname, '..')
const config = JSON.parse(fs.readFileSync(path.join(root, 'architecture/module-governance.json'), 'utf8'))
const errors = validateGovernance(root, config)
if (errors.length) {
  console.error(`module governance failed (${errors.length}):\n${errors.map((error) => `- ${error}`).join('\n')}`)
  process.exitCode = 1
} else {
  console.log(`module governance passed: ${config.legacy.length} legacy budgets; new TS/TSX <= ${config.defaults.ts}, CSS <= ${config.defaults.css}; directory coverage src/**`)
}
