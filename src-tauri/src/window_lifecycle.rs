use crate::current_data_dir;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, State};

/// 存盘用的窗口几何（物理像素）。
///
/// 位置取**外框**左上角、尺寸取**内尺寸** —— 两者在 `decorations: false` 下同一个矩形，
/// 所以这里不用纠结"边框几个像素"，与 Tauri 的 `set_size`（设的是内尺寸）也自洽。
#[derive(serde::Serialize, serde::Deserialize, Clone, Copy, PartialEq, Debug)]
struct WindowGeometry {
    x: i32,
    y: i32,
    w: u32,
    h: u32,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Copy, PartialEq, Debug, Default)]
struct SavedWindow {
    #[serde(default)]
    geometry: Option<WindowGeometry>,
    /// 上次退出时是不是最大化（是的话下次直接最大化开）
    #[serde(default)]
    maximized: bool,
}

/// 最小可用尺寸（与 `tauri.conf.json` 的 `minWidth` / `minHeight` 一致）
const WINDOW_MIN_W: u32 = 1024;
const WINDOW_MIN_H: u32 = 700;

/// 一块屏幕的可见区域（物理像素）
#[derive(Clone, Copy, Debug)]
struct MonitorRect {
    x: i32,
    y: i32,
    w: u32,
    h: u32,
}

/// **这条几何还能用吗**（纯函数）。
///
/// 场景：上次在副屏 / 大分辨率下用的窗口，这次副屏拔了 —— 直接照搬会把窗口放回一块
/// 不存在的屏幕，用户看到的是"点了图标什么都没出现"（窗口在屏幕外）。所以：
/// - 尺寸先夹到不小于最小可用尺寸、不大于那块屏幕；
/// - **左上角（标题栏那一带）必须落在某块屏幕里**，且至少露出 `200 × 100` ——
///   拖得回来、也点得到；
/// - 一块都放不下就返回 `None`，调用方回落到"居中"。
fn sanitize_geometry(geo: WindowGeometry, monitors: &[MonitorRect]) -> Option<WindowGeometry> {
    let w = geo.w.max(WINDOW_MIN_W);
    let h = geo.h.max(WINDOW_MIN_H);
    for m in monitors {
        let min_x = m.x - (w as i32 - 200);
        let max_x = m.x + m.w as i32 - 200;
        let min_y = m.y;
        let max_y = m.y + m.h as i32 - 100;
        if geo.x >= min_x && geo.x <= max_x && geo.y >= min_y && geo.y <= max_y {
            return Some(WindowGeometry {
                x: geo.x,
                y: geo.y,
                w: w.min(m.w),
                h: h.min(m.h),
            });
        }
    }
    None
}

/// 存盘位置：与数据目录同一处（`<数据目录>/window.json`）——
/// 用户 2026-10-06 要求"一个文件夹装数据"，窗口位置也是这份数据的一部分。
fn window_state_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    Some(current_data_dir(app)?.join("window.json"))
}

fn read_window_state(app: &tauri::AppHandle) -> Option<SavedWindow> {
    let text = std::fs::read_to_string(window_state_file(app)?).ok()?;
    serde_json::from_str(&text).ok()
}

/// 落盘（`geometry = None` 表示"这次不要改几何"，只更新最大化的位）。
fn write_window_state(app: &tauri::AppHandle, geometry: Option<WindowGeometry>, maximized: bool) {
    let mut state = read_window_state(app).unwrap_or_default();
    if let Some(geo) = geometry {
        state.geometry = Some(geo);
    }
    state.maximized = maximized;
    let Some(path) = window_state_file(app) else {
        return;
    };
    match serde_json::to_string(&state) {
        Ok(text) => {
            if let Err(err) = std::fs::write(&path, text) {
                eprintln!("[window] 记窗口位置失败：{err}");
            }
        }
        Err(err) => eprintln!("[window] 序列化窗口位置失败：{err}"),
    }
}

