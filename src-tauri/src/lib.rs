use std::path::{Path, PathBuf};
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
use tauri_plugin_opener::OpenerExt;

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


// ─────────────────────────────────────────────────────────────
// 数据目录：程序目录隔壁的 `data\`（方案 §5.11 / 对账 #248）
// ─────────────────────────────────────────────────────────────

/// 「数据该放哪」的**纯决策**：程序目录的上一级 `\data`；四道闸门任一不过就返回 `None`
/// （`None` = 用系统默认位置 `%LOCALAPPDATA%\<identifier>`）。
///
/// 为什么要闸门：这条规则只对"用户自己挑的位置"成立。默认安装位置是 `%LOCALAPPDATA%\轻画`，
/// 若不管它，数据就会跑到 `%LOCALAPPDATA%\data` —— 既污染上一层，也丢了"每个账户各自一份"。
#[allow(dead_code)]
fn decide_data_dir(
    exe_dir: &Path,
    system_roots: &[PathBuf],
    writable: &dyn Fn(&Path) -> bool,
) -> Option<PathBuf> {
    // 闸门 0：开发 / 测试构建不走这条规则（工程里它们都在 `src-tauri\target\{debug,release}`）。
    // 否则开发数据会落进构建缓存 —— 一次 `cargo clean` 就顺手把它删了。
    let is_build_output = exe_dir
        .file_name()
        .is_some_and(|name| name == "debug" || name == "release")
        && exe_dir
            .parent()
            .and_then(|parent| parent.file_name())
            .is_some_and(|name| name == "target");
    if is_build_output {
        return None;
    }
    // 闸门 1：程序目录得有上一级（程序就躺在盘根时为假）
    let parent = exe_dir.parent()?;
    // 闸门 2：上一级不能是盘根 —— `D:\data` 不算"外面一个文件夹"
    parent.parent()?;
    // 闸门 3：上一级不能落在系统目录里（默认安装位置 / Program Files / Windows）
    let parent_lower = lower(parent);
    if system_roots
        .iter()
        .any(|root| parent_lower.starts_with(lower(root)))
    {
        return None;
    }
    // 闸门 4：`<上一级>\data` 必须真的写得进去（只读盘、权限不足 ⇒ 回落系统位置）
    let data = parent.join("data");
    if !writable(&data) {
        return None;
    }
    Some(data)
}

/// 大小写归一：Windows 路径大小写不敏感，而 `Path::starts_with` 是敏感的
pub(crate) fn lower(path: &Path) -> PathBuf {
    PathBuf::from(path.to_string_lossy().to_lowercase())
}

/// 真建目录 + 落一个探针文件再删掉 —— "能不能写"只能试出来
fn dir_is_writable(dir: &Path) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".write-probe");
    match std::fs::write(&probe, b"ok") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// 系统目录清单：命中任何一条就说明程序装在"我们默认 / 系统给的位置"，数据不该跟过去
#[allow(dead_code)]
fn system_roots(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(p) = app.path().local_data_dir() {
        roots.push(p);
    }
    if let Ok(p) = app.path().data_dir() {
        roots.push(p);
    }
    for key in [
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramW6432",
        "SystemRoot",
    ] {
        if let Ok(value) = std::env::var(key) {
            if !value.is_empty() {
                roots.push(PathBuf::from(value));
            }
        }
    }
    roots
}

/// 本次运行该用的数据目录（`None` = 交给 Tauri 的默认值）
#[allow(dead_code)]
fn resolve_data_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    decide_data_dir(exe_dir, &system_roots(app), &dir_is_writable)
}

/// **业务主库**的优先位置：开发版用项目根目录的 `data`，正式版用安装目录隔壁的 `data`。
///
/// 这是用户先前明确要过的 `轻画\{app,data}` 布局。安装在系统目录（例如默认
/// `%LOCALAPPDATA%\轻画`）时，隔壁的 `%LOCALAPPDATA%\data` 会污染系统目录，故返回 `None`，
/// 由 shared-store 回退到 `%LOCALAPPDATA%\com.qinghua.canvas\shared-store-v1`。
#[allow(dead_code)]
fn preferred_business_data_dir(
    exe: &Path,
    _system_roots: &[PathBuf],
    writable: &dyn Fn(&Path) -> bool,
) -> Option<PathBuf> {
    let candidate = business_data_base_dir(exe)?;
    writable(&candidate).then_some(candidate)
}

/// Pure install-layout decision used before any directory is created.
///
/// Current NSIS installs the executable directly inside the product folder:
/// `轻画\qinghua.exe`. Data therefore belongs in that same folder. Older
/// packaging used a nested `app` directory, so keep that layout supported.
fn business_data_base_dir(exe: &Path) -> Option<PathBuf> {
    let exe_dir = exe.parent()?;
    let app_root = if is_development_output(exe) {
        // .../<project>/src-tauri/target/debug/qinghua.exe → .../<project>/data
        return Some(exe_dir.parent()?.parent()?.parent()?.join("data"));
    } else if exe_dir.file_name().is_some_and(|name| name == "app") {
        exe_dir.parent()?
    } else {
        exe_dir
    };
    app_root.parent()?;
    Some(app_root.join("data"))
}

pub(crate) fn is_development_output(exe: &Path) -> bool {
    let Some(exe_dir) = exe.parent() else {
        return false;
    };
    let Some(build_profile) = exe_dir.file_name() else {
        return false;
    };
    if build_profile != "debug" && build_profile != "release" {
        return false;
    }
    let Some(target_dir) = exe_dir.parent() else {
        return false;
    };
    if target_dir.file_name().is_none_or(|name| name != "target") {
        return false;
    }
    target_dir
        .parent()
        .and_then(Path::file_name)
        .is_some_and(|name| name == "src-tauri")
}

fn push_unique_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.iter().any(|existing| paths_equal(existing, &path)) {
        paths.push(path);
    }
}

fn legacy_v1_candidates(exe: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![qinghua_shared_store::default_v1_data_dir()];
    if let Some(base) = business_data_base_dir(exe) {
        push_unique_path(&mut candidates, base);
    }
    if let Some(exe_dir) = exe.parent() {
        if let Some(parent) = exe_dir.parent() {
            // 0.1.9's first-run path creation used this parent-level `data`.
            // It is only considered as a legacy source when it contains real rows.
            push_unique_path(&mut candidates, parent.join("data"));
        }
    }
    candidates
}

fn populated_v1_source(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find_map(|path| {
        let info = storage_root_info(path).ok()?;
        if info.kind != "v1" {
            return None;
        }
        qinghua_shared_store::migration::v1_record_count(path)
            .ok()
            .filter(|count| *count > 0)
            .map(|_| path.clone())
    })
}

/// 所有壳共用同一份空壳 profile。
///
/// 业务数据已迁到 shared-store；这里只放 WebView2 缓存和可重建偏好。
fn shared_shell_profile_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    shell_profile_dir_for(
        release_gate_data_dir().as_deref(),
        app.path().app_local_data_dir().ok(),
    )
}

fn shell_profile_dir_for(
    release_gate_data_dir: Option<&Path>,
    app_local_data_dir: Option<PathBuf>,
) -> Option<PathBuf> {
    release_gate_data_dir
        .and_then(Path::parent)
        .map(|root| root.join("shell-v2"))
        .or_else(|| app_local_data_dir.map(|root| root.join("shell-v2")))
}

