//! 原生网页视图（2026-11-13，画布浏览器从 iframe 换成 Tauri 2 子 webview）。
//!
//! 为什么：iframe 被 X-Frame-Options / CSP 挡掉大半设计站，跨域也读不到 DOM。
//! 这里用系统 WebView（Windows = WebView2，macOS = WKWebView；**不打包 CEF**）
//! 作为主窗口的**子 webview** 叠在画布浏览器的内容区上：
//!
//! - 所有视图共用一份独立数据目录 `<app local data>/browser-profile`（macOS 用固定的
//!   data store identifier），登录状态跨重启保留；下一步 Agent 的隐藏视图复用同一份。
//! - 原生层永远画在 DOM 之上：前端负责在 DOM 浮层盖上来时 `browser_view_hide`。
//! - 远端页面**没有** IPC 权限：`capabilities/default.json` 只授给本地源（没有 `remote`），
//!   所以这里不需要改 capability；只能由主窗口调这些命令。
//! - 事件统一发到主窗口：`browser-view:event`，payload `{ id, kind, url?, title? }`。
//!
//! - `browser_view_extract`：在当前页执行前端给的提取脚本（同 Agent 浏览器那份），
//!   画布浏览器的「交给 Agent」用它把当前网页的图片带进对话（2026-11-13 #1089）。
//!
//! Windows 上创建 webview 不能在同步命令里做（WebView2 会死锁，见 wry#583），
//! 所以所有命令都是 `async`。

use crate::browser_view_rules::{
    is_allowed_navigation, view_id_of_label, view_label, EVENT_NAME, PROFILE_DIR,
};
use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Url, Webview,
    WebviewUrl,
};

/// 与前端 `BrowserViewBounds` 对应：主窗口内容区里的 CSS 像素（= 逻辑像素）。
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct ViewBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl ViewBounds {
    fn rect(self) -> Rect {
        Rect {
            position: LogicalPosition::new(self.x.max(0.0), self.y.max(0.0)).into(),
            size: LogicalSize::new(self.width.max(1.0), self.height.max(1.0)).into(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ViewEvent<'a> {
    id: &'a str,
    kind: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<&'a str>,
}

/// macOS（WKWebView 不支持 data_directory）用的固定数据仓库 id；其他平台忽略。
pub(crate) const MAC_DATA_STORE_ID: [u8; 16] = *b"qinghua-browser1";

fn emit(app: &AppHandle, event: ViewEvent<'_>) {
    let _ = app.emit_to("main", EVENT_NAME, event);
}

pub(crate) fn parse_target(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|e| format!("网址无效：{e}"))?;
    if !is_allowed_navigation(url.scheme(), url.host_str()) {
        return Err("只能打开公开的 http / https 网页".into());
    }
    Ok(url)
}

fn find(app: &AppHandle, id: &str) -> Result<Webview, String> {
    let label = view_label(id)?;
    app.get_webview(&label)
        .ok_or_else(|| format!("浏览器视图 {id} 还没打开"))
}

pub(crate) fn profile_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("找不到应用数据目录：{e}"))?;
    let dir = base.join(PROFILE_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("建浏览器数据目录失败：{e}"))?;
    Ok(dir)
}

