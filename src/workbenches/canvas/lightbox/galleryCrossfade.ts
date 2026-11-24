import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useAssetMeta } from '../../../features/shared/assets/index'

export const GALLERY_CROSSFADE_MS = 160
const EMPTY_LIGHTBOX_ASSET: ReturnType<typeof useAssetMeta> = { url: null, mime: null }

/** `useAssetMeta` keeps the previous result until the new load resolves; never bind that stale URL to a new hash. */
export function useLightboxAssetMeta(
  hash: string | undefined,
  opts: Parameters<typeof useAssetMeta>[1] = {},
): ReturnType<typeof useAssetMeta> {
  const meta = useAssetMeta(hash, opts)
  const bound = useRef({ hash, baseline: meta, pending: false })
  if (bound.current.hash !== hash) {
    bound.current = { hash, baseline: meta, pending: true }
  } else if (bound.current.pending && meta !== bound.current.baseline) {
    bound.current = { hash, baseline: meta, pending: false }
  }
  return bound.current.pending ? EMPTY_LIGHTBOX_ASSET : meta
}

type CrossfadeAnimation = {
  finished: Promise<unknown>
  cancel(): void
}

type CrossfadeAnimator = (
  element: HTMLElement,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
) => CrossfadeAnimation

export interface GalleryCrossfadeController {
  begin(media: HTMLElement | null): boolean
  settle(incoming: HTMLElement): boolean
  clear(): void
}

export function createGalleryCrossfadeController({
  host,
  reducedMotion,
  animate = (element, keyframes, options) =>
    element.animate(keyframes, options),
}: {
  host: () => HTMLElement | null
  reducedMotion: () => boolean
  animate?: CrossfadeAnimator
}): GalleryCrossfadeController {
  let outgoing: HTMLElement | null = null
  let generation = 0

  const clear = () => {
    generation += 1
    outgoing?.remove()
    outgoing = null
  }

  return {
    begin(media) {
      if (!media || reducedMotion()) return false
      const target = host()
      if (!target) return false
      if (outgoing) return true

      const clone = media.cloneNode(true) as HTMLElement
      clone.removeAttribute('id')
      clone.removeAttribute('data-lightbox-media')
      clone.setAttribute('data-lightbox-gallery-outgoing', '')
      clone.setAttribute('aria-hidden', 'true')
      clone.tabIndex = -1
      Object.assign(clone.style, {
        position: 'absolute',
        zIndex: '2',
        margin: '0',
        opacity: '1',
        pointerEvents: 'none',
        transition: 'none',
      })
      if (clone.tagName === 'VIDEO') {
        const source = media as HTMLVideoElement
        const video = clone as HTMLVideoElement
        video.muted = true
        try {
          video.currentTime = source.currentTime
        } catch {
          /* Metadata may not expose a seekable currentTime yet; the frame is still usable. */
        }
        void video.play().catch(() => undefined)
      }
      target.replaceChildren(clone)
      outgoing = clone
      return true
    },

    settle(incoming) {
      const current = outgoing
      if (!current) return false
      outgoing = null
      const token = ++generation
      if (reducedMotion()) {
        current.remove()
        return false
      }
      const options: KeyframeAnimationOptions = {
        duration: GALLERY_CROSSFADE_MS,
        easing: 'linear',
        fill: 'forwards',
      }
      const out = animate(current, [{ opacity: 1 }, { opacity: 0 }], options)
      const into = animate(incoming, [{ opacity: 0 }, { opacity: 1 }], options)
      void Promise.allSettled([out.finished, into.finished]).then(() => {
        if (token !== generation) return
        current.remove()
        out.cancel()
        into.cancel()
        incoming.style.removeProperty('opacity')
      })
      return true
    },

    clear,
  }
}

export function useGalleryCrossfade({
  active,
  stageRef,
}: {
  active: boolean
  stageRef: RefObject<HTMLElement | null>
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [controller] = useState(() =>
    createGalleryCrossfadeController({
      host: () => hostRef.current,
      reducedMotion: () =>
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    }),
  )
  const overlay = useCallback(
    () => stageRef.current?.closest<HTMLElement>('[data-lightbox]') ?? null,
    [stageRef],
  )
  const begin = useCallback(() => {
    if (!active || !controller.begin(
      stageRef.current?.querySelector<HTMLElement>('[data-lightbox-media]') ?? null,
    )) return false
    overlay()?.setAttribute('data-lightbox-gallery-switching', '')
    return true
  }, [active, controller, overlay, stageRef])
  const settle = useCallback((incoming: HTMLElement) => {
    const started = controller.settle(incoming)
    overlay()?.removeAttribute('data-lightbox-gallery-switching')
    return started
  }, [controller, overlay])
  const clear = useCallback(() => {
    controller.clear()
    overlay()?.removeAttribute('data-lightbox-gallery-switching')
  }, [controller, overlay])

  useEffect(() => {
    if (!active) clear()
  }, [active, clear])
  useEffect(() => () => clear(), [clear])

  return { hostRef, begin, settle, clear }
}