/// 第一次在新位置启动时，把**数据**从默认 profile 搬过去（不是每次启动都搬）。
///
/// 只搬三样：`IndexedDB`（项目 / 素材 / 素材库）、`Local Storage`（令牌密文 + 设置）、`WebStorage`。
/// 其余（`Cache` / `Code Cache` / `GPUCache` …）是网页缓存，几十 MB 且能重建，**不搬**。
/// 目标已经有 `IndexedDB` 就整个跳过 —— 否则每次启动都会拿旧数据盖掉新数据。
#[allow(dead_code)]
fn migrate_profile(default_root: &Path, data_dir: &Path) {
    let src = default_root.join("EBWebView").join("Default");
    if !src.is_dir() {
        return;
    }
    let dst = data_dir.join("EBWebView").join("Default");
    if dst.join("IndexedDB").exists() {
        return;
    }
    for name in ["IndexedDB", "Local Storage", "WebStorage"] {
        let from = src.join(name);
        if !from.exists() {
            continue;
        }
        let to = dst.join(name);
        match copy_dir(&from, &to) {
            Ok(()) => eprintln!("[data] 已迁移 {name} ⇒ {}", to.display()),
            Err(err) => {
                /*
                 * 拷到一半失败会留下**残缺副本**，而上面那句"目标已有 IndexedDB 就跳过"
                 * 会让下次启动不再重试 ⇒ 用户看到半个库。故失败即清掉残骸，留给下次重试。
                 * （清理也失败就只能这样了：日志里说清"旧数据仍在原地"。）
                 */
                let _ = std::fs::remove_dir_all(&to);
                eprintln!(
                    "[data] 迁移 {name} 失败：{err}（已清掉残骸，下次启动会重试；旧数据仍在原地）"
                );
            }
        }
    }
}

/// 递归拷贝（只服务上面那条一次性迁移）
#[allow(dead_code)]
fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// 备份专用复制：`.ldb` 是不可变的 LevelDB 表文件，优先硬链接；失败再回落复制。
///
/// 这样 GB 级素材库的启动备份不会每次重写一遍大文件；`MANIFEST` / `CURRENT` /
/// `*.log` 仍然逐字节复制，所以副本引用到的表文件一定是齐的。
#[allow(dead_code)]
fn copy_profile_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_profile_dir(&entry.path(), &target)?;
            continue;
        }

        let path = entry.path();
        let immutable_ldb = path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("ldb"));
        if immutable_ldb && std::fs::hard_link(&path, &target).is_ok() {
            continue;
        }
        std::fs::copy(&path, &target)?;
    }
    Ok(())
}

/// WebView2 用户数据副本保留份数（对账 #505）。
///
/// 这里刻意只保留少量：IndexedDB 可能很大，多做几份会把磁盘吃掉；
/// 真正兜底的是“至少有一份最近可用”，不是把历史全留下来。
#[allow(dead_code)]
const PROFILE_BACKUP_KEEP: usize = 3;
#[allow(dead_code)]
const PROFILE_BACKUP_DIR_NAME: &str = "qinghua-profile-backups";
#[allow(dead_code)]
const PROFILE_DATA_DIRS: [&str; 2] = ["IndexedDB", "Local Storage"];

#[allow(dead_code)]
fn profile_backup_root(data_dir: &Path) -> PathBuf {
    data_dir
        .parent()
        .map(|parent| parent.join(PROFILE_BACKUP_DIR_NAME))
        .unwrap_or_else(|| data_dir.join(PROFILE_BACKUP_DIR_NAME))
}

#[allow(dead_code)]
fn profile_backup_name(at: std::time::SystemTime) -> String {
    let millis = at
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("profile-{millis}")
}

/// 复制一份 WebView2 profile 的用户数据。
///
/// **只抄 `IndexedDB` 与 `Local Storage`**：
/// 前者是项目 / 素材 / 素材库，后者是令牌密文与界面设置；
/// `Cache` / `Code Cache` / `GPUCache` 都能重建，抄进去只会让备份巨大。
///
/// 先抄到 `.tmp-*` 再改名，半截失败不会留下一个看起来像备份、实际读不了的目录。
#[allow(dead_code)]
fn create_profile_backup(
    data_dir: &Path,
    at: std::time::SystemTime,
) -> std::io::Result<Option<PathBuf>> {
    let source = data_dir.join("EBWebView").join("Default");
    let has_any_data = PROFILE_DATA_DIRS
        .iter()
        .any(|name| source.join(name).is_dir());
    if !has_any_data {
        return Ok(None);
    }

    let root = profile_backup_root(data_dir);
    std::fs::create_dir_all(&root)?;

    let name = profile_backup_name(at);
    let final_dir = root.join(&name);
    if final_dir.exists() {
        return Ok(None);
    }

    let tmp = root.join(format!(".tmp-{name}"));
    let _ = std::fs::remove_dir_all(&tmp);

    let copied = (|| -> std::io::Result<()> {
        std::fs::create_dir_all(&tmp)?;
        for dir_name in PROFILE_DATA_DIRS {
            let from = source.join(dir_name);
            if from.is_dir() {
                copy_profile_dir(&from, &tmp.join(dir_name))?;
            }
        }
        std::fs::rename(&tmp, &final_dir)
    })();

    if let Err(err) = copied {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(err);
    }

    if let Err(err) = prune_profile_backups(&root, PROFILE_BACKUP_KEEP) {
        eprintln!("[data] 桌面数据副本清理旧份失败（不影响本次备份）：{err}");
    }
    Ok(Some(final_dir))
}

