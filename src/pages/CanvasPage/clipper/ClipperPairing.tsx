import { useState } from 'react'
import { IconCopyText } from '../../../workbenches/canvas/toolbar/icons'
import styles from './ClipperPanel.module.css'

export interface ClipperReceiverInfo {
  running: boolean
  endpoint: string
  token: string
  error?: string
}

export function ClipperPairing({
  receiver,
}: {
  receiver: ClipperReceiverInfo | null
}) {
  const [copied, setCopied] = useState('')
  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(key)
      window.setTimeout(() => setCopied(''), 1_200)
    } catch {
      setCopied('')
    }
  }
  return (
    <div className={styles.pairing} data-clipper-pairing>
      <div>
        <span>本机地址</span>
        <code>{receiver?.endpoint ?? 'http://127.0.0.1:53684/clip'}</code>
        <button
          type="button"
          className={styles.action}
          title="复制本机地址"
          aria-label="复制本机地址"
          onClick={() => void copy(
            'endpoint',
            receiver?.endpoint ?? 'http://127.0.0.1:53684/clip',
          )}
        >
          <IconCopyText size={14} />
        </button>
      </div>
      <div>
        <span>配对令牌</span>
        <code>{receiver?.token || (receiver?.error ? '接收端未启动' : '读取中…')}</code>
        {receiver?.token ? (
          <button
            type="button"
            className={styles.action}
            title="复制配对令牌"
            aria-label="复制配对令牌"
            onClick={() => void copy('token', receiver.token)}
          >
            <IconCopyText size={14} />
          </button>
        ) : null}
      </div>
      <small>
        {receiver?.error
          ?? (receiver?.running ? '浏览器扩展只向本机发送当前网页地址' : '正在连接本机接收端')}
      </small>
      {copied ? <em>已复制</em> : null}
    </div>
  )
}
