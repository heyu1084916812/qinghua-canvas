use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const BUNDLED_DIR_NAME: &str = "resources/qinghua-clipper";
const MANAGED_ROOT_ENV: &str = "QINGHUA_CLIPPER_MANAGED_ROOT";
const MANAGED_ROOT_NAME: &str = "QinghuaClipper";
const EXTENSION_DIR_NAME: &str = "extension";
const REQUIRED_FILES: &[&str] = &[
    "manifest.json",
    "shared.js",
    "background.js",
    "drop-target.js",
    "popup.html",
    "popup.js",
    "popup.css",
];

static CONNECTED_VERSION: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static RELOAD_REQUIRED_VERSION: OnceLock<Mutex<Option<String>>> = OnceLock::new();

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipperExtensionStatus {
    pub loaded_version: Option<String>,
    pub stable_version: Option<String>,
    pub bundled_version: Option<String>,
    pub needs_update: bool,
    pub reload_required: bool,
    pub stable_directory: String,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipperExtensionUpdateResult {
    pub status: ClipperExtensionStatus,
    pub updated: bool,
    pub opened_extension_page: bool,
    pub open_error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ExtensionManifest {
    version: String,
}

fn connected_version_cell() -> &'static Mutex<Option<String>> {
    CONNECTED_VERSION.get_or_init(|| Mutex::new(None))
}

fn reload_required_cell() -> &'static Mutex<Option<String>> {
    RELOAD_REQUIRED_VERSION.get_or_init(|| Mutex::new(None))
}

pub(crate) fn record_connected_version(value: Option<&str>) {
    let Some(version) = value.and_then(normalize_version) else {
        return;
    };
    if let Ok(mut expected) = reload_required_cell().lock() {
        if expected
            .as_deref()
            .is_some_and(|wanted| reported_version_satisfies(&version, wanted))
        {
            *expected = None;
        }
    }
    if let Ok(mut current) = connected_version_cell().lock() {
        *current = Some(version);
    }
}

fn mark_reload_required(version: &str) {
    if let Ok(mut expected) = reload_required_cell().lock() {
        *expected = Some(version.to_string());
    }
}

fn reload_required() -> bool {
    reload_required_cell()
        .lock()
        .map(|expected| expected.is_some())
        .unwrap_or(false)
}

fn loaded_version() -> Option<String> {
    connected_version_cell()
        .lock()
        .ok()
        .and_then(|current| current.clone())
}

#[cfg(test)]
pub(crate) mod tests_support {
    pub(crate) fn connected_version() -> Option<String> {
        super::loaded_version()
    }

    pub(crate) fn mark_reload_required(version: &str) {
        super::mark_reload_required(version);
    }

    pub(crate) fn reload_required() -> bool {
        super::reload_required()
    }
}

pub fn status(app: &AppHandle) -> ClipperExtensionStatus {
    let loaded_version = loaded_version();
    let stable_target = managed_root(app).map(|root| root.join(EXTENSION_DIR_NAME));
    let stable_version = stable_target
        .as_ref()
        .ok()
        .filter(|target| target.is_dir())
        .and_then(|target| manifest_version(target).ok());
    let stable_directory = stable_target
        .as_ref()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let bundled = bundled_extension_directory(app)
        .and_then(|path| manifest_version(&path).map(|version| (path, version)));
    match bundled {
        Ok((_, bundled_version)) => {
            let needs_update = extension_needs_update(
                loaded_version.as_deref(),
                stable_version.as_deref(),
                &bundled_version,
            );
            ClipperExtensionStatus {
                loaded_version,
                stable_version,
                bundled_version: Some(bundled_version),
                needs_update,
                reload_required: reload_required(),
                stable_directory,
                error: None,
            }
        }
        Err(error) => ClipperExtensionStatus {
            loaded_version,
            stable_version,
            bundled_version: None,
            needs_update: false,
            reload_required: reload_required(),
            stable_directory,
            error: Some(error),
        },
    }
}