/// 只清理本功能自己生成的 `profile-*` 目录；任何不认识的目录一律不动。
#[allow(dead_code)]
fn prune_profile_backups(root: &Path, keep: usize) -> std::io::Result<usize> {
    let mut entries: Vec<_> = std::fs::read_dir(root)?
        .flatten()
        .filter(|entry| {
            entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false)
                && entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| name.starts_with("profile-"))
        })
        .collect();
    entries.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

    let mut removed = 0;
    for entry in entries.into_iter().skip(keep) {
        if std::fs::remove_dir_all(entry.path()).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

#[allow(dead_code)]
static PROFILE_BACKUP_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 拍一份桌面数据副本；任何失败都只记日志，不挡启动 / 退出。
#[allow(dead_code)]
fn backup_profile(app: &tauri::AppHandle) {
    let Some(data_dir) = current_data_dir(app) else {
        return;
    };
    let Ok(_guard) = PROFILE_BACKUP_LOCK.lock() else {
        return;
    };
    match create_profile_backup(&data_dir, std::time::SystemTime::now()) {
        Ok(Some(path)) => eprintln!("[data] 已备份桌面数据：{}", path.display()),
        Ok(None) => {}
        Err(err) => eprintln!("[data] 桌面数据备份失败（不影响启动 / 退出）：{err}"),
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileBackupInfo {
    dir: String,
    keep: usize,
}

#[tauri::command]
fn profile_backup_info(app: tauri::AppHandle) -> ProfileBackupInfo {
    let dir = current_data_dir(&app)
        .map(|data_dir| data_dir.to_string_lossy().to_string())
        .unwrap_or_default();
    ProfileBackupInfo { dir, keep: 0 }
}

// ─────────────────────────────────────────────────────────────
// 存储：数据目录 / 打开目录 / 网页缓存（对账 #261）
// ─────────────────────────────────────────────────────────────

/// **可清理的网页缓存目录名**（白名单）。
///
/// ⚠️ 这份名单是**唯一**决定"哪些目录能删"的地方，所以它必须是**白名单**：
/// `EBWebView/Default` 下面同时躺着 `IndexedDB`（项目 / 素材 / 素材库）与
/// `Local Storage`（令牌密文 + 设置）—— 用黑名单去"排掉"数据目录，
/// 漏一个就是**删用户数据**。
const CACHE_DIR_NAMES: [&str; 8] = [
    "Cache",
    "Code Cache",
    "GPUCache",
    "DawnCache",
    "DawnGraphiteCache",
    "DawnWebGPUCache",
    "GrShaderCache",
    "ShaderCache",
];

const DATA_DIR_CONFIG_NAME: &str = "storage-location.json";
const DEVELOPMENT_DATA_DIR_CONFIG_NAME: &str = "storage-location.dev.json";
const MISSING_DATA_DIR_ENV: &str = "QINGHUA_MISSING_DATA_DIR";
const RELEASE_GATE_ENV: &str = "QINGHUA_RELEASE_GATE";
const RELEASE_GATE_DATA_DIR_ENV: &str = "QINGHUA_RELEASE_GATE_DATA_DIR";
const SHARED_STORE_PORT_ENV: &str = qinghua_shared_store::PORT_ENV;
const RELEASE_GATE_DEFAULT_SHARED_STORE_PORT: u16 = 18767;

#[derive(Clone, Copy)]
pub(crate) struct SharedStoreRuntime {
    pub(crate) port: u16,
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DataDirConfig {
    data_dir: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageStartupState {
    kind: String,
    current_root: Option<String>,
    source_root: Option<String>,
    target_root: Option<String>,
    reason: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageUpgradeResult {
    source_root: String,
    target_root: String,
    migration: Option<qinghua_shared_store::migration::MigrationReport>,
    verification: qinghua_shared_store::v2_admin::V2Verification,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageReplaceResult {
    mode: String,
    source_root: String,
    target_root: String,
    source_deleted: bool,
    verification: qinghua_shared_store::v2_admin::V2Verification,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageRootInfo {
    path: String,
    kind: String,
    ready: bool,
    format_version: Option<u32>,
    schema_version: Option<u32>,
    reason: Option<String>,
}

fn storage_root_info(path: &Path) -> Result<StorageRootInfo, String> {
    if !path.is_absolute() {
        return Err("资源目录必须是绝对路径".into());
    }
    let path_text = path.to_string_lossy().to_string();
    if !path.exists() {
        return Ok(StorageRootInfo {
            path: path_text,
            kind: "empty".into(),
            ready: true,
            format_version: None,
            schema_version: None,
            reason: Some("目录尚不存在，切换后会创建新的 V1 资源根".into()),
        });
    }
    if !path.is_dir() {
        return Ok(StorageRootInfo {
            path: path_text,
            kind: "unknown".into(),
            ready: false,
            format_version: None,
            schema_version: None,
            reason: Some("目标不是目录".into()),
        });
    }

    let manifest_path = path.join("manifest.json");
    if manifest_path.is_file() {
        let raw = std::fs::read_to_string(&manifest_path)
            .map_err(|error| format!("读取 manifest.json 失败：{error}"))?;
        let manifest: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|error| format!("解析 manifest.json 失败：{error}"))?;
        let format_version = manifest
            .get("formatVersion")
            .and_then(serde_json::Value::as_u64)
            .map(|value| value as u32);
        let schema_version = manifest
            .get("schemaVersion")
            .and_then(serde_json::Value::as_u64)
            .map(|value| value as u32);
        let complete =
            manifest.get("status").and_then(serde_json::Value::as_str) == Some("complete");
        let has_store = path.join("manifest.sqlite").is_file();
        let has_media = path.join("media").is_dir();
        let ready = complete && has_store && has_media;
        return Ok(StorageRootInfo {
            path: path_text,
            kind: if ready { "v2" } else { "unknown" }.into(),
            ready,
            format_version,
            schema_version,
            reason: if ready {
                None
            } else {
                Some("manifest.json 未标记 complete，或缺少 manifest.sqlite / media".into())
            },
        });
    }

    let has_v1_table = qinghua_shared_store::sqlite::TABLE_NAMES
        .iter()
        .any(|table| path.join(table).is_dir());
    if has_v1_table {
        return Ok(StorageRootInfo {
            path: path_text,
            kind: "v1".into(),
            ready: true,
            format_version: Some(1),
            schema_version: None,
            reason: None,
        });
    }

    if path.join(".migration-state.json").is_file() || path.join("migration-report.json").is_file()
    {
        return Ok(StorageRootInfo {
            path: path_text,
            kind: "partial".into(),
            ready: false,
            format_version: Some(2),
            schema_version: None,
            reason: Some("检测到未完成的 V2 迁移，可继续迁移并重新校验".into()),
        });
    }

    let empty = std::fs::read_dir(path)
        .map_err(|error| format!("读取资源目录失败：{error}"))?
        .next()
        .is_none();
    Ok(StorageRootInfo {
        path: path_text,
        kind: if empty { "empty" } else { "unknown" }.into(),
        ready: empty,
        format_version: None,
        schema_version: None,
        reason: if empty {
            Some("空目录会创建新的 V1 资源根".into())
        } else {
            Some("目录非空，但不是可识别的 V1 / V2 资源根".into())
        },
    })
}

/// Allow the location picker to receive the product folder, not only the exact
/// `data-v2` leaf. This matches how users actually select a moved installation.
fn resolve_known_storage_root(path: &Path) -> PathBuf {
    let direct = storage_root_info(path).ok();
    if direct
        .as_ref()
        .is_some_and(|info| info.kind != "unknown" && info.kind != "empty")
    {
        return path.to_path_buf();
    }
    for child in ["data-v2", "shared-store-v2", "data", "shared-store-v1"] {
        let candidate = path.join(child);
        if storage_root_info(&candidate)
            .ok()
            .is_some_and(|info| info.kind != "unknown" && info.kind != "empty")
        {
            return candidate;
        }
    }
    path.to_path_buf()
}

fn backend_for_storage_root(path: &Path) -> &'static str {
    if storage_root_info(path)
        .ok()
        .is_some_and(|info| info.kind == "v2" && info.ready)
    {
        "v2"
    } else {
        "v1"
    }
}

fn set_storage_backend_env(path: &Path) {
    std::env::set_var("QINGHUA_STORE_BACKEND", backend_for_storage_root(path));
}

fn data_dir_config_name(exe: &Path) -> &'static str {
    if is_development_output(exe) {
        DEVELOPMENT_DATA_DIR_CONFIG_NAME
    } else {
        DATA_DIR_CONFIG_NAME
    }
}

fn data_dir_config_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    app.path()
        .app_local_data_dir()
        .ok()
        .map(|root| root.join(data_dir_config_name(&exe)))
}

fn parse_data_dir_config(raw: &str) -> Option<PathBuf> {
    let config: DataDirConfig = serde_json::from_str(raw).ok()?;
    let path = PathBuf::from(config.data_dir.trim());
    path.is_absolute().then_some(path)
}

/// 自定义主库目录保存在壳自己的配置区，不放在主库里。
///
/// 这样切换主库后仍能读回“上次选了哪里”，也能切回原目录；配置损坏或路径不是绝对路径时
/// 一律回落到系统默认库，不能让一个坏配置把应用永久锁死。
fn configured_data_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let raw = std::fs::read_to_string(data_dir_config_path(app)?).ok()?;
    parse_data_dir_config(&raw)
}

fn missing_data_dir() -> Option<PathBuf> {
    std::env::var_os(MISSING_DATA_DIR_ENV)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn release_gate_enabled(raw: Option<&str>) -> bool {
    raw == Some("1")
}

fn parse_shared_store_port(enabled: Option<&str>, raw: Option<&str>) -> Result<u16, String> {
    if !release_gate_enabled(enabled) {
        return Ok(qinghua_shared_store::PORT);
    }
    qinghua_shared_store::parse_port(raw, RELEASE_GATE_DEFAULT_SHARED_STORE_PORT)
}

fn configured_shared_store_port() -> Result<u16, String> {
    parse_shared_store_port(
        std::env::var(RELEASE_GATE_ENV).ok().as_deref(),
        std::env::var(SHARED_STORE_PORT_ENV).ok().as_deref(),
    )
}

fn parse_release_gate_data_dir(enabled: Option<&str>, raw: Option<&str>) -> Option<PathBuf> {
    if !release_gate_enabled(enabled) {
        return None;
    }
    let path = PathBuf::from(raw?.trim());
    path.is_absolute().then_some(path)
}

fn release_gate_data_dir() -> Option<PathBuf> {
    parse_release_gate_data_dir(
        std::env::var(RELEASE_GATE_ENV).ok().as_deref(),
        std::env::var(RELEASE_GATE_DATA_DIR_ENV).ok().as_deref(),
    )
}

fn apply_data_dir_config(app: &tauri::AppHandle) {
    std::env::remove_var(MISSING_DATA_DIR_ENV);
    if let Some(path) = release_gate_data_dir() {
        if let Err(error) = qinghua_shared_store::v2_admin::initialize_empty_v2_root(&path) {
            eprintln!("[data] 发布门禁主库初始化失败：{error}");
            return;
        }
        std::env::set_var("QINGHUA_DATA_DIR", &path);
        std::env::set_var("QINGHUA_STORE_BACKEND", "v2");
        eprintln!("[data] 发布门禁临时主库目录：{}", path.display());
        return;
    }
    if let Some(path) = configured_data_dir(app) {
        if path.is_dir() {
            std::env::set_var("QINGHUA_DATA_DIR", &path);
            set_storage_backend_env(&path);
            eprintln!("[data] 自定义主库目录：{}", path.display());
        } else {
            let recovery = app
                .path()
                .app_local_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir())
                .join("storage-recovery")
                .join(std::process::id().to_string());
            std::env::set_var("QINGHUA_DATA_DIR", &recovery);
            std::env::set_var("QINGHUA_STORE_BACKEND", "v1");
            std::env::set_var(MISSING_DATA_DIR_ENV, &path);
            eprintln!(
                "[data] 配置的资源目录不存在：{}；进入恢复模式",
                path.display()
            );
        }
        return;
    }
    let Some(exe) = std::env::current_exe().ok() else {
        return;
    };
    if let Some(source) = populated_v1_source(&legacy_v1_candidates(&exe)) {
        std::env::set_var("QINGHUA_DATA_DIR", &source);
        std::env::set_var("QINGHUA_STORE_BACKEND", "v1");
        eprintln!("[data] 检测到待升级 V1：{}", source.display());
        return;
    }

    let mut bases = Vec::new();
    if let Some(base) = business_data_base_dir(&exe) {
        push_unique_path(&mut bases, base);
    }
    push_unique_path(&mut bases, qinghua_shared_store::default_v1_data_dir());
    for base in &bases {
        let Ok(target) = v2_sibling_path(base) else {
            continue;
        };
        if qinghua_shared_store::v2_admin::initialize_empty_v2_root(&target).is_err() {
            continue;
        }
        if save_data_dir_config(app, &target).is_err() {
            continue;
        }
        std::env::set_var("QINGHUA_DATA_DIR", &target);
        std::env::set_var("QINGHUA_STORE_BACKEND", "v2");
        eprintln!("[data] 新安装 V2 主库：{}", target.display());
        return;
    }

    if let Some(path) = bases.first() {
        std::env::set_var("QINGHUA_DATA_DIR", path);
        std::env::set_var("QINGHUA_STORE_BACKEND", "v1");
        eprintln!("[data] V2 初始化失败，回退 V1：{}", path.display());
    }
}

fn v2_sibling_path(base: &Path) -> Result<PathBuf, String> {
    let name = base
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("无法从资源目录推导 V2 路径：{}", base.display()))?;
    let next = if let Some(prefix) = name.strip_suffix("-v1") {
        format!("{prefix}-v2")
    } else {
        format!("{name}-v2")
    };
    let parent = base
        .parent()
        .ok_or_else(|| format!("资源目录没有上级目录：{}", base.display()))?;
    Ok(parent.join(next))
}

fn automatic_v2_target(_app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(custom) = std::env::var("QINGHUA_AUTO_V2_TARGET") {
        let path = PathBuf::from(custom.trim());
        if path.is_absolute() {
            return Ok(path);
        }
    }
    let exe = std::env::current_exe().map_err(|error| format!("读取程序位置失败：{error}"))?;
    let base = business_data_base_dir(&exe).unwrap_or_else(qinghua_shared_store::default_data_dir);
    v2_sibling_path(&base)
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    let left = left.canonicalize().unwrap_or_else(|_| left.to_path_buf());
    let right = right.canonicalize().unwrap_or_else(|_| right.to_path_buf());
    left == right
}

fn target_belongs_to_v1(target: &Path, source: &Path) -> Result<bool, String> {
    for name in ["manifest.json", "migration-report.json"] {
        let path = target.join(name);
        if !path.is_file() {
            continue;
        }
        let raw = std::fs::read_to_string(&path)
            .map_err(|error| format!("读取 {} 失败：{error}", path.display()))?;
        let value: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|error| format!("解析 {} 失败：{error}", path.display()))?;
        if let Some(root) = value.get("sourceRoot").and_then(serde_json::Value::as_str) {
            return Ok(paths_equal(Path::new(root), source));
        }
    }
    Ok(false)
}

fn quarantine_empty_v2_target(target: &Path) -> Result<bool, String> {
    let verification = match qinghua_shared_store::v2_admin::verify_v2_root(target) {
        Ok(report) => report,
        Err(_) => return Ok(false),
    };
    if !verification.ok
        || verification.assets_total != 0
        || verification.table_rows.values().any(|count| *count != 0)
    {
        return Ok(false);
    }
    let name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("无法为空的 V2 目标生成备份名：{}", target.display()))?;
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let archived = target.with_file_name(format!("{name}.empty-{millis}"));
    std::fs::rename(target, &archived)
        .map_err(|error| format!("隔离空的 V2 目标 {} 失败：{error}", target.display()))?;
    eprintln!(
        "[data] 空的 V2 目标已隔离到 {}，准备从真实 V1 重新迁移",
        archived.display()
    );
    Ok(true)
}