/// 把某块窗口的**当前**几何存下来（几何读不到时只更新最大化位）。
pub(crate) fn remember_window(app: &tauri::AppHandle, win: &tauri::Window) {
    /*
     * ⚠️ **不可见 / 最小化时不记**（2026-10-06 实测踩到）：
     * 窗口在启动时是 `visible: false`（先摆位置再露脸），而 `set_size` / `set_position`
     * 同样会触发 `Resized` / `Moved` —— 那次记录读到的是"还没有内容的窗口"。
     * 更糟的是最小化：Windows 把最小化窗口的坐标报成 **(-32000, -32000)**，尺寸也退化，
     * 照记下去下次启动就把窗口丢到屏幕外（实测状态文件里出现过 `x:-32000,y:-32000,w:144,h:19`）。
     */
    if !win.is_visible().unwrap_or(false) || win.is_minimized().unwrap_or(false) {
        return;
    }
    let maximized = win.is_maximized().unwrap_or(false);
    let fullscreen = win.is_fullscreen().unwrap_or(false);
    /*
     * 最大化 / 全屏时**不记几何**：那时读到的尺寸是屏幕尺寸，记下去会把
     * "还原后该多大"冲掉 —— 下次取消最大化就回不到用户原来拉的大小了。
     */
    let geometry = if maximized || fullscreen {
        None
    } else {
        match (win.outer_position(), win.inner_size()) {
            /* 坐标再兜一道：最小化的哨兵值 -32000 不该进状态文件 */
            (Ok(pos), Ok(size)) if pos.x > -30000 && pos.y > -30000 => Some(WindowGeometry {
                x: pos.x,
                y: pos.y,
                w: size.width,
                h: size.height,
            }),
            _ => None,
        }
    };
    write_window_state(app, geometry, maximized);
}

