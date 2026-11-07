import { useState } from 'react'
import { codexMcpConfigText } from './canvasMcpConfig'
import blockStyles from './CanvasMcpConfigBlock.module.css'
import styles from './CanvasMcpPanel.module.css'

export function CanvasMcpConfigBlock({
  config,
  copy,
}: {
  config: unknown
  copy: (text: string) => void
}) {
  const [format, setFormat] = useState<'json' | 'codex'>('json')
  const json = JSON.stringify(config, null, 2) ?? '{}'
  const text = format === 'codex' ? codexMcpConfigText(config) : json
  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHead}>
        <div className={blockStyles.formatTabs}>
          <button
            type="button"
            className={`${styles.linkBtn} ${format === 'json' ? blockStyles.formatOn : ''}`}
            data-canvas-mcp-format="json"
            aria-pressed={format === 'json'}
            onClick={() => setFormat('json')}
          >
            JSON
          </button>
          <button
            type="button"
            className={`${styles.linkBtn} ${format === 'codex' ? blockStyles.formatOn : ''}`}
            data-canvas-mcp-format="codex"
            aria-pressed={format === 'codex'}
            onClick={() => setFormat('codex')}
          >
            Codex TOML
          </button>
        </div>
        <button
          type="button"
          className={`${styles.linkBtn} ${blockStyles.copy}`}
          data-canvas-mcp-copy
          disabled={!text}
          onClick={() => copy(text)}
        >
          复制配置
        </button>
      </div>
      <pre data-canvas-mcp-config>{text}</pre>
    </div>
  )
}
