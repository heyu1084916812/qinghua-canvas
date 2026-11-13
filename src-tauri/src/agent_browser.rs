//! Agent 后台浏览器（2026-11-13，对账 #1087）：隐藏的独立 `WebviewWindow`，给 Agent 抓
//! 只能在真实浏览器里打开的设计站（Dribbble / The Dieline / Packaging of the World / Pinterest）。
//!
//! - label `agent-browser-<id>`，`visible(false)`；与画布浏览器（`browser_view.rs`）**同一个
//!   数据目录 / macOS data store**，用户在画布浏览器里登录一次，Agent 这边直接带登录态。
//! - 导航白名单与画布浏览器同一套：只放行公开 http(s)；`target=_blank` 在同一窗口打开。
//! - 远端页面**没有** IPC：capability 只授给 `main` 窗口。
//! - `agent_browser_load`：导航 → 轮询 `document.readyState`（带旧文档标记，避免把导航前的页面
//!   当成已加载）→ 往下滚几屏让懒加载图片出来 → 沉降 → 执行前端给的提取脚本，原样返回它的
//!   JSON 字符串。识别验证页 / 登录墙在前端做（纯函数，可单测）。
//! - 遇到验证 / 登录墙：前端调 `agent_browser_show` 把这个窗口亮给用户处理，用户点「继续」后
//!   `agent_browser_hide` 再重新 `load`。用户直接关掉窗口 = 隐藏并发 `closed` 事件，窗口保留复用。
//!
//! Windows 上创建 webview 不能在同步命令里做（WebView2 死锁，wry#583），所以命令全是 `async`。

use crate::agent_browser_rules::{
    agent_id_of_label, agent_label, clamp_timing, is_ready, mark_script, ready_probe_script,
    scroll_script, unquote_simple, AGENT_EVENT_NAME,
};
use crate::browser_view::{parse_target, profile_dir, MAC_DATA_STORE_ID};
use crate::browser_view_rules::is_allowed_navigation;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadOptions {
    pub timeout_ms: Option<u64>,
    pub settle_ms: Option<u64>,
    pub scroll_steps: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentEvent<'a> {
    id: &'a str,
    kind: &'a str,
}

static NONCE: AtomicU64 = AtomicU64::new(1);

/// 执行一段脚本并等它的回调（WebView2 / WKWebView 都把结果 JSON 序列化后交回）。
/// 页面正在跳转时回调可能永远不来，所以必须有超时。
pub(crate) async fn eval_capture<F>(start: F, timeout: Duration) -> Result<String, String>
where
    F: FnOnce(Box<dyn Fn(String) + Send + 'static>) -> tauri::Result<()>,
{
    let slot: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let writer = slot.clone();
    start(Box::new(move |value: String| {
        if let Ok(mut guard) = writer.lock() {
            if guard.is_none() {
                *guard = Some(value);
            }
        }
    }))
    .map_err(|e| format!("执行页面脚本失败：{e}"))?;
    let deadline = Instant::now() + timeout;
    loop {
        let taken = slot.lock().ok().and_then(|mut guard| guard.take());
        if let Some(value) = taken {
            return Ok(value);
        }
        if Instant::now() >= deadline {
            return Err("页面脚本没有响应（可能仍在跳转）".into());
        }
        tokio::time::sleep(Duration::from_millis(40)).await;
    }
}

/// 提取脚本返回的是 `JSON.stringify(...)` 字符串；回调里拿到的是它再序列化一次的结果。
pub(crate) fn decode_script_result(raw: &str) -> Result<String, String> {
    match serde_json::from_str::<serde_json::Value>(raw.trim()) {
        Ok(serde_json::Value::String(text)) => Ok(text),
        Ok(serde_json::Value::Null) | Err(_) if raw.trim().is_empty() => {
            Err("页面脚本没有返回结果".into())
        }
        Ok(serde_json::Value::Null) => Err("页面脚本出错（返回空）".into()),
        Ok(other) => Ok(other.to_string()),
        Err(e) => Err(format!("页面脚本结果无法解析：{e}")),
    }
}

fn emit(app: &AppHandle, id: &str, kind: &str) {
    let _ = app.emit_to("main", AGENT_EVENT_NAME, AgentEvent { id, kind });
}

fn find(app: &AppHandle, id: &str) -> Result<WebviewWindow, String> {
    let label = agent_label(id)?;
    app.get_webview_window(&label)
        .ok_or_else(|| format!("Agent 浏览器 {id} 还没打开"))
}

fn build_window(app: &AppHandle, label: &str, url: tauri::Url) -> Result<WebviewWindow, String> {
    let popup_app = app.clone();
    let popup_label = label.to_string();
    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::External(url))
        .title("轻画 · Agent 浏览器")
        .inner_size(1280.0, 900.0)
        .visible(false)
        .focused(false)
        .data_directory(profile_dir(app)?)
        .data_store_identifier(MAC_DATA_STORE_ID)
        .on_navigation(|url| is_allowed_navigation(url.scheme(), url.host_str()))
        .on_new_window(move |url, _features| {
            if is_allowed_navigation(url.scheme(), url.host_str()) {
                if let Some(window) = popup_app.get_webview_window(&popup_label) {
                    let _ = window.navigate(url);
                }
            }
            NewWindowResponse::Deny
        })
        .build()
        .map_err(|e| format!("打开 Agent 浏览器失败：{e}"))?;
    // 用户关掉亮出来的窗口：只隐藏（保留复用），并告诉前端「用户处理完了 / 不想处理」
    let close_app = app.clone();
    let close_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = close_window.hide();
            if let Some(id) = agent_id_of_label(close_window.label()) {
                emit(&close_app, id, "closed");
            }
        }
    });
    Ok(window)
}

