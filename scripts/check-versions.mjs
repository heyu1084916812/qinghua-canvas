#!/usr/bin/env node
/**
 * 五处版本号一致性检查（发布前置，可进 CI）。
 *
 * 为什么单独成脚本：`node -e "..."` 里带引号的正则在 PowerShell 5.1 下会被吞引号，
 * 一上手就断；这里用文件跑，跨 shell 稳定。
 *
 * 用法：
 *   node scripts/check-versions.mjs            # 人看
 *   node scripts/check-versions.mjs --json     # 机器读（CI）
 * 退出码：0 一致 / 1 不一致或缺字段
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dirname, '..')
const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8')
const readJson = (relative) => JSON.parse(read(relative))

const errors = []
const values = {}

function pick(label, fn) {
  try {
    const value = fn()
    if (!value) errors.push(`${label} 读不到版本号`)
    values[label] = value ?? null
  } catch (error) {
    values[label] = null
    errors.push(`${label} 读取失败：${error.message}`)
  }
}

const pkg = readJson('package.json')
const lock = readJson('package-lock.json')
const conf = readJson('src-tauri/tauri.conf.json')

pick('package.json', () => pkg.version)
pick('package-lock.json（顶层）', () => lock.version)
pick('package-lock.json（packages[""]）', () => lock.packages?.['']?.version)
pick('tauri.conf.json', () => conf.version)
pick('Cargo.toml', () => {
  const head = read('src-tauri/Cargo.toml').split('[dependencies]')[0]
  return (head.match(/^version\s*=\s*"([^"]+)"/m) ?? [])[1]
})
pick('Cargo.lock（name = "qinghua"）', () => {
  const text = read('src-tauri/Cargo.lock')
  return (text.match(/name = "qinghua"\r?\nversion = "([^"]+)"/) ?? [])[1]
})

const unique = [...new Set(Object.values(values).filter(Boolean))]
const aligned = unique.length === 1 && Object.keys(values).length === 6 && errors.length === 0

const endpoints = conf?.plugins?.updater?.endpoints ?? []
const endpointVersioned = endpoints.find((url) => /\/v?\d+\.\d+\.\d+(\/|$)/.test(String(url)))

if (process.argv.includes('--json')) {
  console.log(
    JSON.stringify(
      { aligned, values, errors, endpointVersioned: endpointVersioned ?? null },
      null,
      2,
    ),
  )
} else {
  for (const [label, value] of Object.entries(values)) {
    console.log(`${value ? '  ' : '??'} ${label.padEnd(32, ' ')} ${value ?? '(missing)'}`)
  }
  console.log('')
  if (aligned) {
    console.log(`✅ 六值一致：${unique[0]}`)
  } else {
    const counts = new Map()
    for (const value of Object.values(values)) {
      if (!value) continue
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    const outliers = Object.entries(values).filter(([, value]) => value !== majority)
    console.log(`❌ 版本号不一致 / 缺失：${unique.join(' , ') || '(none)'}`)
    if (majority) console.log(`   主流值：${majority}`)
    for (const [label, value] of outliers) {
      console.log(`   偏离项：${label} = ${value ?? '(缺失)'}`)
    }
  }
  if (endpointVersioned) {
    console.log(`⚠️ updater 地址里带版本号（老客户端永远发现不了新版）：${endpointVersioned}`)
  }
  for (const error of errors) console.log(`   - ${error}`)
}

process.exitCode = aligned ? 0 : 1
