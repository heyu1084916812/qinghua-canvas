import { useEffect, useState } from 'react'
import { maskTokenTail } from '../../domain/project/channel'
import { useChannels } from '../../app/providers/ChannelStoreProvider'
import { IconEye, IconEyeOff } from '../../app/SettingsIcons'
import { settingsPageStyles as styles } from './settingsPage/settingsPageStyles'

export function ChannelTokenField({
  channels,
  channelId,
  slot,
  groupId,
  label,
  hint,
  required,
  docUrl,
  savedTail,
  saved,
}: {
  channels: ReturnType<typeof useChannels>
  channelId: string
  slot: 'primary' | 'alt'
  /** 有值时走渠道内 Key 分组；slot 只作为老双槽的兼容身份。 */
  groupId?: string
  label: string
  hint?: string
  required?: boolean
  docUrl: string
  /** 已保存令牌的尾 4 位；null = 这一槽没存过 */
  savedTail: string | null
  /**
   * **这一槽存过没有**（对账 #517）。
   *
   * 它是「已保存」的唯一判据；尾号只负责**显示成什么**。
   * 两者分开才不会把"存了但没有尾号的短令牌"显示成没保存
   * （短令牌没尾号是刻意设计：9 位上露 4 位等于把大半个密钥打在界面上）。
   */
  saved: boolean
}) {
  const [token, setToken] = useState('')
  const [show, setShow] = useState(false)
  /**
   * 「显示」那一刻从凭据层读回来的**明文**。
   *
   * 只活在这一屏：切回「隐藏」、保存、删除、换渠道都立刻丢掉（不落库、不进日志）。
   */
  const [revealed, setRevealed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const masked = savedTail ? maskTokenTail(savedTail) : ''
  /** 存过但没尾号时也要给一句看得见的确认，不能看起来像没保存 */
  const savedText = masked || (saved ? '已保存' : '')

  /** 换了渠道 / 换了槽位：把"已显示"这件事清掉，免得上一条的明文挂在新渠道上 */
  useEffect(() => {
    setToken('')
    setShow(false)
    setRevealed(null)
    setDirty(false)
  }, [channelId, slot, groupId])

  /**
   * 「显示 / 隐藏」（用户 2026-10-08 第 5 条：「渠道的令牌显示功能是不生效的」）。
   *
   * **为什么以前点了没反应**：它只切了输入框的 `type`，而已存的令牌从来只以
   * **打码占位符**出现（明文不进界面）⇒ 输入框里根本没有可显示的东西，切了也看不出变化。
   * 现在「显示」= **真去凭据层读一次**：输入框里是用户刚敲的就显示刚敲的，
   * 否则显示存好的那把（读回明文这条链路见 `channelStore.loadToken`）。
   */
  const toggleShow = async () => {
    if (show) {
      setShow(false)
      setRevealed(null)
      return
    }
    setBusy(true)
    try {
      const plain = groupId
        ? await channels.loadCredentialGroupToken(channelId, groupId)
        : await channels.loadToken(channelId, slot)
      setRevealed(token ? token : saved ? plain : null)
      setShow(true)
    } finally {
      setBusy(false)
    }
  }

  /** 显示态下编辑的是**明文那一份**；隐藏态下编辑的是"准备保存的新令牌" */
  const shownValue = show ? (revealed ?? token) : token
  const onTokenChange = (next: string) => {
    setToken(next)
    setDirty(true)
    if (show) setRevealed(next)
  }

  const save = async () => {
    const next = show ? (revealed ?? token) : token
    if (!dirty || !next.trim()) return
    setBusy(true)
    try {
      if (groupId) await channels.saveCredentialGroupToken(channelId, groupId, next)
      else await channels.saveToken(channelId, next, slot)
      setToken('')
      setDirty(false)
      /* 存完回到"打码占位"的常态：明文不再留在界面上 */
      setShow(false)
      setRevealed(null)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={styles.field} data-settings-token-row={groupId ?? slot}>
      <span className={styles.labelRow}>
        <span className={styles.label}>
          {label}
          {required && <span className={styles.tokenRequired}>必填</span>}
        </span>
      </span>
      <div className={styles.tokenRow}>
        <div className={styles.tokenInputWrap}>
          <input
            className={`${styles.input} ${styles.tokenInput}`}
            data-settings-token-tail={groupId ?? slot}
            type={show ? 'text' : 'password'}
            placeholder={saved ? savedText : '粘贴 API Key'}
            value={shownValue}
            onChange={(e) => onTokenChange(e.target.value)}
            onBlur={() => void save()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
          <button
            type="button"
            className={styles.tokenEye}
            data-settings-token-reveal={groupId ?? slot}
            aria-label={show ? '隐藏 API Key' : '显示 API Key'}
            title={show ? '隐藏 API Key' : '显示 API Key'}
            disabled={busy || (!saved && !token)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void toggleShow()}
          >
            {show ? <IconEyeOff size="sm" /> : <IconEye size="sm" />}
          </button>
        </div>
        {docUrl && (
          <a
            className={styles.docLink}
            data-settings-doc-link={groupId ?? slot}
            href={docUrl}
            target="_blank"
            rel="noreferrer"
          >
            获取令牌
          </a>
        )}
      </div>
      {hint && <span className={styles.cardSub}>{hint}</span>}
    </div>
  )
}