/// 等导航后的新文档加载完成。`complete` 最好；过了一半时限还停在 `interactive` 也接受
/// （有的站长连接 / 大图让 load 事件迟迟不来，DOM 已经够用了）。
async fn wait_ready(window: &WebviewWindow, nonce: u64, timeout_ms: u64) -> Result<(), String> {
    let started = Instant::now();
    let total = Duration::from_millis(timeout_ms);
    loop {
        let probe = eval_capture(
            |callback| window.eval_with_callback(ready_probe_script(nonce), callback),
            Duration::from_millis(1_500),
        )
        .await
        .unwrap_or_default();
        if is_ready(&probe) {
            return Ok(());
        }
        let half_way = started.elapsed() >= total / 2;
        if half_way && unquote_simple(&probe) == Some("interactive|0") {
            return Ok(());
        }
        if started.elapsed() >= total {
            return Err("页面加载超时".into());
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

/// 打开（或复用）隐藏窗口 → 导航 → 等加载 → 滚动 → 执行提取脚本，返回脚本的 JSON 字符串。
#[tauri::command]
pub async fn agent_browser_load(
    app: AppHandle,
    id: String,
    url: String,
    script: String,
    options: Option<LoadOptions>,
) -> Result<String, String> {
    let label = agent_label(&id)?;
    let target = parse_target(&url)?;
    let options = options.unwrap_or_default();
    let timing = clamp_timing(options.timeout_ms, options.settle_ms, options.scroll_steps);
    let nonce = NONCE.fetch_add(1, Ordering::Relaxed);
    let window = match app.get_webview_window(&label) {
        Some(window) => {
            // 先在旧文档上打标记，再跳转：就绪探针据此区分新旧文档
            let _ = eval_capture(
                |callback| window.eval_with_callback(mark_script(nonce), callback),
                Duration::from_millis(1_500),
            )
            .await;
            window.navigate(target).map_err(|e| e.to_string())?;
            window
        }
        None => build_window(&app, &label, target)?,
    };
    wait_ready(&window, nonce, timing.timeout_ms).await?;
    for _ in 0..timing.scroll_steps {
        let _ = window.eval(scroll_script(false));
        tokio::time::sleep(Duration::from_millis(350)).await;
    }
    tokio::time::sleep(Duration::from_millis(timing.settle_ms)).await;
    let raw = eval_capture(
        |callback| window.eval_with_callback(script, callback),
        Duration::from_secs(8),
    )
    .await?;
    if timing.scroll_steps > 0 {
        let _ = window.eval(scroll_script(true));
    }
    decode_script_result(&raw)
}

/// 不跳转，直接在当前页执行提取脚本（用户处理完验证 / 登录、页面已在结果页时用）。
#[tauri::command]
pub async fn agent_browser_snapshot(
    app: AppHandle,
    id: String,
    script: String,
) -> Result<String, String> {
    let window = find(&app, &id)?;
    let raw = eval_capture(
        |callback| window.eval_with_callback(script, callback),
        Duration::from_secs(8),
    )
    .await?;
    decode_script_result(&raw)
}

/// 把隐藏窗口亮给用户（处理验证码 / 登录）。
#[tauri::command]
pub async fn agent_browser_show(
    app: AppHandle,
    id: String,
    title: Option<String>,
) -> Result<(), String> {
    let window = find(&app, &id)?;
    if let Some(title) = title.filter(|t| !t.trim().is_empty()) {
        let _ = window.set_title(&title);
    }
    let _ = window.center();
    window.show().map_err(|e| e.to_string())?;
    let _ = window.unminimize();
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
pub async fn agent_browser_hide(app: AppHandle, id: String) -> Result<(), String> {
    match app.get_webview_window(&agent_label(&id)?) {
        Some(window) => window.hide().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// 销毁窗口（登录在数据目录里，下次打开仍在）。
#[tauri::command]
pub async fn agent_browser_close(app: AppHandle, id: String) -> Result<(), String> {
    match app.get_webview_window(&agent_label(&id)?) {
        Some(window) => window.destroy().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::decode_script_result;

    #[test]
    fn decodes_stringified_payload() {
        assert_eq!(decode_script_result("\"{\\\"a\\\":1}\"").unwrap(), "{\"a\":1}");
        assert_eq!(decode_script_result("{\"a\":1}").unwrap(), "{\"a\":1}");
        assert!(decode_script_result("null").is_err());
        assert!(decode_script_result("").is_err());
        assert!(decode_script_result("not json").is_err());
    }
}
