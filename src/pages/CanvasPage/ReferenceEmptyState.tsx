import { useMemo, useState } from 'react'
import type { LibraryAsset } from '../../domain/shared/assetLibrary'
import { useAsset } from '../../features/shared/assets'
import { IconImageUpload, IconMcpLink } from '../../app/SettingsIcons'
import { IconImage, IconLink } from '../../workbenches/canvas/toolbar/icons'
import styles from './ReferenceEmptyState.module.css'

type EmptyMenu = 'link' | 'assets' | 'connector' | null

export function ReferenceEmptyState({
  busy,
  onUpload,
  onAddLink,
  onAddAsset,
  onLoadAssets,
  onOpenSource,
}: {
  busy: boolean
  onUpload: () => void
  onAddLink: (url: string) => Promise<void>
  onAddAsset: (asset: LibraryAsset) => Promise<void>
  onLoadAssets: () => Promise<readonly LibraryAsset[]>
  onOpenSource: (source: 'pinterest' | 'clipper') => void
}) {
  const [menu, setMenu] = useState<EmptyMenu>(null)
  const [url, setUrl] = useState('')
  const [assets, setAssets] = useState<readonly LibraryAsset[]>([])
  const [loadingAssets, setLoadingAssets] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const openAssets = async () => {
    if (menu === 'assets') {
      setMenu(null)
      return
    }
    setMenu('assets')
    if (assets.length > 0 || loadingAssets) return
    setLoadingAssets(true)
    setError('')
    try {
      setAssets(await onLoadAssets())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取素材失败')
    } finally {
      setLoadingAssets(false)
    }
  }

  const addLink = async () => {
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      await onAddLink(url)
      setUrl('')
      setMenu(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '添加链接失败')
    } finally {
      setSubmitting(false)
    }
  }

  const addAsset = async (asset: LibraryAsset) => {
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      await onAddAsset(asset)
      setMenu(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '添加素材失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className={styles.empty} data-reference-empty>
      <div className={styles.art} aria-hidden="true">
        <span className={`${styles.sheet} ${styles.back}`}>
          <IconLink size={18} />
        </span>
        <span className={`${styles.sheet} ${styles.middle}`}>
          <IconImage size={20} />
        </span>
        <span className={`${styles.sheet} ${styles.front}`}>
          <IconImageUpload size="lg" />
        </span>
      </div>
      <strong>从参考素材开始</strong>
      <p>在对话或画布中上传的文件会出现在这里。</p>
      <div className={styles.actions}>
        <button
          type="button"
          data-reference-empty-upload
          disabled={busy}
          onClick={onUpload}
        >
          <IconImageUpload size="md" />
          上传文件
        </button>
        <button
          type="button"
          data-reference-empty-link
          onClick={() => setMenu(menu === 'link' ? null : 'link')}
        >
          <IconLink size={17} />
          链接
        </button>
        <button
          type="button"
          data-reference-empty-assets
          onClick={() => void openAssets()}
        >
          <IconImage size={17} />
          选择素材
        </button>
        <button
          type="button"
          data-reference-empty-connector
          onClick={() => setMenu(menu === 'connector' ? null : 'connector')}
        >
          <IconMcpLink size="md" />
          连接器
        </button>
      </div>

      {menu === 'link' ? (
        <div className={styles.popover} data-reference-link-form>
          <label>
            <span>粘贴链接</span>
            <input
              value={url}
              autoFocus
              placeholder="https://"
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void addLink()
              }}
            />
          </label>
          <button type="button" disabled={submitting || !url.trim()} onClick={() => void addLink()}>
            添加
          </button>
        </div>
      ) : null}

      {menu === 'assets' ? (
        <div className={styles.popover} data-reference-asset-picker>
          <div className={styles.popoverHead}>
            <span>选择已收藏素材</span>
            <button type="button" onClick={() => setMenu(null)}>
              取消
            </button>
          </div>
          {loadingAssets ? <p className={styles.hint}>正在读取素材…</p> : null}
          {!loadingAssets && assets.length === 0 ? (
            <p className={styles.hint}>还没有已收藏素材。</p>
          ) : null}
          {assets.length > 0 ? (
            <div className={styles.assetList}>
              {assets.slice(0, 12).map((asset) => (
                <AssetChoice
                  key={asset.hash}
                  asset={asset}
                  disabled={submitting}
                  onChoose={() => void addAsset(asset)}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {menu === 'connector' ? (
        <div className={`${styles.popover} ${styles.connectors}`} data-reference-connectors>
          <button type="button" onClick={() => onOpenSource('pinterest')}>
            Pinterest 收藏
          </button>
          <button type="button" onClick={() => onOpenSource('clipper')}>
            轻画插件收藏
          </button>
        </div>
      ) : null}

      {error ? <p className={styles.error}>{error}</p> : null}
    </section>
  )
}

function AssetChoice({
  asset,
  disabled,
  onChoose,
}: {
  asset: LibraryAsset
  disabled: boolean
  onChoose: () => void
}) {
  const url = useAsset(asset.hash)
  const title = useMemo(
    () => asset.prompt?.trim() || asset.model?.trim() || `素材 ${asset.hash.slice(0, 6)}`,
    [asset.hash, asset.model, asset.prompt],
  )
  return (
    <button type="button" disabled={disabled} onClick={onChoose}>
      <span className={styles.assetThumb}>
        {url ? <img src={url} alt="" loading="lazy" /> : null}
      </span>
      <span>{title}</span>
    </button>
  )
}
