import { describe, expect, it, vi } from 'vitest'
import {
  GALLERY_CROSSFADE_MS,
  createGalleryCrossfadeController,
} from './galleryCrossfade'

function mediaFixture() {
  const style = {
    removeProperty: vi.fn(),
  } as unknown as CSSStyleDeclaration
  const clone = {
    tagName: 'IMG',
    tabIndex: 0,
    style,
    removeAttribute: vi.fn(),
    setAttribute: vi.fn(),
    remove: vi.fn(),
  } as unknown as HTMLElement
  const media = {
    tagName: 'IMG',
    style,
    cloneNode: vi.fn(() => clone),
  } as unknown as HTMLElement
  return { media, clone }
}

describe('gallery crossfade', () => {
  it('keeps the previous media as an outgoing layer until the incoming media settles', async () => {
    const { media, clone } = mediaFixture()
    const host = { replaceChildren: vi.fn() } as unknown as HTMLElement
    const animate = vi.fn((
      _element: HTMLElement,
      _keyframes: Keyframe[],
      _options: KeyframeAnimationOptions,
    ) => ({
      finished: Promise.resolve(),
      cancel: vi.fn(),
    }))
    const controller = createGalleryCrossfadeController({
      host: () => host,
      reducedMotion: () => false,
      animate,
    })

    expect(controller.begin(media)).toBe(true)
    expect(host.replaceChildren).toHaveBeenCalledWith(clone)
    expect(
      (clone as unknown as { setAttribute: ReturnType<typeof vi.fn> }).setAttribute,
    ).toHaveBeenCalledWith('data-lightbox-gallery-outgoing', '')

    const incoming = mediaFixture().media
    expect(controller.settle(incoming)).toBe(true)
    expect(animate).toHaveBeenCalledTimes(2)
    expect(animate.mock.calls[0]?.[2]).toMatchObject({
      duration: GALLERY_CROSSFADE_MS,
      easing: 'linear',
    })
    await vi.waitFor(() => expect(clone.remove).toHaveBeenCalled())
  })

  it('uses a direct swap when reduced motion is enabled', () => {
    const { media } = mediaFixture()
    const host = { replaceChildren: vi.fn() } as unknown as HTMLElement
    const controller = createGalleryCrossfadeController({
      host: () => host,
      reducedMotion: () => true,
    })

    expect(controller.begin(media)).toBe(false)
    expect(host.replaceChildren).not.toHaveBeenCalled()
  })
})
