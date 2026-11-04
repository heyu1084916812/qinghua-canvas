> 本文件是**受版本控制的主副本**（`.workbuddy/release/`）。证据副本仍在 `.playwright-verify/gate-protocol/RELEASE-RUNBOOK.md`（gitignored，仅作历史留档；两者内容以本文件为准）。

# 发布 Runbook（桌面版 0.1.x）

> 只写流程，不打包、不上传。任何"上传 / push"动作必须单独获得用户显式批准（AGENTS.md）。
> 版本基线**以脚本输出为准**：`node scripts/check-versions.mjs`（2026-11-04 复核时为 `0.1.15`，六值一致）；HEAD 以当次冻结 hash 为准。

---

## 0. 红线

1. **不自动 push / 不自动上传 Release**；`release/` 已被 `.gitignore` 忽略，产物不入库。
2. **不动注册表、不自动卸载旧版**：卸载旧版必须由用户点头（它可能要备份 `data-v2`）。
3. 打包必须从**冻结 commit** 开始；工作区除已知垃圾文件外必须干净。

---

## 1. 前置检查（先跑，30 秒）

| # | 检查 | 命令 | 期望 |
|---|---|---|---|
| 1 | 冻结点 | `git rev-parse HEAD` / `git status --porcelain=v1` | 与冻结 hash 一致；未跟踪仅白名单：`$null`、`2026-01-01')`、`.workbuddy/tools/`（`gate-run.ps1:76`） |
| 2 | 门禁绿 | 最近一次 `.playwright-verify/<短hash>-<Name>/SUMMARY.md` | 结论 PASS |
| 3 | 五处版本号 | 见下表 | **五处完全一致** |
| 4 | 更新地址 | `src-tauri/tauri.conf.json → plugins.updater.endpoints` | 稳定别名（不含版本号），本项目为 `.../releases/latest/download/latest.json` |
| 5 | 私钥在位 | `Test-Path "$env:USERPROFILE\.tauri\qinghua-updater.key"` | True（或设置 `TAURI_SIGNING_PRIVATE_KEY`） |
| 6 | 端口空闲 | `Get-NetTCPConnection -LocalPort 1420,18765,18766,18767,18768` | **先退出托盘（正式版）**，四个端口全空闲；被占会 `os error 10048`（#829 就被 18765/18766 顶掉过） |

### 五处版本号（必须同值）
| 文件 | 位置 | 当前值 |
|---|---|---|
| `package.json` | `"version"` | **0.1.15** |
| `package-lock.json` | 顶层 `"version"` 与 `packages[""].version` | **0.1.15 / 0.1.15**（以脚本输出为准） |
| `src-tauri/tauri.conf.json` | `"version"` | **0.1.15** |
| `src-tauri/Cargo.toml` | `[package] version` | **0.1.15** |
| `src-tauri/Cargo.lock` | `name = "qinghua"` 段的 `version` | **0.1.15** |

> 命名约定：`<短hash>` = 7 位（`git rev-parse --short HEAD`）；门禁证据目录为 `.playwright-verify/<短hash>-<Name>/`（`Name` 由 `gate-run.ps1 -Name` 给定），`SUMMARY.md` 就在该目录下。
>
> 注意：`release-desktop.mjs` 只校验 `package.json / tauri.conf.json / Cargo.toml` 三处；**`package-lock.json` 与 `Cargo.lock` 靠 `scripts/check-versions.mjs` 兜住**。
> 对齐方式（推荐）：改完 `package.json` 后跑 `npm install --package-lock-only`（会同步 lock 的 version，不装依赖）；`Cargo.lock` 由 `cargo build` 自动刷新。

---

## 2. 对齐版本号（升版时）

```powershell
# 1) 三处主版本
#    package.json / src-tauri/tauri.conf.json / src-tauri/Cargo.toml 都改成新版本号
# 2) lock 文件
npm install --package-lock-only
cd src-tauri; cargo metadata --format-version 1 > $null; cd ..
# 3) 校验六值一致（exit 0 才算过；不要在 PowerShell 里写带引号的内联 node，PS 5.1 会吞引号）
node scripts/check-versions.mjs          # 人看；不一致时 exit 1
node scripts/check-versions.mjs --json   # CI 用
```
> 期望输出「✅ 六值一致：x.y.z」。不等就不要打包——装出来的版本、界面显示的版本、更新比较用的版本会各说各话。

---

## 3. 构建 + 出品

```powershell
node scripts/release-desktop.mjs
```

**它会做**：
1. 校验三处版本号一致、updater 地址是稳定别名；
2. `npm run tauri build -- --bundles nsis`（前端 `tsc --noEmit && vite build` → Rust → NSIS 安装包 → 签名）；**本机实测约 7–8 分钟**（Rust 增量 ~4.5 分钟 + 前端 ~4 秒 + NSIS 打包）；
3. 拒绝把危险页面打进包：正则为 `cleanup|reset|wipe|清库|清空|清理`（六个词，`release-desktop.mjs:236`），**只扫 `public/` 与 `dist/` 的一级条目**（`readdirSync` 不递归，`:238–241`）；子目录里的同名页面**拦不到**，需人工确认；
4. 从 `src-tauri/target/release/bundle/nsis/` 里**按版本号**挑 `*_<version>_*-setup.exe`（不拿第一个，防止把旧版本装进新清单）；
5. **真验签**：minisign 文本解两层 base64 → 比 keyid → 用 `tauri.conf.json` 的 `pubkey` 做 Ed25519 + BLAKE2b-512 验签；
6. 复制到 `release/<version>/`，文件名为 ASCII：`qinghua_<version>_x64-setup.exe` + `.sig` + `latest.json`；
7. 跑交付门禁 `scripts/check-release-shell.mjs`（**11/11**，会真启动一次产物），失败即报错退出。