#[tauri::command]
pub fn clipper_extension_update(
    app: AppHandle,
) -> Result<ClipperExtensionUpdateResult, String> {
    let current = status(&app);
    let source = bundled_extension_directory(&app)?;
    let bundled_version = current
        .bundled_version
        .clone()
        .ok_or_else(|| current.error.clone().unwrap_or_else(|| "内置扩展版本不可用".into()))?;
    let managed_root = managed_root(&app)?;
    let target = managed_extension_target(&managed_root)?;

    let should_update = current.needs_update;
    let updated = if should_update {
        replace_extension_atomically(&source, &managed_root, &target, &bundled_version)?;
        mark_reload_required(&bundled_version);
        true
    } else {
        false
    };

    let skip_open = std::env::var_os("QINGHUA_CLIPPER_SKIP_OPEN").is_some();
    let opened_extension_page = !skip_open && open_extension_page().is_ok();
    let open_error = if skip_open {
        None
    } else {
        app.opener()
            .open_path(target.to_string_lossy().to_string(), None::<String>)
            .err()
            .map(|error| error.to_string())
    };
    Ok(ClipperExtensionUpdateResult {
        status: status(&app),
        updated,
        opened_extension_page,
        open_error,
    })
}

fn normalize_version(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 32 {
        return None;
    }
    parse_version(value).ok().map(|_| value.to_string())
}

fn parse_version(value: &str) -> Result<Vec<u64>, String> {
    let parts = value.split('.').collect::<Vec<_>>();
    if parts.is_empty() || parts.len() > 4 {
        return Err(format!("扩展版本格式无效：{value}"));
    }
    parts
        .into_iter()
        .map(|part| {
            if part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()) {
                return Err(format!("扩展版本格式无效：{value}"));
            }
            part.parse::<u64>()
                .map_err(|_| format!("扩展版本格式无效：{value}"))
        })
        .collect()
}

fn version_is_newer(candidate: &str, current: &str) -> bool {
    let Ok(mut candidate) = parse_version(candidate) else {
        return false;
    };
    let Ok(mut current) = parse_version(current) else {
        return false;
    };
    let width = candidate.len().max(current.len());
    candidate.resize(width, 0);
    current.resize(width, 0);
    candidate > current
}

fn extension_needs_update(
    loaded: Option<&str>,
    stable: Option<&str>,
    bundled: &str,
) -> bool {
    loaded
        .or(stable)
        .is_some_and(|current| version_is_newer(bundled, current))
}

fn reported_version_satisfies(reported: &str, pending: &str) -> bool {
    !version_is_newer(pending, reported)
}

fn bundled_extension_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .resource_dir()
        .map_err(|error| format!("无法定位应用资源目录：{error}"))?
        .join(BUNDLED_DIR_NAME);
    if directory.is_dir() {
        return Ok(directory);
    }

    #[cfg(debug_assertions)]
    {
        let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../browser-extension/qinghua-clipper");
        if development.is_dir() {
            return Ok(development);
        }
    }

    Err(format!("内置扩展资源不存在：{}", directory.display()))
}

fn managed_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(custom) = std::env::var_os(MANAGED_ROOT_ENV) {
        let path = PathBuf::from(custom);
        fs::create_dir_all(&path)
            .map_err(|error| format!("无法创建扩展管理目录：{error}"))?;
        return fs::canonicalize(&path)
            .map_err(|error| format!("无法校验扩展管理目录：{error}"));
    }
    let documents = app
        .path()
        .document_dir()
        .map_err(|error| format!("无法定位文档目录：{error}"))?;
    let root = documents.join(MANAGED_ROOT_NAME);
    fs::create_dir_all(&root)
        .map_err(|error| format!("无法创建扩展管理目录：{error}"))?;
    fs::canonicalize(root).map_err(|error| format!("无法校验扩展管理目录：{error}"))
}

fn managed_extension_target(root: &Path) -> Result<PathBuf, String> {
    let canonical_root = fs::canonicalize(root)
        .map_err(|error| format!("无法校验扩展管理目录：{error}"))?;
    let target = canonical_root.join(EXTENSION_DIR_NAME);
    validate_managed_target(&canonical_root, &target)?;
    Ok(target)
}

fn validate_managed_target(root: &Path, target: &Path) -> Result<(), String> {
    if target != root.join(EXTENSION_DIR_NAME) {
        return Err("拒绝写入扩展稳定目录之外的位置".into());
    }
    if target.exists() {
        let canonical = fs::canonicalize(target)
            .map_err(|error| format!("无法校验现有扩展目录：{error}"))?;
        if canonical != target {
            return Err("扩展稳定目录指向了其他位置，已停止覆盖".into());
        }
    }
    Ok(())
}

