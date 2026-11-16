import { Icon, Settings } from '../../../../ui/icon'
import { ParamPicker } from '../ParamPicker'
import picker from '../ParamPicker.module.css'
import { creationStyles } from './creationStyles'
import styles from './SourceModelMenu.module.css'
import type { CliPanelTool } from './sourceMenuModel'

/**
 * 「本机 CLI」来源的参数行（对账 #1133 逻辑 3）。
 *
 * CLI 的参数**不在节点上**：命令名、参数模板、超时都在「全局设置 → 本机 CLI」里按工具填，
 * 执行期把 `{prompt}` / `{out}` / `{model}` / `{image}` 换成这次的值（`cliRun.ts`）。
 * 所以这一行只**读**：一枚「参数模板」chip 展开看这次会跑什么，末行跳去改；
 * API 的比例 / 清晰度、工作流的暴露字段在这里一个都不出现，也不进提交体。
 */
export interface CliParameterControlsProps {
  tool: CliPanelTool | null
  blockedReason: string | null
  open: boolean
  onToggle: () => void
  onClose: () => void
  onOpenCliSettings: () => void
  disabled?: boolean
}

export function CliParameterControls({ tool, blockedReason, open, onToggle, onClose, onOpenCliSettings, disabled }: CliParameterControlsProps) {
  const template = tool ? `${tool.tool.program} ${tool.tool.argsTemplate}`.trim() : ''
  const body = (
    <div className={styles.menu} data-cli-template-body>
      <span className={picker.sectionTitle}>这次会在本机运行</span>
      <code className={styles.template} data-cli-template>
        {template || '（还没读到工具配置）'}
      </code>
      {tool ? <span className={styles.empty}>{tool.tool.note}</span> : null}
      <button type="button" className={`${picker.row} ${styles.footer}`} data-cli-settings onClick={() => { onClose(); onOpenCliSettings() }}>
        <span className={picker.rowIcon}><Icon icon={Settings} px={18} /></span>
        <span className={picker.rowText}>本机 CLI 设置…</span>
      </button>
    </div>
  )
  return (
    <>
      <span className={creationStyles.paramDivider} data-param-divider aria-hidden="true" />
      <ParamPicker
        name="cliTemplate"
        ariaLabel="CLI 参数模板"
        label={tool ? '参数模板' : 'CLI 参数'}
        body={body}
        open={open}
        onToggle={onToggle}
        onClose={onClose}
        disabled={disabled === true}
      />
      {blockedReason ? (
        <span className={creationStyles.paramHint} data-source-blocked="cli" title={blockedReason}>
          {blockedReason}
        </span>
      ) : null}
    </>
  )
}
