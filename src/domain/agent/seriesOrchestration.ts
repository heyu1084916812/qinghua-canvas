/**
 * 回合级编排提示（系列锚点），全部确定性：只看用户原话、任务状态与参考栏条目。
 *
 * Lovart 对照（review/lovart-ref-flow-interview.md、lovart-image-gen-interview.md）：
 * 1. （参考图的「先分析、拿不准才问」已移到 referenceReview.ts）
 * 2. 整套（Logo + 包装 + 海报）默认串行一口气做完：先 Logo，再拿 Logo 做包装，最后带着两者出海报；
 * 3. 用户说「先定 Logo」时只做 Logo 并停下等确认，确认后再接着做后续。
 *
 * 「先定 Logo」是任务级状态（AgentTaskRef.seriesStage），跨回合保留，直到用户放行。
 * 连线层面的串行由 seriesAnchors.ts 的 applyPlan 检查兜底。
 */

export type SeriesStage = 'logo_first'
export type SeriesDirective = 'logo_first' | 'full_series'

const LOGO = '(?:logo|标志|标识|字标|徽标|商标)'
const LOGO_FIRST_PATTERN = new RegExp(
  `先(?:把|将)?\\s*${LOGO}\\s*(?:定|做|出|设计|确定|搞)|先(?:定|做|出|设计|确定|搞)(?:一下|好|下)?\\s*(?:一个|个|一版)?\\s*${LOGO}|${LOGO}\\s*(?:先|定了|确定了?|满意了?)\\s*(?:再|之后再|后再)|只(?:做|要|出)\\s*${LOGO}`,
  'i',
)
const FULL_SERIES_PATTERN = /整套|全套|一整套|成套|一套(?:品牌|视觉|vi|物料)|vi\s*(?:系统|全套)?设计|品牌(?:视觉)?(?:全案|套装)/i
const LOGO_WORD = new RegExp(LOGO, 'i')
const PACKAGING_WORD = /包装|礼盒|瓶身|杯身|罐身|瓶标|标签|外盒/
const POSTER_WORD = /海报|主视觉|\bkv\b|banner|宣传(?:图|页|单)|主图/i
/** 放行「先定 Logo」：明确满意 / 继续 / 点名要做后续物料。 */
const RELEASE_PATTERN =
  /继续|接着(?:做|来)?|下一步|可以了|就(?:这个|这版|它)|定了|确定了?|满意|没问题|通过|往下做|开始做(?:包装|海报)|(?:做|出)(?:包装|海报)/

function normalized(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function seriesDirectiveOf(text: string): SeriesDirective | null {
  const value = normalized(text)
  if (LOGO_FIRST_PATTERN.test(value)) return 'logo_first'
  const kinds = [LOGO_WORD, PACKAGING_WORD, POSTER_WORD].filter((pattern) => pattern.test(value))
  if (kinds.length >= 2 || FULL_SERIES_PATTERN.test(value)) return 'full_series'
  return null
}

/**
 * 本回合之后任务处于哪个阶段：
 * - 本句说了「先定 Logo」→ logo_first；
 * - 延续任务且原本在 logo_first：用户放行（继续 / 满意 / 做包装…）→ 解除，否则保持；
 * - 新任务不继承旧阶段。
 */
export function nextSeriesStage(input: {
  previous: SeriesStage | undefined
  continued: boolean
  text: string
}): SeriesStage | undefined {
  const value = normalized(input.text)
  if (seriesDirectiveOf(value) === 'logo_first') return 'logo_first'
  if (!input.continued || input.previous !== 'logo_first') return undefined
  return RELEASE_PATTERN.test(value) ? undefined : 'logo_first'
}

/** 「先定 Logo」刚被放行的回合：要接着串行做后续，并以已定 Logo 为锚点。 */
export function seriesStageReleased(previous: SeriesStage | undefined, next: SeriesStage | undefined): boolean {
  return previous === 'logo_first' && next === undefined
}

export function seriesOrchestrationPrompt(input: {
  stage: SeriesStage | undefined
  directive: SeriesDirective | null
  released: boolean
}): string {
  if (input.stage === 'logo_first') {
    return [
      '## 本任务的系列编排：先定 Logo',
      '用户要求先把 Logo 定下来。本回合**只做 Logo**：只新建 / 运行 Logo 生成节点，不要建包装、海报或其它延展节点。',
      'Logo 出图后停下，问用户是否满意（有任务计划时用 requestTaskConfirmation 的 review；没有就直接用一句话问）。',
      '用户确认 Logo 之前，不要开始包装 / 海报；用户要改 Logo 就继续只改 Logo。',
    ].join('\n')
  }
  if (input.released) {
    return [
      '## 本任务的系列编排：Logo 已确认，继续延展',
      '用户已放行 Logo。接着按顺序做后续物料：包装以已确认的 Logo 节点为上游（attach + 连线），',
      '海报以 Logo 和包装为上游。默认一口气串行做完，不要逐张停下来问。',
    ].join('\n')
  }
  if (input.directive === 'full_series') {
    return [
      '## 本任务的系列编排：整套串行',
      '这是一整套物料。默认顺序：先 Logo（核心锚点）→ 包装（以 Logo 节点为上游）→ 海报（以 Logo 和包装为上游）。',
      '在同一份 applyPlan 里把连线画全，执行时按连线先跑上游，后一张自动拿前一张的成品作参考；',
      '默认一口气做完，不要每张停下来问；用户说「先定 Logo」时才只做 Logo 并停下等确认。',
    ].join('\n')
  }
  return ''
}

/** 把阶段写回任务：没有阶段时去掉该键（不留 undefined）。 */
export function withSeriesStage<T extends { seriesStage?: SeriesStage }>(
  task: T,
  stage: SeriesStage | undefined,
): T {
  const next = { ...task }
  if (stage) next.seriesStage = stage
  else delete next.seriesStage
  return next
}
