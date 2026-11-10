import { useState } from 'react'
import {
  IconDownload,
  IconLink,
} from '../../../workbenches/canvas/toolbar/icons'
import styles from './ClipperInstallCard.module.css'

export type ClipperBrowser = 'edge' | 'chrome'

export interface ClipperStoreLink {
  browser: ClipperBrowser
  label: string
  url: string
}

export type ClipperInstallSource =
  | { kind: 'store'; links: ClipperStoreLink[] }
  | { kind: 'package'; url: string }
  | { kind: 'unconfigured' }

const STORE_HOSTS: Record<ClipperBrowser, string> = {
  edge: 'microsoftedge.microsoft.com',
  chrome: 'chromewebstore.google.com',
}

export function resolveClipperInstallSource(input: {
  edgeStoreUrl?: string
  chromeStoreUrl?: string
  packageUrl?: string
}): ClipperInstallSource {
  const links = ([
    storeLink('edge', input.edgeStoreUrl),
    storeLink('chrome', input.chromeStoreUrl),
  ] satisfies Array<ClipperStoreLink | null>).filter(
    (link): link is ClipperStoreLink => Boolean(link),
  )
  if (links.length > 0) return { kind: 'store', links }
  const packageTarget = normalizedHttpsUrl(input.packageUrl)
  return packageTarget
    ? { kind: 'package', url: packageTarget }
    : { kind: 'unconfigured' }
}

export function ClipperInstallCard({
  source,
  onOpen,
  onPair,
}: {
  source: ClipperInstallSource
  onOpen: (url: string) => Promise<void>
  onPair: () => void
}) {
  const [openingUrl, setOpeningUrl] = useState('')
  const [failed, setFailed] = useState(false)
  const [showGuide, setShowGuide] = useState(false)

  const runTarget = async (target: string) => {
    setOpeningUrl(target)
    setFailed(false)
    try {
      await onOpen(target)
    } catch {
      setFailed(true)
      setShowGuide(true)
    } finally {
      setOpeningUrl('')
    }
  }

  return (
    <section
      className={styles.card}
      data-clipper-install-card
      data-clipper-install-mode={source.kind}
    >
      <div className={styles.icon} aria-hidden="true">
        <IconDownload size={17} />
      </div>
      <div className={styles.copy}>
        <strong>轻画 Clipper</strong>
        <span>
          {source.kind === 'store'
            ? '收藏当前网页，读取公开页图片并保存到当前项目'
            : source.kind === 'package'
              ? '下载扩展包，按说明在浏览器中完成安装'
              : '当前构建未连接扩展商店，可按说明离线安装'}
        </span>
      </div>
      <div className={styles.actions}>
        {source.kind === 'store' ? source.links.map((link) => (
          <button
            key={link.browser}
            type="button"
            className={styles.primary}
            data-clipper-install-action
            data-clipper-install-browser={link.browser}
            disabled={Boolean(openingUrl)}
            onClick={() => void runTarget(link.url)}
          >
            {openingUrl === link.url ? '正在打开…' : `${link.label} 一键安装`}
          </button>
        )) : (
          <button
            type="button"
            className={styles.primary}
            data-clipper-install-action
            disabled={Boolean(openingUrl)}
            onClick={() => {
              if (source.kind === 'package') {
                void runTarget(source.url)
              } else {
                setShowGuide((current) => !current)
              }
            }}
          >
            {source.kind === 'package' ? '下载扩展包' : '安装说明'}
          </button>
        )}
        <button
          type="button"
          className={styles.pair}
          data-clipper-install-pair
          onClick={onPair}
        >
          已安装，连接
        </button>
      </div>
      {showGuide ? (
        <div className={styles.guide} data-clipper-install-guide>
          <div className={styles.guideTitle}>
            <IconLink size={14} />
            <strong>浏览器安全确认</strong>
          </div>
          <ol>
            <li>在浏览器扩展管理页开启开发人员模式。</li>
            <li>解压扩展包并选择“加载已解压的扩展程序”。</li>
            <li>回到这里点击“已安装，连接”，粘贴地址和配对令牌。</li>
          </ol>
          {failed ? (
            <p role="status">未能打开安装页，请检查浏览器或稍后重试。</p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function storeLink(
  browser: ClipperBrowser,
  value?: string,
): ClipperStoreLink | null {
  const url = normalizedHttpsUrl(value)
  if (!url || new URL(url).hostname !== STORE_HOSTS[browser]) return null
  return {
    browser,
    label: browser === 'edge' ? 'Edge' : 'Chrome',
    url,
  }
}

function normalizedHttpsUrl(value?: string): string {
  const trimmed = value?.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    return url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}
