import { openUrl } from '@tauri-apps/plugin-opener'
import {
  IconClose,
  IconExpand,
  IconLink,
} from '../../../workbenches/canvas/toolbar/icons'
import styles from './ClipperPanel.module.css'

export function ClipperBrowser({
  url,
  onClose,
  onOpenCanvas,
}: {
  url: string
  onClose: () => void
  onOpenCanvas?: () => void
}) {
  return (
    <section className={styles.browser} data-clipper-browser>
      <header>
        <span title={url}>{url}</span>
        <div>
          {onOpenCanvas ? (
            <button
              type="button"
              className={styles.iconButton}
              data-clipper-open-canvas
              aria-label="在画布中打开浏览器"
              title="在画布中打开浏览器"
              onClick={onOpenCanvas}
            >
              <IconExpand size={15} />
            </button>
          ) : null}
          <button
            type="button"
            className={styles.iconButton}
            aria-label="在系统浏览器打开"
            title="在系统浏览器打开"
            onClick={() => void openUrl(url)}
          >
            <IconLink size={15} />
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="关闭轻画浏览器"
            title="关闭轻画浏览器"
            onClick={onClose}
          >
            <IconClose size={15} />
          </button>
        </div>
      </header>
      <iframe
        src={url}
        title="轻画浏览器"
        referrerPolicy="no-referrer"
        sandbox="allow-forms allow-popups allow-scripts"
      />
    </section>
  )
}
