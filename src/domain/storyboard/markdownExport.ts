import {
  DEFAULT_BGM_VOLUME,
  type StoryboardDoc,
} from './model'
import { shotsOf } from './shotOrdering'
import {
  characterNamesOf,
  sceneNameOf,
  shotPromptWithAssets,
  storyboardStats,
} from './presentation'
import { shotDialogueTextOf } from './editing'

/** Markdown 表格里的一格：竖线与换行都会把表格撑坏，先换掉。 */
export function cell(value: string): string {
  const flat = value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
  return flat || '—'
}

export function exportStoryboardMarkdown(doc: StoryboardDoc): string {
  const stats = storyboardStats(doc)
  const lines: string[] = []
  lines.push(`# ${doc.script.title || '未命名漫剧'}`)
  lines.push('')
  if (doc.script.logline.trim()) {
    lines.push(`> ${doc.script.logline.trim()}`)
    lines.push('')
  }
  lines.push(`共 ${stats.episodes} 集 / ${stats.shots} 镜 / 粗排 ${stats.durationSec} 秒`)
  lines.push('')
  if (doc.script.body.trim()) {
    lines.push('## 剧本')
    lines.push('')
    lines.push(doc.script.body.trim())
    lines.push('')
  }
  doc.episodes.forEach((episode, episodeIndex) => {
    lines.push(`## 第 ${episodeIndex + 1} 集 · ${episode.title}`)
    lines.push('')
    if (episode.sourceRange) {
      lines.push(`> 原文第 ${episode.sourceRange.from + 1}–${episode.sourceRange.to} 字`)
      lines.push('')
    }
    if (episode.summary.trim()) {
      lines.push(`> ${episode.summary.trim()}`)
      lines.push('')
    }
    if (episode.hookOpen?.trim()) {
      lines.push(`> 开场钩子：${episode.hookOpen.trim()}`)
      lines.push('')
    }
    if (episode.hookEnd?.trim()) {
      lines.push(`> 结尾钩子：${episode.hookEnd.trim()}`)
      lines.push('')
    }
    if (episode.bgmHash) {
      const volume = Math.round((episode.bgmVolume ?? DEFAULT_BGM_VOLUME) * 100)
      lines.push(
        `> 背景音乐：${episode.bgmName?.trim() || episode.bgmHash}（${episode.bgmHash.slice(0, 8)}…，音量 ${volume}%）`,
      )
      lines.push('')
    }
    const shots = shotsOf(doc, episode.id)
    if (shots.length === 0) {
      lines.push('（这一集还没有分镜）')
      lines.push('')
      return
    }
    lines.push('| # | 画面 | 场景 | 出场角色 | 台词 / 旁白 | 时长 | 画面提示词 |')
    lines.push('| --- | --- | --- | --- | --- | --- | --- |')
    shots.forEach((shot, i) => {
      lines.push(
        `| ${i + 1} | ${cell(shot.scene)} | ${cell(sceneNameOf(doc, shot))} | ${cell(
          characterNamesOf(doc, shot).join('、'),
      )} | ${cell(shotDialogueTextOf(doc, shot))} | ${shot.durationSec}s | ${cell(shotPromptWithAssets(doc, shot))} |`,
      )
    })
    lines.push('')
  })
  return lines.join('\n').trimEnd() + '\n'
}