fn builder(
    app: &AppHandle,
    label: &str,
    url: Url,
) -> Result<WebviewBuilder<tauri::Wry>, String> {
    let nav_app = app.clone();
    let nav_label = label.to_string();
    let load_app = app.clone();
    let title_app = app.clone();
    let popup_app = app.clone();
    let popup_label = label.to_string();
    Ok(WebviewBuilder::new(label, WebviewUrl::External(url))
        .data_directory(profile_dir(app)?)
        .data_store_identifier(MAC_DATA_STORE_ID)
        .on_navigation(move |url| {
            let allowed = is_allowed_navigation(url.scheme(), url.host_str());
            if !allowed {
                if let Some(id) = view_id_of_label(&nav_label) {
                    emit(
                        &nav_app,
                        ViewEvent { id, kind: "blocked", url: Some(url.as_str()), title: None },
                    );
                }
            }
            allowed
        })
        .on_page_load(move |webview, payload| {
            let Some(id) = view_id_of_label(webview.label()) else { return };
            let kind = match payload.event() {
                PageLoadEvent::Started => "loadStarted",
                PageLoadEvent::Finished => "loadFinished",
            };
            emit(
                &load_app,
                ViewEvent { id, kind, url: Some(payload.url().as_str()), title: None },
            );
        })
        .on_document_title_changed(move |webview, title| {
            let Some(id) = view_id_of_label(webview.label()) else { return };
            emit(&title_app, ViewEvent { id, kind: "title", url: None, title: Some(&title) });
        })
        // `target=_blank` / `window.open`：不另开窗口，在同一个视图里打开（公开地址才跟）
        .on_new_window(move |url, _features| {
            if is_allowed_navigation(url.scheme(), url.host_str()) {
                if let Some(view) = popup_app.get_webview(&popup_label) {
                    let _ = view.navigate(url);
                }
            }
            NewWindowResponse::Deny
        }))
}

#[tauri::command]
pub async fn browser_view_open(
    app: AppHandle,
    id: String,
    url: String,
    bounds: ViewBounds,
    visible: Option<bool>,
) -> Result<(), String> {
    let label = view_label(&id)?;
    let target = parse_target(&url)?;
    if let Some(existing) = app.get_webview(&label) {
        existing.set_bounds(bounds.rect()).map_err(|e| e.to_string())?;
        existing.navigate(target).map_err(|e| e.to_string())?;
        if visible.unwrap_or(true) {
            existing.show().map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let window = app
        .get_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;
    let rect = bounds.rect();
    let webview = window
        .add_child(builder(&app, &label, target)?, rect.position, rect.size)
        .map_err(|e| format!("打开浏览器视图失败：{e}"))?;
    if !visible.unwrap_or(true) {
        webview.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_view_navigate(
    app: AppHandle,
    id: String,
    url: String,
) -> Result<(), String> {
    let target = parse_target(&url)?;
    find(&app, &id)?.navigate(target).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_view_back(app: AppHandle, id: String) -> Result<(), String> {
    find(&app, &id)?.eval("history.back()").map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_view_forward(app: AppHandle, id: String) -> Result<(), String> {
    find(&app, &id)?.eval("history.forward()").map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_view_reload(app: AppHandle, id: String) -> Result<(), String> {
    find(&app, &id)?.reload().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_view_stop(app: AppHandle, id: String) -> Result<(), String> {
    find(&app, &id)?.eval("window.stop()").map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_view_set_bounds(
    app: AppHandle,
    id: String,
    bounds: ViewBounds,
) -> Result<(), String> {
    find(&app, &id)?.set_bounds(bounds.rect()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_view_show(app: AppHandle, id: String) -> Result<(), String> {
    find(&app, &id)?.show().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_view_hide(app: AppHandle, id: String) -> Result<(), String> {
    // 视图还没建好时隐藏是无害的空操作（前端浮层可能比视图先出现）
    match app.get_webview(&view_label(&id)?) {
        Some(view) => view.hide().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[tauri::command]
pub async fn browser_view_close(app: AppHandle, id: String) -> Result<(), String> {
    match app.get_webview(&view_label(&id)?) {
        Some(view) => view.close().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// 在当前页执行提取脚本并取回结果（脚本须同步返回 `JSON.stringify(...)` 字符串）。
/// 只有主窗口（本地源）能调这个命令；远端页面没有 IPC 权限。
#[tauri::command]
pub async fn browser_view_extract(
    app: AppHandle,
    id: String,
    script: String,
) -> Result<String, String> {
    let view = find(&app, &id)?;
    let raw = crate::agent_browser::eval_capture(
        |callback| view.eval_with_callback(script, callback),
        std::time::Duration::from_secs(8),
    )
    .await?;
    crate::agent_browser::decode_script_result(&raw)
}