/// 选择一个新主库目录。这里只返回路径，不授权素材文件作用域。
#[tauri::command]
async fn pick_data_dir(app: tauri::AppHandle) -> Option<String> {
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    app.dialog()
        .file()
        .set_title("选择轻画数据目录")
        .pick_folder(move |picked| {
            let _ = tx.blocking_send(picked.map(|p| p.to_string()));
        });
    rx.recv().await.flatten()
}

#[tauri::command]
fn inspect_data_dir(path: String) -> Result<StorageRootInfo, String> {
    let selected = PathBuf::from(path.trim());
    storage_root_info(&resolve_known_storage_root(&selected))
}

#[tauri::command]
fn storage_startup_state(app: tauri::AppHandle) -> Result<StorageStartupState, String> {
    if let Some(missing) = missing_data_dir() {
        return Ok(StorageStartupState {
            kind: "missing".into(),
            current_root: Some(missing.to_string_lossy().to_string()),
            source_root: Some(missing.to_string_lossy().to_string()),
            target_root: None,
            reason: Some("原资源目录不存在，可能已被手动移动".into()),
        });
    }
    let root = current_data_dir(&app).ok_or_else(|| "无法定位当前资源目录".to_string())?;
    let info = storage_root_info(&root)?;
    if info.kind == "v2" {
        if let Some(pending) = qinghua_shared_store::v2_admin::read_pending_v1_cleanup(&root)? {
            return Ok(StorageStartupState {
                kind: "cleanupPending".into(),
                current_root: Some(root.to_string_lossy().to_string()),
                source_root: Some(pending.source_root),
                target_root: Some(root.to_string_lossy().to_string()),
                reason: None,
            });
        }
        return Ok(StorageStartupState {
            kind: "ready".into(),
            current_root: Some(root.to_string_lossy().to_string()),
            source_root: None,
            target_root: None,
            reason: None,
        });
    }
    if info.kind == "v1" {
        let target = automatic_v2_target(&app)?;
        if target == root {
            return Ok(StorageStartupState {
                kind: "blocked".into(),
                current_root: Some(root.to_string_lossy().to_string()),
                source_root: Some(root.to_string_lossy().to_string()),
                target_root: Some(target.to_string_lossy().to_string()),
                reason: Some("自动 V2 目标与原 V1 目录相同".into()),
            });
        }
        let mut target_info = storage_root_info(&target)?;
        if !matches!(target_info.kind.as_str(), "empty" | "partial" | "v2") {
            return Ok(StorageStartupState {
                kind: "blocked".into(),
                current_root: Some(root.to_string_lossy().to_string()),
                source_root: Some(root.to_string_lossy().to_string()),
                target_root: Some(target.to_string_lossy().to_string()),
                reason: target_info.reason,
            });
        }
        if target_info.kind == "v2" && !target_belongs_to_v1(&target, &root)? {
            if quarantine_empty_v2_target(&target)? {
                target_info = storage_root_info(&target)?;
            }
        }
        if matches!(target_info.kind.as_str(), "partial" | "v2")
            && !target_belongs_to_v1(&target, &root)?
        {
            return Ok(StorageStartupState {
                kind: "blocked".into(),
                current_root: Some(root.to_string_lossy().to_string()),
                source_root: Some(root.to_string_lossy().to_string()),
                target_root: Some(target.to_string_lossy().to_string()),
                reason: Some("自动 V2 目标已存在，但不属于当前 V1 数据".into()),
            });
        }
        return Ok(StorageStartupState {
            kind: "v1Upgrade".into(),
            current_root: Some(root.to_string_lossy().to_string()),
            source_root: Some(root.to_string_lossy().to_string()),
            target_root: Some(target.to_string_lossy().to_string()),
            reason: None,
        });
    }
    Ok(StorageStartupState {
        kind: if info.ready { "ready" } else { "blocked" }.into(),
        current_root: Some(root.to_string_lossy().to_string()),
        source_root: None,
        target_root: None,
        reason: info.reason,
    })
}

