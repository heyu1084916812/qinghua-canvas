import type { PlatformKit } from '../ports'
import { createWebPlatform } from '../web/index'
import { createTauriAssetFolder } from './tauriAssetFolder'
import { createTauriAgentBrowser } from './tauriAgentBrowser'
import { createTauriBrowserView } from './tauriBrowserView'
import { createTauriCli } from './tauriCli'
import { createTauriCredentials } from './tauriCredentials'
import { createTauriFiles } from './tauriFiles'
import { createTauriNotify } from './tauriNotify'
import { createTauriRemoteBytes } from './tauriRemoteBytes'
import { createTauriStorageAdmin } from './tauriStorageAdmin'
import { createTauriUpdater } from './tauriUpdater'

/**
 * **桌面壳（Tauri 2）的平台装配**（《轻画-桌面封装方案.md》§4.3）。
 *
 * 只换**操作系统那一层**，其余全部复用 Web 那一份 —— 因为壳里跑的本来就是一个浏览器：
 * 共享存储、`fetch` 网络、共享凭据端口、`<video>`/WebGL、mediapipe 全都照旧。
 * 真正"只有壳能做"的只有两件事，也正是这里被替换的两个端口：
 * - `assetFolder`：目录不再是 FSA 句柄，而是原生目录（Rust 侧弹框 + 授权）；
 * - `files`：打开 / 另存为对话框（WebView2 的行为与 Chrome 不完全一致，走原生更确定）。
 *
 * ⇒ 上层（画布、素材、导入导出）**一行都不用改**：它们只认端口。
 */
export function createDesktopPlatform(): PlatformKit {
  return createWebPlatform({
    assetFolder: createTauriAssetFolder(),
    files: createTauriFiles(),
    // 壳里多出来的一档能力（方案 §5）：自动更新
    updater: createTauriUpdater(),
    // 壳里多出来的一档能力（对账 #261）：数据目录 / 打开目录 / 网页缓存
    storageAdmin: createTauriStorageAdmin(),
    // 壳里多出来的一档能力（对账 #308）：真的起本机 CLI 子进程
    cli: createTauriCli(),
    // 壳里多出来的一档能力（对账 #396）：原生 HTTP 取字节，绕开跨域抓站点图标
    remoteBytes: createTauriRemoteBytes(),
    // 壳里多出来的一档能力（对账 #392）：真的系统通知（官方插件）
    notify: createTauriNotify(),
    // 壳里多出来的一档能力（2026-11-13）：系统 WebView 子视图，画布浏览器与 Agent 共用登录目录
    browserView: createTauriBrowserView(),
    // 壳里多出来的一档能力（2026-11-13，#1087）：隐藏 WebviewWindow，Agent 抓浏览器专用设计站
    agentBrowser: createTauriAgentBrowser(),
    // API Key 交给 Windows DPAPI 加密（绑定当前用户），旧格式读取时自动迁移
    credentials: createTauriCredentials(),
  })
}
