export interface LightboxSourceRectSnapshot {
  left: number
  top: number
  width: number
  height: number
  borderRadius?: string
  src?: string
  kind?: 'image' | 'video'
  assetHash?: string
}