#[tauri::command]
async fn auto_upgrade_storage(app: tauri::AppHandle) -> Result<StorageUpgradeResult, String> {
    let state = storage_startup_state(app.clone())?;
    if state.kind != "v1Upgrade" {
        return Err("当前资源目录不需要自动 V1 → V2 升级".into());
    }
    let source = PathBuf::from(state.source_root.ok_or("缺少 V1 源目录")?);
    let target = PathBuf::from(state.target_root.ok_or("缺少 V2 目标目录")?);
    set_storage_maintenance(&app, true).await?;
    let outcome: Result<StorageUpgradeResult, String> = async {
        let target_info = storage_root_info(&target)?;
        let (migration, verification) = if target_info.kind == "v2" {
            let verification = tauri::async_runtime::spawn_blocking({
                let target = target.clone();
                move || qinghua_shared_store::v2_admin::verify_v2_root(&target)
            })
            .await
            .map_err(|error| format!("V2 校验任务异常结束：{error}"))??;
            (None, verification)
        } else {
            let migration = tauri::async_runtime::spawn_blocking({
                let source = source.clone();
                let target = target.clone();
                move || qinghua_shared_store::migration::migrate_v1_to_v2(&source, &target, false)
            })
            .await
            .map_err(|error| format!("自动迁移任务异常结束：{error}"))??;
            let verification = tauri::async_runtime::spawn_blocking({
                let target = target.clone();
                move || qinghua_shared_store::v2_admin::verify_v2_root(&target)
            })
            .await
            .map_err(|error| format!("V2 校验任务异常结束：{error}"))??;
            (Some(migration), verification)
        };
        if !verification.ok {
            return Err(format!(
                "V2 校验发现 {} 个缺失项，已保留 V1",
                verification.failures.len()
            ));
        }
        qinghua_shared_store::v2_admin::write_pending_v1_cleanup(&target, &source)?;
        qinghua_shared_store::switch_backend(&target, "v2")?;
        if let Err(error) = save_data_dir_config(&app, &target) {
            let _ = qinghua_shared_store::v2_admin::clear_pending_v1_cleanup(&target);
            let _ = qinghua_shared_store::switch_backend(&source, "v1");
            return Err(error);
        }
        Ok(StorageUpgradeResult {
            source_root: source.to_string_lossy().to_string(),
            target_root: target.to_string_lossy().to_string(),
            migration,
            verification,
        })
    }
    .await;
    if outcome.is_err() {
        let _ = set_storage_maintenance(&app, false).await;
    }
    outcome
}

#[tauri::command]
async fn finalize_storage_upgrade(
    app: tauri::AppHandle,
) -> Result<qinghua_shared_store::v2_admin::V2Verification, String> {
    let root = current_data_dir(&app).ok_or_else(|| "无法定位当前资源目录".to_string())?;
    set_storage_maintenance(&app, true).await?;
    let verification = tauri::async_runtime::spawn_blocking({
        let root = root.clone();
        move || qinghua_shared_store::v2_admin::finalize_v1_cleanup(&root)
    })
    .await
    .map_err(|error| format!("V1 清理任务异常结束：{error}"))?;
    let release = set_storage_maintenance(&app, false).await;
    let verification = verification?;
    release?;
    Ok(verification)
}

#[tauri::command]
async fn replace_storage_root(
    app: tauri::AppHandle,
    target: String,
) -> Result<StorageReplaceResult, String> {
    let target = PathBuf::from(target.trim());
    let target = resolve_known_storage_root(&target);
    if !target.is_absolute() {
        return Err("新的资源目录必须是绝对路径".into());
    }
    if let Some(missing) = missing_data_dir() {
        let recovery_root =
            current_data_dir(&app).ok_or_else(|| "无法定位恢复模式目录".to_string())?;
        set_storage_maintenance(&app, true).await?;
        let outcome: Result<StorageReplaceResult, String> = async {
            let verification = tauri::async_runtime::spawn_blocking({
                let target = target.clone();
                move || qinghua_shared_store::v2_admin::adopt_manually_moved_v2(&target)
            })
            .await
            .map_err(|error| format!("手动移动校验任务异常结束：{error}"))??;
            qinghua_shared_store::switch_backend(&target, "v2")?;
            if let Err(error) = save_data_dir_config(&app, &target) {
                let _ = qinghua_shared_store::switch_backend(&recovery_root, "v1");
                return Err(error);
            }
            Ok(StorageReplaceResult {
                mode: "adopted".into(),
                source_root: missing.to_string_lossy().to_string(),
                target_root: target.to_string_lossy().to_string(),
                source_deleted: !missing.exists(),
                verification,
            })
        }
        .await;
        if outcome.is_err() {
            let _ = set_storage_maintenance(&app, false).await;
        }
        return outcome;
    }

    let source = current_data_dir(&app).ok_or_else(|| "无法定位当前资源目录".to_string())?;
    let source_info = storage_root_info(&source)?;
    if source_info.kind != "v2" || !source_info.ready {
        return Err("只有完整 V2 资源根可以更换位置".into());
    }
    set_storage_maintenance(&app, true).await?;
    let outcome: Result<StorageReplaceResult, String> = async {
        let copy = tauri::async_runtime::spawn_blocking({
            let source = source.clone();
            let target = target.clone();
            move || qinghua_shared_store::v2_admin::copy_v2_root(&source, &target)
        })
        .await
        .map_err(|error| format!("复制校验任务异常结束：{error}"))??;
        qinghua_shared_store::switch_backend(&target, "v2")?;
        if let Err(error) = save_data_dir_config(&app, &target) {
            let _ = qinghua_shared_store::switch_backend(&source, "v2");
            return Err(error);
        }
        let source_deleted = tauri::async_runtime::spawn_blocking({
            let source = source.clone();
            move || qinghua_shared_store::v2_admin::remove_checked_v2_root(&source)
        })
        .await
        .map_err(|error| format!("旧位置清理任务异常结束：{error}"))?
        .is_ok();
        Ok(StorageReplaceResult {
            mode: "moved".into(),
            source_root: source.to_string_lossy().to_string(),
            target_root: target.to_string_lossy().to_string(),
            source_deleted,
            verification: copy.target,
        })
    }
    .await;
    if outcome.is_err() {
        let _ = set_storage_maintenance(&app, false).await;
    }
    outcome
}

/// V1 → V2 迁移是大文件 IO 与哈希计算，必须离开 Tauri 主线程。
#[tauri::command]
async fn migrate_data_dir(
    app: tauri::AppHandle,
    source: String,
    target: String,
    dry_run: bool,
) -> Result<qinghua_shared_store::migration::MigrationReport, String> {
    set_storage_maintenance(&app, true).await?;
    let migration = tauri::async_runtime::spawn_blocking(move || {
        qinghua_shared_store::migration::migrate_v1_to_v2(
            &PathBuf::from(source),
            &PathBuf::from(target),
            dry_run,
        )
    })
    .await;
    let release = set_storage_maintenance(&app, false).await;
    let report = migration.map_err(|error| format!("迁移任务异常结束：{error}"))??;
    release?;
    Ok(report)
}

