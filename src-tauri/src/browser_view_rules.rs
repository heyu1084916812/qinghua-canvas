//! 原生网页视图（画布浏览器 / Agent 浏览器）的纯规则，不依赖 tauri，方便单测。
//!
//! - 视图 id 只允许 `[a-z0-9-]{1,32}`，最终 webview label 是 `browser-view-<id>`；
//! - 只放行公开的 http / https 地址：前端已经校验过一遍，这里是第二道门 ——
//!   这个视图与 Agent 共用一份登录目录，绝不能被拿去打开 `file:`、自定义协议、
//!   本机或内网地址。

pub const LABEL_PREFIX: &str = "browser-view-";
pub const EVENT_NAME: &str = "browser-view:event";
pub const PROFILE_DIR: &str = "browser-profile";

pub fn is_view_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 32
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

pub fn view_label(id: &str) -> Result<String, String> {
    if is_view_id(id) {
        Ok(format!("{LABEL_PREFIX}{id}"))
    } else {
        Err(format!("无效的浏览器视图 id：{id}"))
    }
}

pub fn view_id_of_label(label: &str) -> Option<&str> {
    label.strip_prefix(LABEL_PREFIX).filter(|id| is_view_id(id))
}

fn is_private_v4(octets: [u8; 4]) -> bool {
    let [a, b, c, _] = octets;
    a == 0
        || a == 10
        || a == 127
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 168)
        || (a == 100 && (64..=127).contains(&b))
        || a >= 224
        || (a == 198 && (b == 18 || b == 19))
        || (a == 192 && b == 0 && (c == 0 || c == 2))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
}

fn parse_v4(host: &str) -> Option<[u8; 4]> {
    let parts: Vec<&str> = host.split('.').collect();
    if parts.len() != 4 {
        return None;
    }
    let mut out = [0u8; 4];
    for (i, part) in parts.iter().enumerate() {
        if part.is_empty() || part.len() > 3 || !part.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        out[i] = part.parse::<u16>().ok().filter(|v| *v <= 255)? as u8;
    }
    Some(out)
}

/// 主机名是否是公开地址（不做 DNS 解析：只挡字面量上就能认出来的本机 / 内网）。
pub fn is_public_host(host: &str) -> bool {
    let host = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if host.is_empty()
        || host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host.ends_with(".home.arpa")
    {
        return false;
    }
    if let Some(v4) = parse_v4(&host) {
        return !is_private_v4(v4);
    }
    if host.contains(':') {
        if host == "::1" || host == "::" {
            return false;
        }
        if host.starts_with("fc")
            || host.starts_with("fd")
            || host.starts_with("fe80:")
            || host.starts_with("2001:db8:")
            || host.starts_with("::ffff:")
        {
            return false;
        }
    }
    true
}

/// 允许原生视图打开 / 跳转到的地址：公开的 http(s)。`about:blank` 也放行（页面自身会用到）。
pub fn is_allowed_navigation(scheme: &str, host: Option<&str>) -> bool {
    match scheme {
        "about" => true,
        "http" | "https" => host.map(is_public_host).unwrap_or(false),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn view_ids() {
        assert!(is_view_id("canvas"));
        assert!(is_view_id("agent-1"));
        assert!(!is_view_id(""));
        assert!(!is_view_id("Canvas"));
        assert!(!is_view_id("a/b"));
        assert!(!is_view_id(&"a".repeat(33)));
        assert_eq!(view_label("canvas").unwrap(), "browser-view-canvas");
        assert!(view_label("../x").is_err());
        assert_eq!(view_id_of_label("browser-view-canvas"), Some("canvas"));
        assert_eq!(view_id_of_label("main"), None);
    }

    #[test]
    fn public_hosts() {
        assert!(is_public_host("dribbble.com"));
        assert!(is_public_host("8.8.8.8"));
        assert!(is_public_host("2606:4700::1111"));
        for host in [
            "localhost",
            "tauri.localhost",
            "127.0.0.1",
            "10.0.0.1",
            "192.168.1.5",
            "172.16.0.1",
            "169.254.1.1",
            "[::1]",
            "fd00::1",
            "nas.local",
            "",
        ] {
            assert!(!is_public_host(host), "{host}");
        }
    }

    #[test]
    fn navigation_schemes() {
        assert!(is_allowed_navigation("https", Some("huaban.com")));
        assert!(is_allowed_navigation("http", Some("zcool.com.cn")));
        assert!(is_allowed_navigation("about", None));
        assert!(!is_allowed_navigation("https", Some("127.0.0.1")));
        assert!(!is_allowed_navigation("file", None));
        assert!(!is_allowed_navigation("tauri", Some("localhost")));
        assert!(!is_allowed_navigation("javascript", None));
        assert!(!is_allowed_navigation("https", None));
    }
}
