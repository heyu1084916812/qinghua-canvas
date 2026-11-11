//! 素材目录的 fs 作用域授权台账。
//!
//! `grant_folder` 以前对前端传来的**任意**路径递归放开 fs 作用域，等于绕过了
//! "只有用户在系统对话框里选过的目录才能读写"这条边界：页面里一旦出现脚本注入，
//! 就能把整个用户目录甚至系统盘加进作用域再读写。
//!
//! 现在的规则：
//! 1. 对话框选中的目录写进台账（`granted-folders.json`），重启后只允许重新授权台账里的目录；
//! 2. 台账文件还不存在时（升级前就选过目录的老用户）放行一次并记账，之后按台账走；
//! 3. 无论如何不授权盘符根目录、用户主目录本身和系统目录。

use std::path::{Path, PathBuf};

pub const LEDGER_FILE: &str = "granted-folders.json";

fn normalize(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    let trimmed = text.trim_end_matches('/');
    let value = if trimmed.is_empty() { "/" } else { trimmed };
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value.to_string()
    }
}

/// 盘符根、用户主目录本身、系统目录（及其子目录）一律不授权。
pub fn is_sensitive_dir(path: &Path, home: Option<&Path>, system_dirs: &[PathBuf]) -> bool {
    if path.parent().is_none() {
        return true;
    }
    let target = normalize(path);
    // Windows 盘符根（`C:`、`C:/`）
    if target.len() <= 3 && target.chars().nth(1) == Some(':') {
        return true;
    }
    if let Some(home) = home {
        if target == normalize(home) {
            return true;
        }
    }
    system_dirs.iter().any(|dir| {
        let dir = normalize(dir);
        target == dir || target.starts_with(&format!("{dir}/"))
    })
}

pub fn system_dirs_from_env() -> Vec<PathBuf> {
    ["SystemRoot", "windir", "ProgramFiles", "ProgramFiles(x86)", "ProgramData"]
        .iter()
        .filter_map(|key| std::env::var_os(key))
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .collect()
}

pub fn home_dir_from_env() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// 台账：`None` = 文件不存在（老用户首次升级）；`Some(list)` = 已有台账。
pub fn read_ledger(file: &Path) -> Option<Vec<String>> {
    let raw = std::fs::read_to_string(file).ok()?;
    Some(serde_json::from_str::<Vec<String>>(&raw).unwrap_or_default())
}

pub fn remember(file: &Path, dir: &Path) -> Result<(), String> {
    let mut list = read_ledger(file).unwrap_or_default();
    let key = normalize(dir);
    if !list.iter().any(|item| normalize(Path::new(item)) == key) {
        list.push(dir.to_string_lossy().to_string());
    }
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("create ledger dir: {error}"))?;
    }
    let body = serde_json::to_vec_pretty(&list).map_err(|error| error.to_string())?;
    std::fs::write(file, body).map_err(|error| format!("write ledger: {error}"))
}

#[derive(Debug, PartialEq, Eq)]
pub enum GrantDecision {
    /// 台账里有：直接重新授权
    Known,
    /// 台账文件还不存在：老用户迁移，放行并记账
    Migrate,
    Deny,
}

pub fn decide(
    ledger: Option<&[String]>,
    dir: &Path,
    home: Option<&Path>,
    system_dirs: &[PathBuf],
) -> GrantDecision {
    if is_sensitive_dir(dir, home, system_dirs) {
        return GrantDecision::Deny;
    }
    match ledger {
        None => GrantDecision::Migrate,
        Some(list) => {
            let key = normalize(dir);
            if list.iter().any(|item| normalize(Path::new(item)) == key) {
                GrantDecision::Known
            } else {
                GrantDecision::Deny
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sys() -> Vec<PathBuf> {
        vec![PathBuf::from("/sys-root/Windows"), PathBuf::from("/sys-root/Program Files")]
    }

    #[test]
    fn sensitive_dirs_are_never_granted() {
        let home = PathBuf::from("/home/u");
        assert!(is_sensitive_dir(Path::new("/"), Some(&home), &sys()));
        assert!(is_sensitive_dir(Path::new("/home/u"), Some(&home), &sys()));
        assert!(is_sensitive_dir(Path::new("/home/u/"), Some(&home), &sys()));
        assert!(is_sensitive_dir(Path::new("/sys-root/Windows/System32"), Some(&home), &sys()));
        assert!(!is_sensitive_dir(Path::new("/home/u/Pictures/assets"), Some(&home), &sys()));
        assert!(!is_sensitive_dir(Path::new("/sys-root/WindowsApps2"), Some(&home), &sys()));
    }

    #[test]
    fn ledger_controls_regrant() {
        let home = PathBuf::from("/home/u");
        let dir = Path::new("/home/u/assets");
        assert_eq!(decide(None, dir, Some(&home), &sys()), GrantDecision::Migrate);
        let list = vec!["/home/u/assets".to_string()];
        assert_eq!(decide(Some(&list), dir, Some(&home), &sys()), GrantDecision::Known);
        assert_eq!(
            decide(Some(&list), Path::new("/home/u/.ssh"), Some(&home), &sys()),
            GrantDecision::Deny
        );
        assert_eq!(decide(None, Path::new("/home/u"), Some(&home), &sys()), GrantDecision::Deny);
    }

    #[test]
    fn remember_writes_and_dedupes() {
        let dir = std::env::temp_dir().join(format!("qh-grants-{}", std::process::id()));
        let file = dir.join(LEDGER_FILE);
        let _ = std::fs::remove_dir_all(&dir);
        assert!(read_ledger(&file).is_none());
        remember(&file, Path::new("/a/b")).unwrap();
        remember(&file, Path::new("/a/b/")).unwrap();
        assert_eq!(read_ledger(&file).unwrap(), vec!["/a/b".to_string()]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