async fn set_storage_maintenance(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let action = if enabled { "begin" } else { "end" };
    let port = app.state::<SharedStoreRuntime>().port;
    let response = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{port}/maintenance/{action}"))
        .send()
        .await
        .map_err(|error| format!("无法暂停共享存储写入：{error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "共享存储维护模式请求失败：HTTP {}",
            response.status()
        ));
    }
    Ok(())
}

/// 保存新主库位置。只验证可写并落配置，不复制 / 移动 / 删除任何现有数据。
fn save_data_dir_config(app: &tauri::AppHandle, dir: &Path) -> Result<(), String> {
    let config_path =
        data_dir_config_path(app).ok_or_else(|| "无法定位应用配置目录".to_string())?;
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| format!("创建配置目录失败：{err}"))?;
    }
    let payload = serde_json::to_vec_pretty(&DataDirConfig {
        data_dir: dir.to_string_lossy().to_string(),
    })
    .map_err(|err| format!("序列化数据目录配置失败：{err}"))?;
    let temporary = config_path.with_extension("json.tmp");
    std::fs::write(&temporary, payload).map_err(|err| format!("写配置临时文件失败：{err}"))?;
    if config_path.exists() {
        std::fs::remove_file(&config_path).map_err(|err| format!("替换旧配置失败：{err}"))?;
    }
    std::fs::rename(&temporary, &config_path).map_err(|err| format!("保存配置失败：{err}"))?;
    std::env::set_var("QINGHUA_DATA_DIR", dir);
    set_storage_backend_env(dir);
    std::env::remove_var(MISSING_DATA_DIR_ENV);
    Ok(())
}

#[tauri::command]
fn set_data_dir(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let dir = resolve_known_storage_root(&PathBuf::from(path.trim()));
    if !dir.is_absolute() {
        return Err("数据目录必须是绝对路径".into());
    }
    if !dir_is_writable(&dir) {
        return Err(format!("目录不可写：{}", dir.display()));
    }
    let info = storage_root_info(&dir)?;
    if !info.ready {
        return Err(info
            .reason
            .unwrap_or_else(|| "不是可用的资源目录".to_string()));
    }
    save_data_dir_config(&app, &dir)?;
    Ok(dir.to_string_lossy().to_string())
}

fn is_cache_dir_name(name: &str) -> bool {
    CACHE_DIR_NAMES.contains(&name)
}

/// 当前数据目录（与 #250 同一条规则：程序隔壁的 `data`，否则系统默认位置）。
pub(crate) fn current_data_dir(_app: &tauri::AppHandle) -> Option<PathBuf> {
    Some(qinghua_shared_store::default_data_dir())
}

/// WebView2 的 profile 默认区（网页缓存就在它下面）。
fn profile_default_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    Some(
        shared_shell_profile_dir(app)?
            .join("EBWebView")
            .join("Default"),
    )
}

fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut total = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => total += dir_size(&path),
            Ok(kind) if kind.is_file() => {
                total += entry.metadata().map(|meta| meta.len()).unwrap_or(0)
            }
            _ => {}
        }
    }
    total
}

/// 可清理的网页缓存现在占多少字节。
fn cache_bytes(app: &tauri::AppHandle) -> u64 {
    let Some(default) = profile_default_dir(app) else {
        return 0;
    };
    let Ok(entries) = std::fs::read_dir(&default) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|entry| entry.file_name().to_str().is_some_and(is_cache_dir_name))
        .map(|entry| dir_size(&entry.path()))
        .sum()
}

/// 数据目录的绝对路径（项目 / 令牌 / 素材库都在里面）。
#[tauri::command]
fn data_dir_path(app: tauri::AppHandle) -> String {
    current_data_dir(&app)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// 在系统文件管理器里打开一个目录（壳里的「打开数据目录 / 打开素材目录」用它）。
#[tauri::command]
fn open_dir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if !std::path::Path::new(&path).is_dir() {
        return Err("目录不存在或已被移动".into());
    }
    app.opener()
        .open_path(path, None::<String>)
        .map_err(|err| err.to_string())
}

/// 网页缓存占用（字节）。
#[tauri::command]
fn cache_usage(app: tauri::AppHandle) -> u64 {
    cache_bytes(&app)
}

/// 清网页缓存，返回**实际**释放的字节数。
///
/// 三条刻意做法：
/// 1. **只删白名单里的目录**（见 `CACHE_DIR_NAMES`）；
/// 2. **先量、再删、再量**，用差值报成绩 —— 正在被 WebView2 占用的文件删不掉，
///    拿"删之前的大小"当成绩就是虚报；
/// 3. **删不掉不算错**：缓存本来就能重建，锁住的文件下次再删就是。
#[tauri::command]
fn clear_cache(app: tauri::AppHandle) -> u64 {
    let before = cache_bytes(&app);
    if let Some(default) = profile_default_dir(&app) {
        if let Ok(entries) = std::fs::read_dir(&default) {
            for entry in entries.flatten() {
                let name_ok = entry.file_name().to_str().is_some_and(is_cache_dir_name);
                if name_ok && entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                    let _ = std::fs::remove_dir_all(entry.path());
                }
            }
        }
    }
    before.saturating_sub(cache_bytes(&app))
}


#[cfg(test)]
mod storage_tests {
    use super::*;

    #[test]
    fn cache_whitelist_covers_browser_caches() {
        for name in [
            "Cache",
            "Code Cache",
            "GPUCache",
            "DawnWebGPUCache",
            "ShaderCache",
        ] {
            assert!(is_cache_dir_name(name), "{name} 应当算可清理的网页缓存");
        }
    }

    #[test]
    fn cache_whitelist_never_touches_user_data() {
        // 这条是**护栏**：哪天有人把它改成"黑名单式"（"除了这几个都删"），先在这里红
        for name in [
            "IndexedDB",
            "Local Storage",
            "WebStorage",
            "Session Storage",
            "Network",
            "Cookies",
            "Preferences",
            "blob_storage",
        ] {
            assert!(
                !is_cache_dir_name(name),
                "{name} 是用户数据，绝不能当缓存删"
            );
        }
    }

    #[test]
    fn dir_size_counts_nested_files() {
        let dir = std::env::temp_dir().join("qinghua-dir-size-test");
        let nested = dir.join("a").join("b");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(dir.join("one.bin"), vec![0u8; 10]).unwrap();
        std::fs::write(nested.join("two.bin"), vec![0u8; 25]).unwrap();
        assert_eq!(dir_size(&dir), 35);
        std::fs::remove_dir_all(&dir).unwrap();
        // 量不到的目录返回 0 而不是抛 —— 调用方只看差值，"没有"与"零字节"在这里等价
        assert_eq!(dir_size(&dir), 0);
    }