**产物与记录**（每次都要记进发布记录）：
```powershell
$ver='0.1.15'   # 以 scripts/check-versions.mjs 输出为准
$f="release/$ver/qinghua_${ver}_x64-setup.exe"
(Get-Item $f).Length
(Get-FileHash $f -Algorithm SHA256).Hash
```
> 历史旧包参考值（基于 `21ff78d`）：43,872,671 B / `F966E723…52FB`。**仅说明字段格式，不构成基线或验收标准**；每次发版以当次实测为准。

`latest.json` 里应能看到：`version`、`pub_date`、`platforms["windows-x86_64"].url`（带版本号）、`signature`（= `.sig` 内容）。

---

## 4. 签名与 updater 配置怎么查

| 检查 | 方法 | 期望 |
|---|---|---|
| 签名与公钥同一把 | release-desktop 输出的「签名核对：Ed25519 验签通过（keyid …）」 | 出现即通过；keyid 应与 `tauri.conf.json → plugins.updater.pubkey` 解出的 keyid 相同 |
| 签名文件在位 | `release/<ver>/…exe.sig` | 436 B 左右，内容以 base64 的 `untrusted comment:` 开头 |
| 客户端更新地址 | `grep endpoints src-tauri/tauri.conf.json` | `.../releases/latest/download/latest.json`（**不得含版本号**） |
| 清单自洽 | `latest.json` 的 `signature` 与 `.sig` 文件内容逐字相同 | 相同 |

> 手改 `latest.json` 的 `signature` 而不同步 `.sig`＝客户端更新必失败，且发布机上所有检查照样绿。

---

## 5. 安装器门禁（`scripts/check-installer-windows.mjs`）

**它验什么**：静默安装 → 装出来的 exe = 刚验过启动的那份（判据是"同尺寸 + 同 PE 时间戳 + 仅 3 字节 bundle-type 标记不同"）→ 装上能打开、数据落产品文件夹 `data-v2\` → 静默卸载 → 程序清掉、**`data-v2\` 原封不动**、快捷方式与卸载登记清掉。若 `release/` 里有旧包，还会做一次**覆盖安装**验"数据不丢、老数据读得回"。

**前置条件**：**本机不能有已安装的正式版**（它要写 `HKCU` 卸载登记与桌面/开始菜单快捷方式）。

**本机现状（会挡路）**：
```
HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\轻画
  DisplayName     = 轻画
  DisplayVersion  = 0.1.10
  InstallLocation = "E:\软件\轻画"
  UninstallString = "E:\软件\轻画\uninstall.exe"
HKCU\Software\qinghua\轻画 (default) = E:\软件\轻画
```
⇒ 脚本会**直接退出**（设计如此，不硬来）。

**允许做什么 / 不许做什么**：

| 动作 | 是否允许 |
|---|---|
| 记录"未执行 + 原因（0.1.10 仍在注册表）" | ✅ 必须做 |
| 请用户决定是否卸载旧版（并先备份 `E:\软件\轻画\data-v2`） | ✅ 但必须**用户点头** |
| 自动卸载 / 自动改注册表 / 自动删快捷方式 | ❌ 禁止 |
| 用 `--force` / 手改脚本绕过前置检查 | ❌ 禁止 |

**用户点头后**的推荐顺序：备份 `data-v2` → 用户手动卸载 0.1.10（或系统设置里卸）→ 确认注册表键消失 → 再跑 `node scripts/check-installer-windows.mjs`。

---

## 6. 发布后验收（6 项，缺一不可）

| # | 项 | 判据 |
|---|---|---|
| 1 | Tag | Release tag = `v<version>`，指向冻结 commit |
| 2 | 三资产 | `qinghua_<ver>_x64-setup.exe`、同名 `.sig`、`latest.json` **都在**，名字大小写一致 |
| 3 | 同字节 | 上传后的资产 `Content-Length` == **本次**本地产物字节数（§3 当场记录；不要套用历史数字） |
| 4 | 签名一致 | 线上 `latest.json.signature` == 本地 `.sig` 全文 |
| 5 | 直链 200 | `HEAD <url>` 返回 200，且 `Content-Length` 与 §3 记的一致 |
| 6 | 稳定别名 | `releases/latest/download/latest.json` 返回的 `version` == 本次版本（老客户端靠它发现新版） |

---

## 7. 失败处置 / 回滚

- 门禁红（含 release-shell 11/11 红）⇒ **不上传**，先判归属（环境 / 本批），修完重打。
- 已上传但发现坏包：**优先发新补丁版本**；确实必须覆盖同一 tag 时，用 `git push --force-with-lease` 语义（拒绝覆盖未见过的远端提交），并在 Release 说明里写清原因。
- 严禁"顺手"把 `release/` 产物 commit 进仓库。

---

## 8. 一页命令清单（复制即用）

```powershell
# 0) 前置
git rev-parse HEAD; git status --porcelain=v1
Test-Path "$env:USERPROFILE\.tauri\qinghua-updater.key"

# 1) 版本六值一致（脚本，退出码 0 才算过）
node scripts/check-versions.mjs

# 2) 打包 + 出品 + 启动自检（7–8 分钟）
node scripts/release-desktop.mjs

# 3) 记录产物
Get-ChildItem "release/$ver"
(Get-FileHash $f -Algorithm SHA256).Hash

# 4) 安装器门禁（前置不满足会直接退出，属预期）
node scripts/check-installer-windows.mjs

# 5) 上传（**需用户显式批准**）与发布后 6 项验收（§6）
```

