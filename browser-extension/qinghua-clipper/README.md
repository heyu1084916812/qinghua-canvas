# 轻画 Clipper 浏览器扩展

轻画 Clipper 是 Chrome / Edge 的 Manifest V3 扩展，只做一件事：

> 开启拖拽收藏后，把网页图片拖到页面中央，松手即收藏到本机轻画。

扩展没有网页收藏、快捷键、右键菜单、地址输入、令牌输入或设置页。

## 工作方式

1. 扩展开关开启后，通过可选网页权限注册拖拽脚本。
2. 页面平时没有悬浮控件；开始拖动图片时才出现中央投放框。
3. 图片松手后，扩展把页面 URL、图片 URL 和标题发送到本机轻画。
4. 轻画接收端只监听 `127.0.0.1:53684`，扩展通过 `/pair` 自动获取当前临时令牌。
5. 图片进入“我的素材 → 轻画插件”，可继续加入参考、Agent 对话或画布。

浏览器重启、轻画重启后都会自动重新配对，不需要手填地址或令牌。

## 权限

- `storage`：保存拖拽开关和自动配对令牌。
- `scripting`：注册、启用或停用拖拽脚本。
- `optional_host_permissions`：只在用户开启拖拽收藏时请求 `http://*/*`、`https://*/*`。
- `host_permissions`：只允许访问本机 `http://127.0.0.1:53684/*`。

扩展不读取 Cookie、历史记录或浏览器账号数据，不使用 `<all_urls>` 简写。
自动配对接口只接受 `chrome-extension://` / `extension://` Origin。

## 本地安装

在项目根目录双击：

`scripts\install-clipper-local.cmd`

脚本会把扩展复制到系统“文档”目录：

`QinghuaClipper\extension`

然后打开 Chrome / Edge 扩展页和资源管理器。浏览器安全边界要求最后确认一次：

1. 开启开发者模式。
2. 点击“加载未打包的扩展程序”。
3. 选择 `QinghuaClipper\extension`。

Chrome / Edge 会记住这个目录，后续启动不需要重新加载。

不要直接复制文件到浏览器 User Data 下的 Extensions 目录；浏览器不会把裸复制识别为已安装扩展。

## ZIP、CRX 与商店分发

- ZIP 是商店提交包，也是本地解压后“加载未打包的扩展程序”的包。
- Chrome 的“打包扩展程序”会生成 `.crx` 和 `.pem`，但 Windows Chrome 默认阻止来自商店外的 CRX 安装。
  因此不能把 `.crx` 当作通用的一键安装分发格式。
- 要实现普通用户真正的一键安装，仍需 Edge Add-ons 或 Chrome Web Store 上架。

构建 ZIP：

```powershell
npm run package:clipper-extension
```

产物位于 `release/qinghua-clipper-0.4.1.zip`。

## 排错

- 开关打不开：确认允许扩展访问网页。
- 出现 “Only permissions specified in the manifest may be requested.”：扩展页里点一次“重新加载”，
  确认运行的是 0.4.1 或更新版本。
- 页面中不出现投放框：确认开关已开启，并刷新打开扩展前已经存在的旧标签页。
- 拖入后提示轻画未打开：先启动轻画桌面端；扩展会自动重新连接。
- 图片没有生成卡片：轻画“我的素材 → 轻画插件”面板打开后会每 3 秒取走待收图片。
