import { useState } from 'react'
import type { WorkflowEntry } from '../../domain/project/workflowParams'

/**
 * 「来源行」示例：渠道 · 模式（API / AI 应用 / 工作流）· 条目 · 实例 · 暴露参数。
 *
 * **纯展示**（本地 state，不写节点、不发请求）—— 先看形态，再决定接进面板。
 */
export function SourceRowDemo({ channelId, entries }: { channelId: string; entries: WorkflowEntry[] }) {
  const [mode, setMode] = useState<'api' | 'app' | 'flow'>('flow')
  const [instance, setInstance] = useState<'default' | 'plus'>('default')
  const [entryId, setEntryId] = useState(entries[0]?.id ?? '')
  const [values, setValues] = useState<Record<string, string>>({})

  const entry = entries.find((item) => item.id === entryId) ?? null
  const fields = entry?.fields.filter((field) => field.enabled) ?? []

  return (
    <section className="demo-source" data-demo-source>
      <div className="demo-row">
        <label className="demo-pick">
          <span className="demo-label">渠道</span>
          <select className="demo-select" value={channelId} disabled>
            <option value={channelId}>RunningHub</option>
          </select>
        </label>

        <div className="demo-seg" role="group" aria-label="生成模式">
          {([
            ['api', 'API'],
            ['app', 'AI 应用'],
            ['flow', '工作流'],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)}>
              {label}
            </button>
          ))}
        </div>

        <label className="demo-pick">
          <span className="demo-label">{mode === 'flow' ? '条目' : '模型'}</span>
          <select className="demo-select" value={entryId} onChange={(event) => setEntryId(event.target.value)}>
            {mode === 'flow'
              ? entries.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))
              : mode === 'app'
                ? <option>应用 1877265245566922753</option>
                : <option>GPT Image 2</option>}
          </select>
        </label>

        {mode === 'flow' ? (
          <label className="demo-pick">
            <span className="demo-label">实例</span>
            <select
              className="demo-select"
              value={instance}
              onChange={(event) => setInstance(event.target.value === 'plus' ? 'plus' : 'default')}
            >
              <option value="default">24G</option>
              <option value="plus">48G</option>
            </select>
          </label>
        ) : null}

        <button type="button" className="demo-run">
          ✧ 运行
        </button>
      </div>

      {mode === 'flow' && fields.length > 0 ? (
        <div className="demo-fields">
          {fields.map((field) => (
            <label key={field.id} className="demo-field">
              <span className="demo-label">{field.label || field.fieldName}</span>
              {field.type === 'video' || field.type === 'image' || field.type === 'audio' ? (
                <span className="demo-media">
                  {field.required ? '必选' : '可选'} · 用上游素材
                </span>
              ) : field.type === 'select' ? (
                <select
                  className="demo-select"
                  value={values[field.id] ?? field.value}
                  onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
                >
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="demo-input"
                  type={field.type === 'number' ? 'number' : 'text'}
                  value={values[field.id] ?? field.value}
                  onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
                />
              )}
            </label>
          ))}
        </div>
      ) : null}

      <p className="demo-note">运行会按「运行时长」扣积分；含第三方模型的工作流另计模型调用费。</p>
    </section>
  )
}
