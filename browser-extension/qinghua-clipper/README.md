# 轻画 Clipper 浏览器扩展

**这是一个独立的 Chrome / Edge MV3 扩展，不是轻画页面插件。** 扩展从浏览器工具栏、快捷键、右键菜单
或临时拖拽投放区启动；轻画桌面端负责接收网页地址或单张图片地址，并写入画布素材。要在商店“一键安装”，
需要将本目录打包后提交 Chrome Web Store / Edge Add-ons；本地开发者模式加载只是开发和内部验收方式。

轻画 Clipper 是 Chrome / Edge 的 Manifest V3 扩展。普通收藏会把当前公开网页地址和标题发送到本机轻画，
由轻画读取页面 Open Graph 图片；拖拽或右键图片收藏则直接发送页面地址、图片地址和标题。
两种方式都写入“我的素材 → 轻画插件”收藏。

## 功能

- 点击扩展图标，确认当前网页后一键收藏。
- 点击「拖拽图片收藏」后在当前网页开启投放区，把图片直接拖进去即可收藏。
- 快捷键 `Ctrl+Shift+Y`（macOS 为 `Command+Shift+Y`）直接收藏当前页。
- 右键网页、链接或图片，选择对应的“收藏到轻画”。
- 自动检测 `http://127.0.0.1:53684/health`，明确显示在线、离线、超时和令牌错误。
- 配对令牌只保存在扩展自己的 `chrome.storage.local`，不写入日志。
- 只访问 `127.0.0.1:53684`，不读取 Cookie、历史记录或其他网站数据。
- `scripting` 权限只在用户点击“拖拽图片收藏”后通过 `activeTab` 注入当前页投放区；
  不常驻 content script，也没有 `<all_urls>` 权限。

## 安装

### 本地脚本辅助安装

在项目根目录双击 `scripts\install-clipper-local.cmd`，脚本会：

1. 把扩展复制到 `%LOCALAPPDATA%\Qinghua\Clipper\extension`；
2. 把稳定目录复制到剪贴板；
3. 打开 Chrome / Edge 扩展管理页和资源管理器。

浏览器安全边界仍要求最后手动确认一次：开启开发者模式，点击“加载未打包的扩展程序”，
粘贴剪贴板路径并选择该目录。之后浏览器会记住目录，无需重复安装。

也可以仅准备文件而不打开窗口：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-clipper-local.ps1 -PrepareOnly
```

脚本明确拒绝直接向浏览器用户数据目录复制文件，因为 Chrome / Edge 不会把这种复制识别为已安装扩展。

### 手动安装

1. 打开 `chrome://extensions` 或 `edge://extensions`。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”，指向本目录。
4. 在轻画画布打开“我的素材 → 轻画插件 → 浏览器扩展配对”。
5. 把本机地址与配对令牌填入扩展设置，点击“保存并检测”。

扩展安装是浏览器安全边界内的用户动作，轻画不会静默安装。

## 侧栏一键安装

轻画「我的素材 → 轻画插件」会显示安装卡。商店上架后，把公开详情页写入构建环境：

```powershell
$env:VITE_QINGHUA_CLIPPER_EDGE_STORE_URL='https://microsoftedge.microsoft.com/addons/detail/...'
$env:VITE_QINGHUA_CLIPPER_CHROME_STORE_URL='https://chromewebstore.google.com/detail/...'
npm run dev
```

Edge 和 Chrome 的详情页可分别配置，侧栏会显示两个独立的一键安装入口。
用户点击后由系统浏览器打开对应商店详情页，再在浏览器原生确认框中完成添加。
浏览器不允许网页或桌面应用跳过这一步。未配置商店地址时，安装卡只显示离线安装说明，
不会伪装成可直接静默安装。

商店审核期间可通过 `VITE_QINGHUA_CLIPPER_PACKAGE_URL` 指向公开 ZIP 下载地址；
该入口会明确标为「下载扩展包」，不会冒充一键商店安装。

Edge Add-ons 开发者注册免费；Chrome Web Store 开发者注册当前是一次性收费，
这是平台侧外部成本，不在扩展代码内。Chrome 与 Edge 共用同一份 Manifest V3 包。

## 打包

在本项目根目录运行：

```powershell
npm run package:clipper-extension
```

产物写入 `release/qinghua-clipper-0.3.0.zip`，脚本同时输出文件大小和 SHA-256。商店上传使用该 ZIP；
本地开发仍建议直接“加载已解压的扩展程序”指向本目录。

## 使用

- 工具栏：点击轻画 Clipper 图标，再点击“收藏到轻画”。
- 拖拽：在扩展里点“拖拽图片收藏”，回到当前网页把图片拖进右下角投放区。
- 快捷键：在普通 HTTP/HTTPS 网页按 `Ctrl+Shift+Y`。
- 右键菜单：网页 / 链接可收藏当前页，图片可收藏这一张。

普通收藏发送当前 URL、标题与配对令牌，由轻画桌面端根据公开 URL 重新采集页面图片；
拖拽和右键图片会额外发送该图片的公开 HTTP/HTTPS 地址，桌面端直接形成单图收藏。
轻画桌面端需要保持运行。Chrome 内部页、扩展页、`file://` 页面和浏览器设置页不能收藏。

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
