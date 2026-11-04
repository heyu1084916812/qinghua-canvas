# 真实渠道验收脚本（real-channels）

> 受版本控制的主脚本：`.workbuddy/tools/real-channels.mjs`
> 证据目录（`.playwright-verify/<...>/`）**只放每次跑的产物**，脚本本身不再复制进去。

## 1. 用法

```powershell
# Workbuddy 真实文本（默认）
node .workbuddy/tools/real-channels.mjs --mode=workbuddy

# Chat2api（workbuddy 文本 + 最小生图；上游阻断时按 BLOCKED 收口）
node .workbuddy/tools/real-channels.mjs --mode=chat2api

# 常用覆盖项
node .workbuddy/tools/real-channels.mjs --mode=workbuddy `
  --app="src-tauri/target/release/qinghua.exe" `
  --out=".playwright-verify/2026-11-04-my-run" `
  --port=18778 --cdp-port=9356 --gateway-port=28796 `
  --source-store="http://127.0.0.1:28795"
```

| 参数 | 默认 | 说明 |
|---|---|---|
| `--mode` | `workbuddy` | `workbuddy` / `chat2api` |
| `--app` | `<repo>/src-tauri/target/release/qinghua.exe` | 被测壳 |
| `--out` | `.playwright-verify/<时间戳>-real-channels-<mode>` | 证据目录（脚本自动建） |
| `--port` | workbuddy `18778` / chat2api `18773` | 隔离 store 端口 |
| `--cdp-port` | `9356` / `9351` | WebView2 调试端口 |
| `--gateway-port` | `28796` | 壳内 canvas gateway 端口（避开 18768） |
| `--source-store` | `http://127.0.0.1:28795` | 只读源库（真实渠道 + 凭据） |

## 2. 前置（每次都要）

1. **源库**：`data-v2/manifest.sqlite` 的**只读副本**，起在 28795：
   ```powershell
   qinghua-store.exe --data-dir <证据>/source-v2 --backend v2 --port 28795
   ```
   脚本只对它 `/query`、`/kv/get`，**不写**。
2. 端口 `18765 / 18766 / 18767 / 18768` **不占用**（用户托盘/开发实例）；需要时先退出托盘。
3. **不加** `--disable-web-security`：通道请求走壳内原生/网关。
4. 跑完脚本会自己杀掉它启动的壳；源库由人工停止（按 PID）。

## 3. 判据

| 模式 | PASS 条件 |
|---|---|
| workbuddy | job `replied/completed` + `assistantText` 含「验收通过」+ `agentMessages` 有 user+assistant + `pageErrors=[]`/`consoleErrors=[]` + **账实相符** |
| chat2api | 上述 workbuddy 段 **且** 生图 job `completed` + `runRecord.outputHashes` 有 1 个 asset；上游 5xx 时按 BLOCKED 记 `lastError` 原话，不硬凑绿 |

### 三条发送审计断言（2026-11-04 加）
1. **发送审计**：`sendAndWaitJob()` 每次调用 `sendAudit.push({at, sessionId, text, caller:'harness'})`；
2. **账实相符**：`agentMessages` 中 `role=user` 行数 === `sendAudit` 条数（文本一一配对）；差 1 即红并打印多出那条的文本 + 毫秒时间戳；
3. **窗口可交互声明**：结果固定带 `windowInteractive: true` 与 `sendAudit` 明细，`SUMMARY.md` 人类可读部分也写一句。

## 4. 红/绿标定（2026-11-04 实测）

| 方向 | 结果 |
|---|---|
| 绿（正常跑） | `{declaredSends:1, userRows:1, extra:[], ok:true}` → `workbuddy-pass`，exit 0 |
| 红（审计前注入一条假 user 消息） | `{declaredSends:1, userRows:2}`，打印 `多出的 user 消息：{"text":"hi（红路径标定：外部注入）","at":"2026-11-04T10:34:45.433Z"}` → `workbuddy-blocked`，exit 1 |

### ⚠️ 注入时机的坑（必须记住）
App 的 `saveMessages` 是**「删掉该会话所有旧行 → 重插新列表」**。
所以桩如果插在 send 之后、盘存之前，会被整表覆盖，**红路径不会红**（第一次标定就踩了这个坑）。
正确做法：**在审计前一刻注入，并重新读库**（`auditSends(sessionId, await messagesFor(sessionId))`）。

## 5. 局限
- 只能证明"库里多出来"，不能证明是谁敲的（要溯源需窗口级输入审计，未做）；
- 我们与外部发**完全相同文本**时无法区分，需再比 `createdAt` 是否落在 `sendAudit.at ± 5s`。

## 6. 产出

```
<out>/
  result.json        # 机器读（含 sendAudit / windowInteractive / job / assetHash）
  SUMMARY.md         # 人读（结论 + 数字 + 可交互声明）
  app.log            # 壳日志（gateway 起在哪个端口）
  workbuddy-sent.png / workbuddy-result.png（chat2api 模式另有 chat2api-*.png）
  data-v2/ localappdata/ webview2-profile/   # 隔离运行态，排查用
```
