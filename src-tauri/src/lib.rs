use std::path::PathBuf;
use tauri::Manager;
/**
 * 轻画桌面壳（Tauri 2）的入口。
 *
 * **P0**：把窗口开出来、加载同一套前端（`tauri.conf.json` 里配 devUrl / frontendDist）。
 * 前端一行不改 —— 壳里跑的还是那套 React 应用（画布、素材、执行引擎全在 Web 侧）。
 *
 * **P1**（方案 §4.3）：`AssetFolderPort` / `FilePort` 的原生实现。这里只做三件**必须**在 Rust 侧做的事
 * —— 弹系统对话框、并且**把用户选中的路径加进 fs 插件的作用域**（选过才算授权，与浏览器侧"刷新后要重选"
 * 同一口径）；真正的读写交给 `tauri-plugin-fs`，前端只调 JS 的那几个函数。
 *
 * 后续：P3 接 `tauri-plugin-updater`（自动更新）。
 */
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;

mod agent_browser;
mod agent_browser_rules;
mod browser_view;
mod browser_view_rules;
mod canvas_gateway;
mod clipper_receiver;
mod clipper_update;
mod credential_vault;
mod folder_grants;
mod cli_output_tests;
mod cli_runner;
pub(crate) use cli_runner::{base64_decode, base64_encode};
#[cfg(test)]
pub(crate) use cli_runner::decode_cli_output;
mod pinterest_oauth;
mod network_fetch;
mod storage_admin;
pub(crate) use storage_admin::{current_data_dir, is_development_output, lower, SharedStoreRuntime};
mod system_proxy;
mod updater;
mod window_lifecycle;

/// 「选一个目录当素材文件夹」：弹系统目录选择框 → 把该目录**递归**加进 fs 作用域 → 返回绝对路径。
///
/// 为什么授权要在 Rust 侧做：前端没有扩展 fs 作用域的接口，而"用户选过的目录"正是授权的唯一依据。
/// 取消（关掉对话框）返回 `null` —— 取消不是错误。
#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    app.dialog()
        .file()
        .set_title("选择素材文件夹")
        .pick_folder(move |picked| {
            let _ = tx.blocking_send(picked.map(|p| p.to_string()));
        });
    let dir = rx.recv().await.flatten()?;
    if let Err(err) = app.fs_scope().allow_directory(&dir, true) {
        eprintln!("[assetFolder] 授权素材目录失败：{err}");
    }
    if let Ok(ledger) = folder_ledger_path(&app) {
        if let Err(err) = folder_grants::remember(&ledger, std::path::Path::new(&dir)) {
            eprintln!("[assetFolder] 记录授权目录失败：{err}");
        }
    }
    Some(dir)
}

fn folder_ledger_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join(folder_grants::LEDGER_FILE))
        .map_err(|err| err.to_string())
}

/// **重新**授权一个"记住的"素材目录（应用重启后作用域是空的）。
///
/// 与浏览器侧**刻意不同**的一处：浏览器不允许静默恢复目录权限，所以那边每次刷新都要用户重选；
/// 而桌面壳里目录是应用自己的数据，用户选过一次就该记住 —— 否则每次启动素材全变「缺失」，
/// 「把素材放在文件夹里」这件事在壳里就没意义了。路径由前端记（`localStorage`），
/// 这里只负责"照它把作用域重新打开"。
///
/// 返回 `false` = 这个目录**已经不在了**（被移动 / 删除 / 拔盘）⇒ 前端当作"没选目录"，如实回落内置库。
#[tauri::command]
async fn grant_folder(app: tauri::AppHandle, path: String) -> Result<bool, String> {
    let dir = std::path::Path::new(&path);
    if !dir.is_dir() {
        return Ok(false);
    }
    // 只重新授权用户在对话框里选过的目录（台账），不接受前端随意指定的路径。
    let ledger_file = folder_ledger_path(&app)?;
    let ledger = folder_grants::read_ledger(&ledger_file);
    let home = folder_grants::home_dir_from_env();
    match folder_grants::decide(
        ledger.as_deref(),
        dir,
        home.as_deref(),
        &folder_grants::system_dirs_from_env(),
    ) {
        folder_grants::GrantDecision::Deny => return Ok(false),
        folder_grants::GrantDecision::Migrate => folder_grants::remember(&ledger_file, dir)?,
        folder_grants::GrantDecision::Known => {}
    }
    app.fs_scope()
        .allow_directory(&path, true)
        .map_err(|err| err.to_string())?;
    Ok(true)
}

