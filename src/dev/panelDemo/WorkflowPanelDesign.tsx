import { useState } from 'react'
import type { WorkflowEntry } from '../../domain/project/workflowParams'

/**
 * 「工作流模式」面板设计稿（v2）。
 *
 * 用户反馈要点（2026-11-14）：
 * 1. **不要再放一个「运行」** —— 面板本来就有生成按钮；
 * 2. 选了工作流，就**只显示工作流的参数**，不要还挂着视频模式/比例/清晰度/时长；
 * 3. 底部小字（计费说明）不要；
 * 4. **渠道**不单独占一行，收进底部的模型位（左起第一枚 chip）。
 *
 * 这版只是设计稿（本地 state），用来和现有面板并排比对；确认后再改真组件。
 */
export function WorkflowPanelDesign({ entry }: { entry: WorkflowEntry }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const fields = entry.fields.filter((field) => field.enabled)

  return (
    <div className="demo-design-panel" data-design-workflow>
      <div className="demo-design-assets">
        <span className="demo-design-asset-chip">
          源视频 <b>待输入</b>
        </span>
        <button type="button" className="demo-design-add" title="上传素材">
          +
        </button>
      </div>

      <textarea
        className="demo-design-prompt"
        rows={4}
        placeholder="描述你想生成或编辑的画面…"
        defaultValue="把这段视频提升到 4K，并补到 60 帧"
      />

      <div className="demo-design-params">
        {fields
          .filter((field) => field.type !== 'video' && field.type !== 'image' && field.type !== 'audio')
          .map((field) => (
            <label key={field.id} className="demo-design-param">
              <span>{field.label || field.fieldName}</span>
              {field.type === 'select' ? (
                <select
                  value={values[field.id] ?? field.value}
                  onChange={(event) => setValues((c) => ({ ...c, [field.id]: event.target.value }))}
                >
                  {field.options.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type === 'number' ? 'number' : 'text'}
                  value={values[field.id] ?? field.value}
                  onChange={(event) => setValues((c) => ({ ...c, [field.id]: event.target.value }))}
                />
              )}
            </label>
          ))}
      </div>

      <div className="demo-design-foot">
        <button type="button" className="demo-design-chip demo-design-source">
          <span className="demo-design-dot" />
          RunningHub
          <i>▾</i>
        </button>
        <button type="button" className="demo-design-chip">
          {entry.title}
          <i>▾</i>
        </button>
        <button type="button" className="demo-design-chip">
          24G
          <i>▾</i>
        </button>
        <span className="demo-design-spacer" />
        <button type="button" className="demo-design-gear" title="节点设置">
          ⚙
        </button>
        <button type="button" className="demo-design-run" title="生成当前节点">
          ↑
        </button>
      </div>
    </div>
  )
}
