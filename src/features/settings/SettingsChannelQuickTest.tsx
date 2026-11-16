import { errorTextOf } from '../../shared/result'
import { useEffect, useRef, useState } from 'react'
import { protocolNeedsNoToken, type Channel, type ChannelCredentialGroup } from '../../domain/project/channel'
import type { ChannelStore } from '../../state/channel/channelStore'
import type { PlatformKit } from '../../platform/ports'
import { ChoicePicker } from '../shared/choicePicker/ChoicePicker'
import { quickTestCategory, runChannelQuickTest } from '../../state/channel/channelQuickTest'
import shell from './SettingsWorkflowEntries.module.css'
import styles from './SettingsChannelQuickTest.module.css'

/**
 * 渠道页底部的「快速测试」（对账 #1117）。
 *
 * 用户 2026-11-14：「测试运行这个可以每个渠道都加，属于渠道公共能力，参考图一」。
 * 参考图里那一块就是：一句费用说明 + 输入框 + 模型下拉 + 「运行」+ 就地显示结果。
 *
 * 三条口径（写在这里也写进界面，避免用户以为点一下不要钱）：
 * - **验证协议 / 拉取模型不发生成请求**，只有这里的「运行」会真的调一次生成接口并计费；
 * - 走**渠道自己的适配器**（`runChannelQuickTest`），不走 mock —— 伪造一个成功比报错更糟；
 * - 模型下拉只列**这条渠道已勾选的模型**（§7.4：不是 modelCache 里那一堆）。
 */
export function SettingsChannelQuickTest({
  channel,
  groupId,
  channels,
  platform,
}: {
  channel: Channel
  groupId?: string
  channels: ChannelStore
  platform: PlatformKit
}) {
  const group: ChannelCredentialGroup | undefined = groupId
    ? channel.credentialGroups.find((item) => item.id === groupId)
    : undefined
  const models = group ? group.models : channel.models

  const [model, setModel] = useState(models[0]?.id ?? '')
  const [prompt, setPrompt] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [media, setMedia] = useState<{ kind: 'image' | 'video'; src: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  /** 换渠道 / 换 Key 分组就清空结果：上一家出的图留在这儿只会误导 */
  useEffect(() => {
    setText('')
    setMedia(null)
    setError('')
    setModel(models[0]?.id ?? '')
    // eslint 里没有 hooks 规则，这里靠 `channel.id`/`groupId` 两个稳定值做依赖
  }, [channel.id, groupId])

  useEffect(
    () => () => {
      abortRef.current?.abort()
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    },
    [],
  )

  const run = async () => {
    const cap = models.find((item) => item.id === model)
    const category = quickTestCategory(cap?.category ?? '')
    if (!cap || !category) {
      setError('这个模型不支持快速测试（只支持图片 / 视频 / 对话）')
      return
    }
    const content = prompt.trim()
    if (!content) {
      setError('先写一句测试内容')
      return
    }

    setRunning(true)
    setError('')
    setText('')
    setMedia(null)
    const controller = new AbortController()
    abortRef.current = controller
    /** 生视频本来就慢：给三分钟，到点按取消处理（不是「渠道坏了」） */
    const timer = setTimeout(() => controller.abort(), 180_000)
    try {
      /** 读 Key 失败（没存 / 存了坏数据）一律当「没有 Key」，下面给同一句人话 */
      let apiKey: string | null = null
      try {
        apiKey = groupId
          ? await channels.loadCredentialGroupToken(channel.id, groupId)
          : await channels.loadToken(channel.id)
      } catch {
        apiKey = null
      }
      /**
       * 没 Key 就**在本地先说清楚**。
       *
       * 直接往下打，适配器会从凭据层冒出一句底层的解密错误（实测是
       * "The provided data is too small"），用户完全不知道该怎么办 ——
       * 而这里九成情况就是「还没填 Key」。
       */
      if (!apiKey && !protocolNeedsNoToken(channel.protocol, platform.cli !== undefined)) {
        throw new Error('这条渠道还没存 API Key —— 先在上面填好 Key，再回来测试')
      }
      const outcome = await runChannelQuickTest({
        platform,
        channel,
        catalog: channels.protocolCatalog(),
        apiKey,
        model,
        category,
        prompt: content,
        signal: controller.signal,
      })
      if (outcome.kind === 'text') {
        setText(outcome.text)
      } else {
        const bytesUrl =
          outcome.bytes && !outcome.url
            ? URL.createObjectURL(new Blob([outcome.bytes as unknown as BlobPart], { type: outcome.mime }))
            : ''
        const src = outcome.url ?? bytesUrl
        if (!src) throw new Error('渠道返回的产物没有可显示的地址')
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = bytesUrl || null
        setMedia({ kind: outcome.mime.startsWith('video') ? 'video' : 'image', src })
      }
    } catch (e) {
      setError(errorTextOf(e))
    } finally {
      clearTimeout(timer)
      abortRef.current = null
      setRunning(false)
    }
  }

  return (
    <section className={shell.block} data-channel-quick-test={channel.id}>
      <div className={shell.head}>
        <div className={shell.headText}>
          <span className={shell.title}>快速测试</span>
          <span className={shell.sub}>
            会调用正式生成接口并产生费用；「验证协议」「拉取模型」不生成内容。
          </span>
        </div>
      </div>

      {models.length === 0 ? (
        <p className={shell.muted}>这条渠道还没勾选模型 —— 先在上面「选择模型」，再回来测。</p>
      ) : (
        <>
          <textarea
            className={styles.input}
            rows={3}
            value={prompt}
            placeholder="输入测试内容…"
            onChange={(event) => setPrompt(event.target.value)}
            data-quick-test-input
          />
          <div className={styles.row}>
            <div className={styles.modelPicker} data-quick-test-model>
              <ChoicePicker
                name="channel-quick-test-model"
                value={model}
                ariaLabel="快速测试模型"
                options={models.map((item) => ({
                  value: item.id,
                  label: item.id,
                }))}
                onChange={setModel}
              />
            </div>
            <button
              type="button"
              className={`${shell.btnPrimary} ${styles.run}`}
              disabled={running}
              onClick={() => void run()}
              data-quick-test-run
            >
              {running ? '运行中…' : '运行'}
            </button>
          </div>

          {text !== '' ? (
            <pre className={styles.text} data-quick-test-text>
              {text}
            </pre>
          ) : null}
          {media ? (
            <div className={styles.media} data-quick-test-media={media.kind}>
              {media.kind === 'video' ? (
                <video className={styles.mediaBody} src={media.src} controls />
              ) : (
                <img className={styles.mediaBody} src={media.src} alt="快速测试结果" />
              )}
            </div>
          ) : null}
          {error !== '' ? (
            <p className={styles.error} data-quick-test-error>
              {error}
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
