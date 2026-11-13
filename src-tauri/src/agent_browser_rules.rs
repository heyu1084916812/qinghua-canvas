//! Agent 后台浏览器（隐藏 WebviewWindow）的纯规则，不依赖 tauri，方便 `rustc --test` 单测。
//!
//! - 窗口 label 是 `agent-browser-<id>`，id 与画布浏览器视图同一套字符集 `[a-z0-9-]{1,32}`；
//! - 等待 / 滚动 / 沉降时间一律夹到安全范围：前端传错数也不会让命令挂一分钟以上；
//! - `eval_with_callback` 的回调拿到的是**JSON 序列化后的结果**：脚本返回字符串时
//!   回调里是带引号的 JSON 字符串，这里只解码页面就绪探针那种不含转义的短字符串。

use crate::browser_view_rules::is_view_id;

pub const AGENT_LABEL_PREFIX: &str = "agent-browser-";
pub const AGENT_EVENT_NAME: &str = "agent-browser:event";

pub fn agent_label(id: &str) -> Result<String, String> {
    if is_view_id(id) {
        Ok(format!("{AGENT_LABEL_PREFIX}{id}"))
    } else {
        Err(format!("无效的 Agent 浏览器 id：{id}"))
    }
}

pub fn agent_id_of_label(label: &str) -> Option<&str> {
    label.strip_prefix(AGENT_LABEL_PREFIX).filter(|id| is_view_id(id))
}

/// 一次「打开并提取」的时间参数（毫秒 / 次数），已夹到安全范围。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LoadTiming {
    /// 等页面加载完成的总时限。
    pub timeout_ms: u64,
    /// 滚动结束后再等多久（懒加载图片）。
    pub settle_ms: u64,
    /// 向下滚动几屏。
    pub scroll_steps: u32,
}

pub const DEFAULT_TIMEOUT_MS: u64 = 25_000;
pub const DEFAULT_SETTLE_MS: u64 = 1_200;
pub const DEFAULT_SCROLL_STEPS: u32 = 3;

pub fn clamp_timing(timeout_ms: Option<u64>, settle_ms: Option<u64>, scroll_steps: Option<u32>) -> LoadTiming {
    LoadTiming {
        timeout_ms: timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).clamp(3_000, 60_000),
        settle_ms: settle_ms.unwrap_or(DEFAULT_SETTLE_MS).clamp(0, 5_000),
        scroll_steps: scroll_steps.unwrap_or(DEFAULT_SCROLL_STEPS).min(8),
    }
}

/// 解码不含转义的 JSON 字符串字面量（`"complete|1"` → `complete|1`）。
pub fn unquote_simple(raw: &str) -> Option<&str> {
    let inner = raw.trim().strip_prefix('"')?.strip_suffix('"')?;
    if inner.contains('\\') || inner.contains('"') {
        return None;
    }
    Some(inner)
}

/// 页面就绪探针脚本：返回 `"<readyState>|<1 = 仍是导航前的旧文档>"`。
/// 导航前在旧文档上写入 `window.__qhAgentNav = <nonce>`；新文档没有这个标记。
pub fn ready_probe_script(nonce: u64) -> String {
    format!(
        "(function(){{try{{return String(document.readyState)+'|'+(window.__qhAgentNav==={nonce}?'1':'0')}}catch(e){{return 'error|0'}}}})()"
    )
}

pub fn mark_script(nonce: u64) -> String {
    format!("try{{window.__qhAgentNav={nonce}}}catch(e){{}}")
}

/// 探针结果是否表示「新文档已加载完成」。
pub fn is_ready(probe: &str) -> bool {
    matches!(unquote_simple(probe), Some("complete|0"))
}

/// 往下滚一屏（懒加载 / 无限滚动的站点需要）；最后一步回到顶部，不影响结果顺序。
pub fn scroll_script(last: bool) -> &'static str {
    if last {
        "try{window.scrollTo(0,0)}catch(e){}"
    } else {
        "try{window.scrollBy(0,Math.max(400,window.innerHeight*0.9))}catch(e){}"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels() {
        assert_eq!(agent_label("dribbble").unwrap(), "agent-browser-dribbble");
        assert!(agent_label("Dribbble").is_err());
        assert!(agent_label("../x").is_err());
        assert_eq!(agent_id_of_label("agent-browser-pinterest"), Some("pinterest"));
        assert_eq!(agent_id_of_label("browser-view-canvas"), None);
        assert_eq!(agent_id_of_label("main"), None);
    }

    #[test]
    fn timing_is_clamped() {
        let t = clamp_timing(None, None, None);
        assert_eq!(t, LoadTiming { timeout_ms: 25_000, settle_ms: 1_200, scroll_steps: 3 });
        let t = clamp_timing(Some(1), Some(99_999), Some(99));
        assert_eq!(t, LoadTiming { timeout_ms: 3_000, settle_ms: 5_000, scroll_steps: 8 });
        assert_eq!(clamp_timing(Some(999_999), None, None).timeout_ms, 60_000);
    }

    #[test]
    fn probe_parsing() {
        assert_eq!(unquote_simple("\"complete|0\""), Some("complete|0"));
        assert_eq!(unquote_simple(" \"a\" "), Some("a"));
        assert_eq!(unquote_simple("complete|0"), None);
        assert_eq!(unquote_simple("\"a\\\"b\""), None);
        assert!(is_ready("\"complete|0\""));
        assert!(!is_ready("\"complete|1\""));
        assert!(!is_ready("\"interactive|0\""));
        assert!(!is_ready(""));
        assert!(ready_probe_script(42).contains("__qhAgentNav===42"));
        assert!(mark_script(42).contains("__qhAgentNav=42"));
    }
}