    fn backup_temp_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "qinghua-profile-backup-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn backup_at(ms: u64) -> std::time::SystemTime {
        std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_millis(ms)
    }

    #[test]
    fn profile_backup_copies_user_data_and_skips_cache() {
        let base = backup_temp_dir("copy");
        let dir = base.join("data");
        let source = dir.join("EBWebView").join("Default");
        std::fs::create_dir_all(source.join("IndexedDB")).unwrap();
        std::fs::write(source.join("IndexedDB").join("db.ldb"), b"db").unwrap();
        std::fs::create_dir_all(source.join("Local Storage")).unwrap();
        std::fs::write(source.join("Local Storage").join("state"), b"ls").unwrap();
        std::fs::create_dir_all(source.join("Cache")).unwrap();
        std::fs::write(source.join("Cache").join("junk"), b"junk").unwrap();

        let backup = create_profile_backup(&dir, backup_at(1_000))
            .unwrap()
            .expect("有 IndexedDB 就该拍出一份");
        assert!(backup.join("IndexedDB").join("db.ldb").is_file());
        assert!(backup.join("Local Storage").join("state").is_file());
        assert_eq!(
            std::fs::read(backup.join("IndexedDB").join("db.ldb")).unwrap(),
            b"db"
        );
        assert_eq!(
            std::fs::read(backup.join("Local Storage").join("state")).unwrap(),
            b"ls"
        );
        assert!(!backup.join("Cache").exists(), "可再生缓存不该进备份");

        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn profile_backup_keeps_newest_and_never_touches_unknown_dirs() {
        let base = backup_temp_dir("prune");
        let dir = base.join("data");
        let source = dir.join("EBWebView").join("Default").join("IndexedDB");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("db.ldb"), b"db").unwrap();
        std::fs::create_dir_all(profile_backup_root(&dir).join("keep-me")).unwrap();

        for ms in [1_000, 2_000, 3_000, 4_000] {
            create_profile_backup(&dir, backup_at(ms)).unwrap();
        }

        let root = profile_backup_root(&dir);
        let names: Vec<String> = std::fs::read_dir(&root)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(
            names
                .iter()
                .filter(|name| name.starts_with("profile-"))
                .count(),
            PROFILE_BACKUP_KEEP
        );
        assert!(!names.contains(&"profile-1000".to_string()));
        assert!(names.contains(&"profile-4000".to_string()));
        assert!(root.join("keep-me").is_dir(), "不认识的目录不能被清理");

        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn profile_backup_without_source_is_a_noop() {
        let base = backup_temp_dir("missing");
        let dir = base.join("data");
        assert!(create_profile_backup(&dir, backup_at(1_000))
            .unwrap()
            .is_none());
        assert!(!profile_backup_root(&dir).exists());
    }
}