/// 起窗口时套用它：最大化过就直接最大化，否则设回尺寸 + 位置；
/// 一条都不能用（或第一次启动）就居中。
///
/// `correct` = 是否做"显示后再量一次、把差值补掉"那一趟（见下面的说明）。
pub(crate) fn apply_saved_window(app: &tauri::AppHandle, win: &tauri::WebviewWindow, correct: bool) {
    let monitors: Vec<MonitorRect> = win
        .available_monitors()
        .map(|list| {
            list.into_iter()
                .map(|m| {
                    let pos = m.position();
                    let size = m.size();
                    MonitorRect {
                        x: pos.x,
                        y: pos.y,
                        w: size.width,
                        h: size.height,
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    let saved = read_window_state(app).unwrap_or_default();
    if saved.maximized {
        let _ = win.maximize();
        return;
    }
    if let Some(geo) = saved.geometry.and_then(|g| sanitize_geometry(g, &monitors)) {
        let _ = win.set_size(tauri::PhysicalSize::new(geo.w, geo.h));
        let _ = win.set_position(tauri::PhysicalPosition::new(geo.x, geo.y));
        /*
         * ⚠️ **窗口还没显示时 `set_size` 量不准**（实测）：要 1264×811，显示后量到
         * **1264×841**（高度差 30px、宽度却准）—— 系统对"还没显示 / 图标化"的窗口
         * 另有一套非客户区算法。所以 `show()` 之后再量一次，把差值补掉。
         * 只在这一趟做（`correct = true`），免得来回抖。
         */
        if correct {
            if let Ok(actual) = win.inner_size() {
                let dw = actual.width as i64 - geo.w as i64;
                let dh = actual.height as i64 - geo.h as i64;
                if dw != 0 || dh != 0 {
                    let w = (geo.w as i64 - dw).max(WINDOW_MIN_W as i64) as u32;
                    let h = (geo.h as i64 - dh).max(WINDOW_MIN_H as i64) as u32;
                    let _ = win.set_size(tauri::PhysicalSize::new(w, h));
                    let _ = win.set_position(tauri::PhysicalPosition::new(geo.x, geo.y));
                }
            }
        }
        return;
    }
    /* 第一次启动（或存的位置已经没用了）：居中 —— 与 `tauri.conf.json` 的 `center: true` 同义 */
    let _ = win.center();
}

/// 恢复已有主窗口：show → unminimize → focus。
///
/// 第二实例回调里不能只按固定 label 找窗口：窗口 `create: false`、由 setup 手动构建，
/// 版本变化或配置重载时 label 可能读不到。先找 `main`，再回落到应用当前唯一的 WebView。
pub(crate) fn reveal_existing_window(app: &tauri::AppHandle) {
    if let Ok(mut last) = app.state::<UiHealth>().last.lock() {
        *last = Instant::now();
    }
    let window = app
        .get_webview_window("main")
        .or_else(|| app.webview_windows().into_values().next());
    if let Some(window) = window {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// 前端存活心跳。窗口可见但 20 秒没有心跳，就认为 WebView 白屏 / 渲染进程卡死。
pub(crate) struct UiHealth {
    last: Mutex<Instant>,
    reloads: AtomicUsize,
}

const UI_WATCHDOG_POLL: Duration = Duration::from_secs(5);
const UI_WATCHDOG_STALE: Duration = Duration::from_secs(20);
const UI_WATCHDOG_DEV_INITIAL_GRACE: Duration = Duration::from_secs(90);

/// 开发壳首次加载要等 Vite 冷转换；过早 reload 会把本可成功的启动打断。
/// 生产包加载内嵌资源，仍沿用原来的 20 秒恢复窗口。
fn ui_watchdog_initial_grace(debug_build: bool) -> Duration {
    if debug_build {
        UI_WATCHDOG_DEV_INITIAL_GRACE
    } else {
        UI_WATCHDOG_STALE
    }
}

impl Default for UiHealth {
    fn default() -> Self {
        Self {
            last: Mutex::new(Instant::now()),
            reloads: AtomicUsize::new(0),
        }
    }
}

#[tauri::command]
pub(crate) fn ui_heartbeat(health: State<UiHealth>) {
    if let Ok(mut last) = health.last.lock() {
        *last = Instant::now();
    }
    health.reloads.store(0, Ordering::Relaxed);
}

/// 托盘：左键恢复窗口；菜单提供打开 / 重新加载 / 退出。
pub(crate) fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "tray_open", "打开轻画", true, None::<&str>)?;
    let reload = MenuItem::with_id(app, "tray_reload", "重新加载界面", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray_quit", "退出轻画", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &reload, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("轻画")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray_open" => reveal_existing_window(app),
            "tray_reload" => {
                if let Some(window) = app.get_webview_window("main") {
                    if let Ok(mut last) = app.state::<UiHealth>().last.lock() {
                        *last = Instant::now();
                    }
                    let _ = window.eval("window.location.reload()");
                }
            }
            "tray_quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal_existing_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// 白屏看门狗：只在窗口可见且未最小化时工作，托盘隐藏 / 正常最小化不会误重启。
pub(crate) fn start_ui_watchdog(app: &tauri::AppHandle) {
    if std::env::var_os("QINGHUA_DISABLE_UI_WATCHDOG").is_some() {
        eprintln!("[ui] 已通过 QINGHUA_DISABLE_UI_WATCHDOG 暂停心跳看门狗");
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let initial_grace = ui_watchdog_initial_grace(cfg!(debug_assertions));
        eprintln!(
            "[ui] 白屏看门狗已启动；首次检查宽限 {} 秒",
            initial_grace.as_secs()
        );
        std::thread::sleep(initial_grace);
        loop {
            std::thread::sleep(UI_WATCHDOG_POLL);
            let Some(window) = app.get_webview_window("main") else {
                continue;
            };
            if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
                continue;
            }
            let elapsed = app
                .state::<UiHealth>()
                .last
                .lock()
                .map(|last| last.elapsed())
                .unwrap_or_default();
            if elapsed < UI_WATCHDOG_STALE {
                continue;
            }
            let attempts = app
                .state::<UiHealth>()
                .reloads
                .fetch_add(1, Ordering::Relaxed);
            eprintln!(
                "[ui] 20 秒无心跳，WebView 可能白屏，执行第 {} 次重载",
                attempts + 1
            );
            if let Ok(mut last) = app.state::<UiHealth>().last.lock() {
                *last = Instant::now();
            }
            let _ = window.eval("window.location.reload()");
            if attempts >= 1 && !cfg!(debug_assertions) {
                app.restart();
            }
        }
    });
}

#[cfg(test)]
mod ui_watchdog_tests {
    use super::*;

    #[test]
    fn dev_build_waits_for_cold_vite_transform() {
        assert_eq!(ui_watchdog_initial_grace(true), Duration::from_secs(90));
    }

    #[test]
    fn release_build_keeps_the_existing_recovery_window() {
        assert_eq!(ui_watchdog_initial_grace(false), Duration::from_secs(20));
    }
}

/// 节流用的时钟：拖动窗口时 `Resized` / `Moved` 每帧都来，不能每帧写一次盘。
pub(crate) struct WindowSaveClock(pub(crate) std::sync::Mutex<std::time::Instant>);

#[cfg(test)]
mod window_state_tests {
    use super::*;

    fn monitor(x: i32, y: i32, w: u32, h: u32) -> MonitorRect {
        MonitorRect { x, y, w, h }
    }

    #[test]
    fn keeps_geometry_that_fits_a_monitor() {
        let got = sanitize_geometry(
            WindowGeometry {
                x: 100,
                y: 80,
                w: 1440,
                h: 900,
            },
            &[monitor(0, 0, 2560, 1440)],
        );
        assert_eq!(
            got,
            Some(WindowGeometry {
                x: 100,
                y: 80,
                w: 1440,
                h: 900
            })
        );
    }

    #[test]
    fn keeps_a_window_on_a_negative_x_second_monitor() {
        // 副屏在主屏左边 ⇒ 合法的 x 是负数，不能被当成"屏幕外"
        let got = sanitize_geometry(
            WindowGeometry {
                x: -1800,
                y: 40,
                w: 1200,
                h: 800,
            },
            &[monitor(0, 0, 2560, 1440), monitor(-1920, 0, 1920, 1080)],
        );
        assert!(got.is_some());
    }

    #[test]
    fn drops_geometry_of_a_monitor_that_is_gone() {
        // 副屏拔掉：x=-1800 那条现在哪块屏幕都不沾 ⇒ None（调用方居中）
        let got = sanitize_geometry(
            WindowGeometry {
                x: -1800,
                y: 40,
                w: 1200,
                h: 800,
            },
            &[monitor(0, 0, 2560, 1440)],
        );
        assert_eq!(got, None);
    }

    #[test]
    fn bumps_a_too_small_size_to_the_minimum() {
        let got = sanitize_geometry(
            WindowGeometry {
                x: 0,
                y: 0,
                w: 300,
                h: 200,
            },
            &[monitor(0, 0, 2560, 1440)],
        )
        .unwrap();
        assert_eq!((got.w, got.h), (WINDOW_MIN_W, WINDOW_MIN_H));
    }

    #[test]
    fn clamps_a_size_larger_than_the_monitor() {
        let got = sanitize_geometry(
            WindowGeometry {
                x: 0,
                y: 0,
                w: 5000,
                h: 4000,
            },
            &[monitor(0, 0, 1920, 1080)],
        )
        .unwrap();
        assert_eq!((got.w, got.h), (1920, 1080));
    }

    #[test]
    fn rejects_a_window_whose_title_bar_is_above_the_screen() {
        // y 在屏幕上方（拖不回来）⇒ None
        let got = sanitize_geometry(
            WindowGeometry {
                x: 100,
                y: -400,
                w: 1200,
                h: 800,
            },
            &[monitor(0, 0, 2560, 1440)],
        );
        assert_eq!(got, None);
    }

    #[test]
    fn saved_state_round_trips_through_json() {
        let state = SavedWindow {
            geometry: Some(WindowGeometry {
                x: 12,
                y: 34,
                w: 1440,
                h: 900,
            }),
            maximized: true,
        };
        let text = serde_json::to_string(&state).unwrap();
        assert_eq!(serde_json::from_str::<SavedWindow>(&text).unwrap(), state);
        // 老文件（只有几何、没有 maximized）也要读得动
        assert_eq!(
            serde_json::from_str::<SavedWindow>("{\"geometry\":{\"x\":1,\"y\":2,\"w\":3,\"h\":4}}")
                .unwrap()
                .maximized,
            false
        );
    }
}