fn manifest_version(directory: &Path) -> Result<String, String> {
    for required in REQUIRED_FILES {
        let path = directory.join(required);
        if !path.is_file() {
            return Err(format!("扩展文件不完整，缺少 {required}"));
        }
    }
    let source = fs::read_to_string(directory.join("manifest.json"))
        .map_err(|error| format!("无法读取扩展 manifest：{error}"))?;
    let manifest: ExtensionManifest =
        serde_json::from_str(&source).map_err(|error| format!("扩展 manifest 无效：{error}"))?;
    normalize_version(&manifest.version)
        .ok_or_else(|| format!("扩展 manifest 版本无效：{}", manifest.version))
}

fn replace_extension_atomically(
    source: &Path,
    managed_root: &Path,
    target: &Path,
    expected_version: &str,
) -> Result<(), String> {
    let suffix = unique_suffix();
    let staging = managed_root.join(format!(".extension-staging-{suffix}"));
    let backup = managed_root.join(format!(".extension-backup-{suffix}"));
    if staging.exists() || backup.exists() {
        return Err("扩展更新临时目录冲突，请重试".into());
    }

    let result = (|| {
        copy_extension_tree(source, &staging)?;
        let copied_version = manifest_version(&staging)?;
        if copied_version != expected_version {
            return Err(format!(
                "扩展 staging 版本不一致：期望 {expected_version}，实际 {copied_version}"
            ));
        }

        let had_target = target.exists();
        if had_target {
            fs::rename(target, &backup)
                .map_err(|error| format!("无法备份现有扩展目录：{error}"))?;
        }
        if let Err(error) = fs::rename(&staging, target) {
            if had_target {
                let _ = fs::rename(&backup, target);
            }
            return Err(format!("无法启用新版扩展目录：{error}"));
        }
        if had_target {
            let _ = fs::remove_dir_all(&backup);
        }
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
        if backup.exists() && !target.exists() {
            let _ = fs::rename(&backup, target);
        }
    }
    result
}

fn copy_extension_tree(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.is_dir() {
        return Err(format!("扩展源目录不存在：{}", source.display()));
    }
    fs::create_dir_all(destination)
        .map_err(|error| format!("无法创建扩展 staging：{error}"))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("无法读取扩展源目录：{error}"))?
    {
        let entry = entry.map_err(|error| format!("无法读取扩展源文件：{error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source_path)
            .map_err(|error| format!("无法读取扩展源文件属性：{error}"))?;
        if metadata.file_type().is_symlink() {
            return Err(format!("扩展包不能包含符号链接：{}", source_path.display()));
        }
        if metadata.is_dir() {
            copy_extension_tree(&source_path, &destination_path)?;
        } else if metadata.is_file() {
            fs::copy(&source_path, &destination_path)
                .map_err(|error| format!("复制扩展文件失败：{error}"))?;
        } else {
            return Err(format!("扩展包含不支持的文件类型：{}", source_path.display()));
        }
    }
    Ok(())
}

fn unique_suffix() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("{}-{nanos}", std::process::id())
}

fn open_extension_page() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let candidates = [
            (
                std::env::var_os("PROGRAMFILES")
                    .map(PathBuf::from)
                    .unwrap_or_default()
                    .join("Google/Chrome/Application/chrome.exe"),
                "chrome://extensions/",
            ),
            (
                std::env::var_os("PROGRAMFILES(X86)")
                    .map(PathBuf::from)
                    .unwrap_or_default()
                    .join("Google/Chrome/Application/chrome.exe"),
                "chrome://extensions/",
            ),
            (
                std::env::var_os("LOCALAPPDATA")
                    .map(PathBuf::from)
                    .unwrap_or_default()
                    .join("Google/Chrome/Application/chrome.exe"),
                "chrome://extensions/",
            ),
            (
                std::env::var_os("PROGRAMFILES")
                    .map(PathBuf::from)
                    .unwrap_or_default()
                    .join("Microsoft/Edge/Application/msedge.exe"),
                "edge://extensions/",
            ),
            (
                std::env::var_os("PROGRAMFILES(X86)")
                    .map(PathBuf::from)
                    .unwrap_or_default()
                    .join("Microsoft/Edge/Application/msedge.exe"),
                "edge://extensions/",
            ),
            (
                std::env::var_os("LOCALAPPDATA")
                    .map(PathBuf::from)
                    .unwrap_or_default()
                    .join("Microsoft/Edge/Application/msedge.exe"),
                "edge://extensions/",
            ),
        ];
        for (browser, url) in candidates {
            if !browser.is_file() {
                continue;
            }
            Command::new(browser)
                .arg(url)
                .spawn()
                .map_err(|error| format!("无法打开浏览器扩展页：{error}"))?;
            return Ok(());
        }
        Err("未找到 Chrome 或 Edge，请手动打开扩展管理页".into())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("当前平台暂不支持自动打开扩展管理页".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "qinghua-clipper-{name}-{}-{}",
            std::process::id(),
            unique_suffix()
        ))
    }

    fn write_extension(root: &Path, version: &str) {
        fs::create_dir_all(root.join("icons")).unwrap();
        fs::write(
            root.join("manifest.json"),
            serde_json::json!({
                "manifest_version": 3,
                "version": version,
            })
            .to_string(),
        )
        .unwrap();
        for file in REQUIRED_FILES.iter().skip(1) {
            fs::write(root.join(file), format!("{file}-{version}")).unwrap();
        }
    }

    #[test]
    fn compares_numeric_versions_without_string_ordering() {
        assert!(version_is_newer("0.10.0", "0.9.9"));
        assert!(version_is_newer("1.0", "0.99.99"));
        assert!(!version_is_newer("0.4.1", "0.4.1"));
        assert!(!version_is_newer("0.4.0", "0.4.1"));
        assert!(!version_is_newer("bad", "0.4.1"));
    }

    #[test]
    fn falls_back_to_the_stable_directory_for_legacy_extensions() {
        assert!(extension_needs_update(None, Some("0.4.1"), "0.4.2"));
        assert!(!extension_needs_update(None, Some("0.4.2"), "0.4.2"));
        assert!(extension_needs_update(Some("0.4.1"), Some("0.4.2"), "0.4.2"));
        assert!(!extension_needs_update(Some("0.4.2"), None, "0.4.2"));
        assert!(!extension_needs_update(None, None, "0.4.2"));
    }

    #[test]
    fn clears_reload_wait_only_after_the_reported_version_catches_up() {
        assert!(reported_version_satisfies("0.4.2", "0.4.2"));
        assert!(reported_version_satisfies("0.5.0", "0.4.2"));
        assert!(!reported_version_satisfies("0.4.1", "0.4.2"));
    }

    #[test]
    fn stages_then_replaces_the_managed_extension_directory() {
        let root = temp_root("replace");
        let source = root.join("source");
        let managed = root.join("managed");
        fs::create_dir_all(&managed).unwrap();
        write_extension(&source, "0.5.0");
        write_extension(&managed.join(EXTENSION_DIR_NAME), "0.4.1");

        let target = managed_extension_target(&managed).unwrap();
        replace_extension_atomically(&source, &managed, &target, "0.5.0").unwrap();

        assert_eq!(manifest_version(&target).unwrap(), "0.5.0");
        assert_eq!(
            fs::read_to_string(target.join("background.js")).unwrap(),
            "background.js-0.5.0"
        );
        assert!(!managed
            .read_dir()
            .unwrap()
            .any(|entry| entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".extension-staging-")));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_targets_outside_the_managed_root() {
        let root = temp_root("safety");
        fs::create_dir_all(&root).unwrap();
        let outside = root.parent().unwrap().join("somewhere-else");
        assert!(validate_managed_target(&root, &outside).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_incomplete_source_before_touching_the_target() {
        let root = temp_root("incomplete");
        let source = root.join("source");
        let managed = root.join("managed");
        let target = managed.join(EXTENSION_DIR_NAME);
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(source.join("manifest.json"), r#"{"version":"0.5.0"}"#).unwrap();
        fs::write(target.join("keep.txt"), "keep").unwrap();

        assert!(replace_extension_atomically(
            &source,
            &managed,
            &target,
            "0.5.0",
        )
        .is_err());
        assert_eq!(fs::read_to_string(target.join("keep.txt")).unwrap(), "keep");
        fs::remove_dir_all(root).unwrap();
    }
}