// ─────────────────────────────────────────────────────────────
// 本机 CLI：真的起一个子进程（用户 2026-10-06 第 11 批第 4 条）
// ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let release_gate = release_gate_enabled(std::env::var(RELEASE_GATE_ENV).ok().as_deref());
    let shared_store_port = configured_shared_store_port().unwrap_or_else(|error| {
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
            data_dir_path,
            pick_data_dir,
            set_data_dir,
            inspect_data_dir,
            storage_startup_state,
            auto_upgrade_storage,
            finalize_storage_upgrade,
            replace_storage_root,
            migrate_data_dir,
            open_dir,
            cache_usage,
            clear_cache,
            profile_backup_info,
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
            apply_data_dir_config(app.handle());
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
            let data_dir = shared_shell_profile_dir(app.handle());
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

#[cfg(test)]
mod data_dir_tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

    fn none_roots() -> Vec<PathBuf> {
        Vec::new()
    }
    fn always(_: &Path) -> bool {
        true
    }
    fn never(_: &Path) -> bool {
        false
    }

    fn temp_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "qinghua-data-dir-{name}-{}-{}",
            std::process::id(),
            TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn storage_location_config_requires_an_absolute_path() {
        assert_eq!(
            parse_data_dir_config(r#"{"dataDir":"D:\\轻画数据"}"#),
            Some(PathBuf::from("D:\\轻画数据"))
        );
        assert_eq!(
            parse_data_dir_config(r#"{"dataDir":"relative\\data"}"#),
            None
        );
        assert_eq!(parse_data_dir_config("not json"), None);
    }

    #[test]
    fn release_gate_data_dir_requires_sentinel_and_absolute_path() {
        assert_eq!(
            parse_release_gate_data_dir(Some("1"), Some("D:\\gate\\data-v2")),
            Some(PathBuf::from("D:\\gate\\data-v2"))
        );
        assert_eq!(
            parse_release_gate_data_dir(Some("1"), Some("relative\\data-v2")),
            None
        );
        assert_eq!(
            parse_release_gate_data_dir(None, Some("D:\\gate\\data-v2")),
            None
        );
    }

    #[test]
    fn release_gate_shell_profile_follows_the_isolated_data_root() {
        assert_eq!(
            shell_profile_dir_for(
                Some(Path::new("D:\\gate\\product\\data-v2")),
                Some(PathBuf::from("C:\\Users\\me\\AppData\\Local\\com.qinghua.canvas")),
            ),
            Some(PathBuf::from("D:\\gate\\product\\shell-v2"))
        );
        assert_eq!(
            shell_profile_dir_for(
                None,
                Some(PathBuf::from("C:\\Users\\me\\AppData\\Local\\com.qinghua.canvas")),
            ),
            Some(PathBuf::from(
                "C:\\Users\\me\\AppData\\Local\\com.qinghua.canvas\\shell-v2"
            ))
        );
    }

    #[test]
    fn shared_store_port_keeps_normal_default_and_ignores_override_without_gate() {
        assert_eq!(
            parse_shared_store_port(None, Some("19876")),
            Ok(qinghua_shared_store::PORT)
        );
        assert_eq!(
            parse_shared_store_port(Some("0"), Some("19876")),
            Ok(qinghua_shared_store::PORT)
        );
    }

    #[test]
    fn shared_store_port_uses_gate_default_and_explicit_override() {
        assert_eq!(
            parse_shared_store_port(Some("1"), None),
            Ok(RELEASE_GATE_DEFAULT_SHARED_STORE_PORT)
        );
        assert_eq!(
            parse_shared_store_port(Some("1"), Some(" 19877 ")),
            Ok(19877)
        );
    }

    #[test]
    fn shared_store_port_rejects_invalid_gate_override() {
        assert!(parse_shared_store_port(Some("1"), Some("0")).is_err());
        assert!(parse_shared_store_port(Some("1"), Some("65536")).is_err());
        assert!(parse_shared_store_port(Some("1"), Some("not-a-port")).is_err());
    }

    #[test]
    fn development_build_uses_project_data_dir() {
        assert_eq!(
            preferred_business_data_dir(
                Path::new("E:\\work\\qinghua\\src-tauri\\target\\debug\\qinghua.exe"),
                &none_roots(),
                &always,
            ),
            Some(PathBuf::from("E:\\work\\qinghua\\data"))
        );
    }

    #[test]
    fn development_output_uses_a_separate_storage_config() {
        assert_eq!(
            data_dir_config_name(Path::new(
                "E:\\work\\qinghua\\src-tauri\\target\\debug\\qinghua.exe"
            )),
            "storage-location.dev.json"
        );
        assert_eq!(
            data_dir_config_name(Path::new("E:\\apps\\轻画\\qinghua.exe")),
            "storage-location.json"
        );
    }

    #[test]
    fn custom_install_uses_sibling_data_dir() {
        assert_eq!(
            preferred_business_data_dir(
                Path::new("E:\\apps\\qinghua\\app\\qinghua.exe"),
                &none_roots(),
                &always,
            ),
            Some(PathBuf::from("E:\\apps\\qinghua\\data"))
        );
    }

    #[test]
    fn current_install_keeps_data_inside_the_product_folder() {
        assert_eq!(
            preferred_business_data_dir(
                Path::new("E:\\apps\\轻画\\qinghua.exe"),
                &none_roots(),
                &always,
            ),
            Some(PathBuf::from("E:\\apps\\轻画\\data"))
        );
    }

    #[test]
    fn system_install_and_drive_root_do_not_pollute_parent() {
        let roots = vec![PathBuf::from("C:\\Users\\u\\AppData\\Local")];
        assert_eq!(
            preferred_business_data_dir(
                Path::new("C:\\Users\\u\\AppData\\Local\\轻画\\qinghua.exe"),
                &roots,
                &always,
            ),
            Some(PathBuf::from("C:\\Users\\u\\AppData\\Local\\轻画\\data"))
        );
        assert_eq!(
            preferred_business_data_dir(Path::new("D:\\qinghua.exe"), &none_roots(), &always,),
            None
        );
    }

    #[test]
    fn unwritable_preferred_data_dir_falls_back() {
        assert_eq!(
            preferred_business_data_dir(
                Path::new("E:\\apps\\qinghua\\app\\qinghua.exe"),
                &none_roots(),
                &never,
            ),
            None
        );
    }

    #[test]
    fn chosen_install_dir_gets_sibling_data_dir() {
        let got = decide_data_dir(Path::new("D:\\轻画\\app"), &none_roots(), &always);
        assert_eq!(got, Some(PathBuf::from("D:\\轻画\\data")));
    }

    #[test]
    fn default_install_dir_under_local_app_data_falls_back() {
        // 默认安装位置：%LOCALAPPDATA%\轻画 ⇒ 上一级是 %LOCALAPPDATA%，命中系统目录
        let roots = vec![PathBuf::from("C:\\Users\\u\\AppData\\Local")];
        let got = decide_data_dir(
            Path::new("C:\\Users\\u\\AppData\\Local\\轻画"),
            &roots,
            &always,
        );
        assert_eq!(got, None);
    }

    #[test]
    fn program_files_falls_back() {
        let roots = vec![PathBuf::from("C:\\Program Files")];
        let got = decide_data_dir(Path::new("C:\\Program Files\\轻画"), &roots, &always);
        assert_eq!(got, None);
    }

    #[test]
    fn drive_root_is_not_a_usable_parent() {
        // 装在 D:\app ⇒ 上一级是盘根 D:\ ⇒ 不做"隔壁 data"
        assert_eq!(
            decide_data_dir(Path::new("D:\\app"), &none_roots(), &always),
            None
        );
        // 程序直接躺在盘根 ⇒ 连上一级都没有
        assert_eq!(
            decide_data_dir(Path::new("D:\\qinghua.exe"), &none_roots(), &always),
            None
        );
    }

    #[test]
    fn unwritable_parent_falls_back() {
        let got = decide_data_dir(Path::new("D:\\轻画\\app"), &none_roots(), &never);
        assert_eq!(got, None);
    }

    #[test]
    fn dev_build_output_falls_back() {
        // `npm run tauri dev` / `cargo test` 的 exe 在 target\{debug,release} 下：
        // 数据不能跟着进构建缓存（`cargo clean` 会连它一起删）
        let roots = none_roots();
        assert_eq!(
            decide_data_dir(
                Path::new("E:\\proj\\src-tauri\\target\\debug"),
                &roots,
                &always
            ),
            None
        );
        assert_eq!(
            decide_data_dir(
                Path::new("E:\\proj\\src-tauri\\target\\release"),
                &roots,
                &always
            ),
            None
        );
        // 但真的装在 `...\轻画\app` 时要生效（"target" 只在 dev 那一层出现）
        assert_eq!(
            decide_data_dir(Path::new("D:\\轻画\\app"), &roots, &always),
            Some(PathBuf::from("D:\\轻画\\data"))
        );
    }

    #[test]
    fn system_root_match_is_case_insensitive() {
        let roots = vec![PathBuf::from("c:\\program files")];
        let got = decide_data_dir(Path::new("C:\\Program Files\\轻画"), &roots, &always);
        assert_eq!(got, None);
    }

    #[test]
    fn storage_root_detects_v1_v2_empty_and_unknown() {
        let v1 = temp_dir("v1");
        std::fs::create_dir_all(v1.join("projects")).unwrap();
        let v1_info = storage_root_info(&v1).unwrap();
        assert_eq!(v1_info.kind, "v1");
        assert!(v1_info.ready);
        assert_eq!(backend_for_storage_root(&v1), "v1");

        let v2 = temp_dir("v2");
        std::fs::create_dir_all(v2.join("media")).unwrap();
        std::fs::write(v2.join("manifest.sqlite"), b"").unwrap();
        std::fs::write(
            v2.join("manifest.json"),
            br#"{"formatVersion":2,"schemaVersion":2,"status":"complete"}"#,
        )
        .unwrap();
        let v2_info = storage_root_info(&v2).unwrap();
        assert_eq!(v2_info.kind, "v2");
        assert!(v2_info.ready);
        assert_eq!(backend_for_storage_root(&v2), "v2");

        let empty = temp_dir("empty");
        std::fs::create_dir_all(&empty).unwrap();
        let empty_info = storage_root_info(&empty).unwrap();
        assert_eq!(empty_info.kind, "empty");
        assert!(empty_info.ready);
        assert_eq!(backend_for_storage_root(&empty), "v1");

        let unknown = temp_dir("unknown");
        std::fs::create_dir_all(&unknown).unwrap();
        std::fs::write(unknown.join("random.txt"), b"x").unwrap();
        let unknown_info = storage_root_info(&unknown).unwrap();
        assert_eq!(unknown_info.kind, "unknown");
        assert!(!unknown_info.ready);

        let _ = std::fs::remove_dir_all(v1);
        let _ = std::fs::remove_dir_all(v2);
        let _ = std::fs::remove_dir_all(empty);
        let _ = std::fs::remove_dir_all(unknown);
    }

    #[test]
    fn automatic_v2_target_is_a_sibling_without_temporary_new_name() {
        assert_eq!(
            v2_sibling_path(Path::new("E:\\轻画\\data")).unwrap(),
            PathBuf::from("E:\\轻画\\data-v2")
        );
        assert_eq!(
            v2_sibling_path(Path::new("C:\\data\\shared-store-v1")).unwrap(),
            PathBuf::from("C:\\data\\shared-store-v2")
        );
    }

    #[test]
    fn existing_v2_target_must_declare_the_same_v1_source() {
        let source = temp_dir("source");
        let target = temp_dir("target");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(
            target.join("manifest.json"),
            serde_json::to_vec(&serde_json::json!({
                "status":"complete",
                "sourceRoot":source.to_string_lossy()
            }))
            .unwrap(),
        )
        .unwrap();
        assert!(target_belongs_to_v1(&target, &source).unwrap());
        let other = temp_dir("other");
        std::fs::create_dir_all(&other).unwrap();
        assert!(!target_belongs_to_v1(&target, &other).unwrap());
        let _ = std::fs::remove_dir_all(source);
        let _ = std::fs::remove_dir_all(target);
        let _ = std::fs::remove_dir_all(other);
    }

    #[test]
    fn legacy_source_selection_skips_empty_new_directories() {
        let canonical = temp_dir("canonical");
        let install_local = temp_dir("install-local");
        let buggy_parent = temp_dir("buggy-parent");
        std::fs::create_dir_all(canonical.join("projects")).unwrap();
        std::fs::write(canonical.join("projects/p1.json"), br#"{"id":"p1"}"#).unwrap();
        std::fs::create_dir_all(install_local.join("channels")).unwrap();
        std::fs::create_dir_all(buggy_parent.join("channels")).unwrap();
        assert_eq!(
            populated_v1_source(&[
                install_local.clone(),
                buggy_parent.clone(),
                canonical.clone()
            ]),
            Some(canonical.clone())
        );
        let _ = std::fs::remove_dir_all(canonical);
        let _ = std::fs::remove_dir_all(install_local);
        let _ = std::fs::remove_dir_all(buggy_parent);
    }

    #[test]
    fn product_folder_selection_resolves_to_nested_v2_root() {
        let root = temp_dir("product-folder");
        let v2 = root.join("data-v2");
        let report = qinghua_shared_store::v2_admin::initialize_empty_v2_root(&v2).unwrap();
        assert!(report.ok);
        assert_eq!(resolve_known_storage_root(&root), v2);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn empty_mismatched_v2_target_is_quarantined_before_retry() {
        let source = temp_dir("migration-source");
        let target = temp_dir("migration-target");
        std::fs::create_dir_all(&source).unwrap();
        let report = qinghua_shared_store::v2_admin::initialize_empty_v2_root(&target).unwrap();
        assert!(report.ok);
        assert!(quarantine_empty_v2_target(&target).unwrap());
        assert!(!target.exists());
        let archive_prefix = format!("{}.empty-", target.file_name().unwrap().to_string_lossy());
        let archived = std::fs::read_dir(target.parent().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(&archive_prefix)
            });
        assert!(archived);
        let _ = std::fs::remove_dir_all(source);
        for entry in std::fs::read_dir(target.parent().unwrap())
            .unwrap()
            .flatten()
        {
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with(&archive_prefix)
            {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
}