/// 「选一个文件打开」（导入素材 / 导入项目 JSON）：弹选择框 → 授权该文件 → 返回路径。
#[tauri::command]
async fn pick_file(
    app: tauri::AppHandle,
    title: Option<String>,
    extensions: Option<Vec<String>>,
) -> Option<String> {
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    let mut builder = app.dialog().file();
    if let Some(title) = title {
        builder = builder.set_title(title);
    }
    if let Some(exts) = extensions.filter(|e| !e.is_empty()) {
        let refs: Vec<&str> = exts.iter().map(String::as_str).collect();
        builder = builder.add_filter("文件", &refs);
    }
    builder.pick_file(move |picked| {
        let _ = tx.blocking_send(picked.map(|p| p.to_string()));
    });
    let file = rx.recv().await.flatten()?;
    if let Err(err) = app.fs_scope().allow_file(&file) {
        eprintln!("[files] 授权文件失败：{err}");
    }
    Some(file)
}

/// 「另存为」（导出项目 / 下载素材）：弹保存框 → 授权目标文件 → 返回路径。
#[tauri::command]
async fn save_file_dialog(
    app: tauri::AppHandle,
    name: String,
    extensions: Option<Vec<String>>,
) -> Option<String> {
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    let mut builder = app.dialog().file().set_file_name(&name);
    if let Some(exts) = extensions.filter(|e| !e.is_empty()) {
        let refs: Vec<&str> = exts.iter().map(String::as_str).collect();
        builder = builder.add_filter("文件", &refs);
    }
    builder.save_file(move |picked| {
        let _ = tx.blocking_send(picked.map(|p| p.to_string()));
    });
    let file = rx.recv().await.flatten()?;
    if let Err(err) = app.fs_scope().allow_file(&file) {
        eprintln!("[files] 授权目标文件失败：{err}");
    }
    Some(file)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let release_gate = storage_admin::release_gate_enabled(std::env::var(storage_admin::RELEASE_GATE_ENV).ok().as_deref());
    let shared_store_port = storage_admin::configured_shared_store_port().unwrap_or_else(|error| {
        eprintln!("[shared-store] 启动端口配置无效，拒绝启动：{error}");
        std::process::exit(1);
    });
    let builder = tauri::Builder::default();
    /*
     * 正常运行必须保留单实例插件。release gate 使用独立的进程、端口和数据目录，
     * 只有显式哨兵开启时才跳过它，否则开发壳占着单实例锁会让正式包直接退出。
     */
    let builder = if release_gate {
        builder
    } else {
        builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            window_lifecycle::reveal_existing_window(app);
        }))
    };
    builder
        .manage(SharedStoreRuntime {
            port: shared_store_port,
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        /*
         * 系统通知（对账 #392）：壳里的 WebView2 对 `Notification` 的权限处理不可靠，
         * 走官方插件才是"真的能弹"。**不自动申请权限** —— 申请由设置页那个按钮触发。
         */
        .plugin(tauri_plugin_notification::init())
        /*
         * 窗口几何的节流时钟（见 `WindowSaveClock`）。初值往回拨 10 秒，
         * 免得"启动后第一次微调尺寸"被节流吃掉。
         */
        .manage(window_lifecycle::WindowSaveClock(std::sync::Mutex::new(
            std::time::Instant::now(),
        )))
        .manage(window_lifecycle::UiHealth::default())
        /*
         * 本机 CLI 的进程表（见上面「本机 CLI」那一段）。
         * 进的是 `AppHandle` 的受管状态，所以 `cli_run` 与 `cli_kill` 看到的是同一张表。
         */
        .manage(cli_runner::CliRegistry::default())
        .manage(cli_runner::CliWindowRegistry::default())
        .manage(network_fetch::FetchStreamCancels::default())
        /*
         * 窗口几何的自动记盘（用户 2026-10-06 第 11 批第 7 条："记住上次窗口尺寸和位置"）。
         *
         * 两种时机都记：
         * - `Resized` / `Moved`：**节流 800ms**（拖动窗口时这两个事件每帧都来，
         *   逐帧写盘是自找的卡顿）；
         * - `CloseRequested`：关窗口前再记一次（保证最后一次一定落盘）。
         */
        .on_window_event(|window, event| {
            // Agent 后台浏览器（agent-browser-*）不归这里管：它的位置不能记成主窗口状态，
            // 关闭也由 agent_browser.rs 自己处理（隐藏 + 通知前端）。
            if window.label().starts_with(agent_browser_rules::AGENT_LABEL_PREFIX) {
                return;
            }
            match event {
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                    let app = window.app_handle();
                    let clock_state = app.state::<window_lifecycle::WindowSaveClock>();
                    let Ok(clock) = clock_state.0.lock() else {
                        return;
                    };
                    if clock.elapsed() < std::time::Duration::from_millis(800) {
                        return;
                    }
                    drop(clock);
                    if let Ok(mut clock) = clock_state.0.lock() {
                        *clock = std::time::Instant::now();
                    }
                    window_lifecycle::remember_window(app, window);
                }
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    window_lifecycle::remember_window(window.app_handle(), window);
                    /*
                     * 有托盘时关闭按钮只隐藏窗口：生成任务与系统通知继续运行。
                     * 真正退出走托盘菜单；托盘没建成功则保留系统默认关闭行为。
                     */
                    if window.app_handle().tray_by_id("main").is_some() {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            pick_folder,
            grant_folder,
            pick_file,
            save_file_dialog,
            updater::check_update,
            updater::install_update,
            storage_admin::data_dir_path,
            storage_admin::pick_data_dir,
            storage_admin::set_data_dir,
            storage_admin::inspect_data_dir,
            storage_admin::storage_startup_state,
            storage_admin::auto_upgrade_storage,
            storage_admin::finalize_storage_upgrade,
            storage_admin::replace_storage_root,
            storage_admin::migrate_data_dir,
            storage_admin::open_dir,
            storage_admin::cache_usage,
            storage_admin::clear_cache,
            storage_admin::profile_backup_info,
            network_fetch::fetch_bytes,
            network_fetch::fetch_text,
            network_fetch::cancel_fetch_text,
            network_fetch::fetch_stream,
            network_fetch::cancel_fetch_stream,
            cli_runner::cli_which,
            cli_runner::cli_run,
            cli_runner::cli_kill,
            cli_runner::cli_spawn_window,
            cli_runner::cli_wait_window,
            cli_runner::cli_out_dir,
            cli_runner::cli_read_out,
            cli_runner::cli_write_out,
            cli_runner::cli_import_asset,
            cli_runner::rh_set_api_key,
            credential_vault::credential_protect,
            credential_vault::credential_unprotect,
            window_lifecycle::ui_heartbeat,
            canvas_gateway::canvas_gateway_info,
            canvas_gateway::canvas_gateway_respond,
            clipper_receiver::clipper_receiver_info,
            clipper_receiver::clipper_take_pending,
            clipper_receiver::clipper_pending_snapshot,
            clipper_receiver::clipper_ack_pending,
            clipper_update::clipper_extension_update,
            pinterest_oauth::pinterest_oauth_listen,
            pinterest_oauth::pinterest_oauth_wait,
            pinterest_oauth::pinterest_oauth_cancel,
            browser_view::browser_view_open,
            browser_view::browser_view_navigate,
            browser_view::browser_view_back,
            browser_view::browser_view_forward,
            browser_view::browser_view_reload,
            browser_view::browser_view_stop,
            browser_view::browser_view_set_bounds,
            browser_view::browser_view_show,
            browser_view::browser_view_hide,
            browser_view::browser_view_close,
            browser_view::browser_view_extract,
            agent_browser::agent_browser_load,
            agent_browser::agent_browser_snapshot,
            agent_browser::agent_browser_show,
            agent_browser::agent_browser_hide,
            agent_browser::agent_browser_close
        ])
        .setup(move |app| {
            storage_admin::apply_data_dir_config(app.handle());
            /*
             * 权威数据从这里开始不再属于某个 WebView origin。
             * 调试壳、release 壳和浏览器都连同一个本地服务与同一份文件库。
             * 正式桌面壳（非 debug / 非 release_gate）自动生成随机会话令牌并注入主窗口，
             * 阻止本机其他无关进程直接读写 KV 与业务表。
             */
            let shared_store_token = std::env::var(qinghua_shared_store::TOKEN_ENV)
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .or_else(|| {
                    if !cfg!(debug_assertions) && !release_gate {
                        Some(qinghua_shared_store::generate_session_token())
                    } else {
                        None
                    }
                });
            qinghua_shared_store::start_in_background_on_with_token(
                shared_store_port,
                shared_store_token.clone(),
            );
            if release_gate {
                eprintln!(
                    "[shared-store] release gate 使用隔离端口 {shared_store_port}，单实例插件已跳过"
                );
            }
            if let Err(error) = canvas_gateway::start(app.handle().clone()) {
                eprintln!("[canvas-gateway] 启动失败：{error}");
            }
            if let Err(error) = clipper_receiver::start() {
                eprintln!("[clipper] 启动失败：{error}");
            }
            /*
             * 窗口在这里**手动建**（`tauri.conf.json` 那条窗口配了 `"create": false`），
             * 唯一原因就是要赶在 webview 创建**之前**把它的数据目录指过去 ——
             * `data_directory` 只能在建窗口时给，建完就改不了了。
             */
            let data_dir = storage_admin::shared_shell_profile_dir(app.handle());
            match &data_dir {
                Some(dir) => {
                    eprintln!("[data] 共享壳 profile：{}", dir.display());
                }
                None => eprintln!("[data] 无法取得共享壳 profile 目录"),
            }
            /*
             * 建窗口前先拍一份：强杀后 WebView2 可能重建空库，
             * 这份副本就是“上次真正能读的数据”。
             */
            /*
             * 权威数据已迁到 shared-store，不再备份整个 WebView profile。
             * 旧逻辑会在启动前复制 GB 级 IndexedDB，反而把窗口卡死。
             */
            /*
             * 建窗口要能建**两次**（自定义数据目录那次失败还能回落），故包成一个闭包。
             * 会失败的情形：数据目录在两次检查之间被删 / 网络盘掉线 / WebView2 起不来 ——
             * 那些都不该让用户"双击了却没窗口"，所以失败就退回系统默认位置再建一次。
             */
            let build_window = |dir: Option<PathBuf>| -> tauri::Result<tauri::WebviewWindow> {
                let config = app.config().app.windows.first().cloned();
                let mut builder = match config {
                    Some(cfg) => tauri::WebviewWindowBuilder::from_config(app.handle(), &cfg)?,
                    None => tauri::WebviewWindowBuilder::new(
                        app.handle(),
                        "main",
                        tauri::WebviewUrl::default(),
                    ),
                };
                if release_gate {
                    builder = builder.initialization_script(format!(
                        "Object.defineProperty(window, '__QINGHUA_SHARED_STORE_PORT__', {{ value: {shared_store_port}, configurable: false }});"
                    ));
                }
                if let Some(token) = &shared_store_token {
                    if let Ok(quoted) = serde_json::to_string(token) {
                        builder = builder.initialization_script(format!(
                            "Object.defineProperty(window, '__QINGHUA_SHARED_STORE_TOKEN__', {{ value: {quoted}, configurable: false }});"
                        ));
                    }
                }
                if let Some(dir) = dir {
                    builder = builder.data_directory(dir);
                }
                builder.build()
            };
            let window = match build_window(data_dir.clone()) {
                Ok(win) => win,
                Err(err) => {
                    eprintln!("[data] 用自定义数据目录建窗口失败：{err} ⇒ 回落到系统默认位置");
                    if let Some(dir) = &data_dir {
                        // 探针建出来的空目录顺手收掉（只有真的是空的才会成功，不会误删数据）
                        let _ = std::fs::remove_dir(dir);
                    }
                    build_window(None)?
                }
            };
            /*
             * 窗口几何：先套上次的尺寸 / 位置，**再**显示（用户 2026-10-06 第 11 批第 7 条
             * "记住上次窗口尺寸和位置"）。`tauri.conf.json` 那条窗口因此配了 `visible: false`
             * —— 摆好位置再露脸，用户看不到"先居中、再跳到上次位置"那一下。
             */
            window_lifecycle::apply_saved_window(app.handle(), &window, false);
            /*
             * 显式取消最小化再显示：Windows 对“图标化”的窗口只在任务栏留一个入口，
             * 而开发壳没有托盘图标，用户很容易把“最小化”理解成“挂了”。
             */
            let _ = window.unminimize();
            /* 显示失败要出声：`visible: false` 之下，这一步失败 = 用户双击了却什么都没有 */
            if let Err(err) = window.show() {
                eprintln!("[window] 显示主窗口失败：{err}");
            }
            let _ = window.set_focus();
            if let Err(err) = window_lifecycle::setup_tray(app.handle()) {
                eprintln!("[tray] 创建托盘失败（关闭按钮将退回直接退出）：{err}");
            }
            window_lifecycle::start_ui_watchdog(app.handle());
            /*
             * 显示**之后**再套一次：窗口还没显示时系统对 `set_size` 另有一套算法
             * （实测差 30px 高），这一趟会量一次实际尺寸并把差值补掉（见 `apply_saved_window`）。
             */
            window_lifecycle::apply_saved_window(app.handle(), &window, true);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            let _ = (app_handle, event);
        });
}

