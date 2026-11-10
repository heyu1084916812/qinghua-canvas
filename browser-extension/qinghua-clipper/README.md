# 轻画 Clipper 浏览器扩展

**这是一个独立的 Chrome / Edge MV3 扩展，不是轻画页面插件。** 扩展从浏览器工具栏、快捷键或右键菜单启动；
轻画桌面端只负责接收网页地址、重新读取公开页面图片并写入画布素材。要在商店“一键安装”，需要将本目录
打包后提交 Chrome Web Store / Edge Add-ons；本地开发者模式加载只是开发和内部验收方式。

轻画 Clipper 是 Chrome / Edge 的 Manifest V3 扩展。它把当前公开网页的地址和标题发送到本机轻画，
由轻画读取页面 Open Graph 图片并写入“我的素材 → 轻画插件”收藏。

## 功能

- 点击扩展图标，确认当前网页后一键收藏。
- 快捷键 `Ctrl+Shift+Y`（macOS 为 `Command+Shift+Y`）直接收藏当前页。
- 右键网页或链接，选择“收藏当前页到轻画”。
- 自动检测 `http://127.0.0.1:53684/health`，明确显示在线、离线、超时和令牌错误。
- 配对令牌只保存在扩展自己的 `chrome.storage.local`，不写入日志。
- 只访问 `127.0.0.1:53684`，不读取 Cookie、历史记录或其他网站数据。

## 安装

1. 打开 `chrome://extensions` 或 `edge://extensions`。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”，指向本目录。
4. 在轻画画布打开“我的素材 → 轻画插件 → 浏览器扩展配对”。
5. 把本机地址与配对令牌填入扩展设置，点击“保存并检测”。

扩展安装是浏览器安全边界内的用户动作，轻画不会静默安装。

## 打包

在本项目根目录运行：

```powershell
npm run package:clipper-extension
```

产物写入 `release/qinghua-clipper-0.2.0.zip`，脚本同时输出文件大小和 SHA-256。商店上传使用该 ZIP；
本地开发仍建议直接“加载已解压的扩展程序”指向本目录。

## 使用

- 工具栏：点击轻画 Clipper 图标，再点击“收藏到轻画”。
- 快捷键：在普通 HTTP/HTTPS 网页按 `Ctrl+Shift+Y`。
- 右键菜单：选择“收藏当前页到轻画”。

扩展只发送当前 URL、标题与配对令牌。页面图片由轻画桌面端根据公开 URL 重新采集，所以轻画桌面端
需要保持运行。Chrome 内部页、扩展页、`file://` 页面和浏览器设置页不能收藏。

## 排错

- **无法连接轻画**：确认轻画桌面端已启动，并在轻画插件页确认接收端状态。
- **令牌无效**：重新从轻画复制配对令牌；令牌会随应用运行实例变化。
- **已发送但没有图片**：目标页面可能没有 Open Graph 图片、拒绝访问或需要登录。扩展不会读取 Cookie。
- **快捷键冲突**：打开 `chrome://extensions/shortcuts` 修改快捷键。

## 参考

- Chrome 扩展 Manifest V3：`https://developer.chrome.com/docs/extensions/reference/manifest`
- Chrome `activeTab`：`https://developer.chrome.com/docs/extensions/develop/concepts/activeTab`
- Chrome `contextMenus`：`https://developer.chrome.com/docs/extensions/reference/api/contextMenus`
- Lovart Clipper 商店页：`https://chromewebstore.google.com/detail/lovart-clipper-collect-we/bkaheknlfjbmlnmlkmdjkcnfklnjbgeg`
