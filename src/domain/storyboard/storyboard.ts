/**
 * 漫剧工作台 · 第一阶段领域入口。
 *
 * 文档契约、脏数据归一化、编辑命令、稳定顺序、展示提示词、Markdown 导出与
 * 产物镜像分别住在同目录纯模块；本文件只保留原公共 API，外部 import 不变。
 */

export {
  DEFAULT_BGM_VOLUME,
  DEFAULT_TRANSITION_SECONDS,
  MIN_TRANSITION_SECONDS,
  MAX_TRANSITION_SECONDS,
  DEFAULT_SHOT_SECONDS,
  clampTransitionSeconds,
  emptyStoryboard,
  type StoryboardScript,
  type DramaAsset,
  type DramaCharacter,
  type DramaScene,
  type StoryboardLine,
  type StoryboardEpisode,
  type StoryboardShot,
  type StoryboardDoc,
} from './model'

export { parseStoryboard } from './normalization'
export { normalizeShotOrder, shotsOf } from './shotOrdering'

export {
  updateScript,
  updateSourceText,
  addEpisode,
  updateEpisode,
  removeEpisode,
  moveEpisode,
  addShot,
  updateShot,
  shotDialogueLines,
  shotDialogueTextOf,
  addShotLine,
  updateShotLine,
  speechSettingsOf,
  removeShotLine,
  removeShot,
  moveShot,
} from './editing'

export {
  addCharacter,
  addScene,
  updateCharacter,
  updateScene,
  removeCharacter,
  removeScene,
  mergeAsset,
  bindShotScene,
  toggleShotCharacter,
} from './assetEditing'

export {
  ASSET_BLOCK_HEADER,
  shotPrompt,
  assetsOfShot,
  shotRefNodeIds,
  planShotRefEdges,
  shotPromptWithAssets,
  shotVideoPrompt,
  sceneNameOf,
  characterNamesOf,
  assetBasePrompt,
  assetTurnaroundPrompt,
  storyboardStats,
  type StoryboardStats,
} from './presentation'

export { exportStoryboardMarkdown } from './markdownExport'

export {
  dismissMerge,
  setAssetNode,
  setAssetBaseHash,
  setAssetTurnaroundNode,
  setAssetTurnaroundHash,
  shotsNeedingNode,
  attachShotNodes,
  attachShotImages,
  setShotVideoNode,
  attachShotVideos,
  mergeStoryboardRunResults,
} from './mergesAndMirrors'
export { pairKey } from './rules'
