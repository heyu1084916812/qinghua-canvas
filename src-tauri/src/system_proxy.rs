//! 跟随系统代理（2026-11-12，免 Key 联网方案第 4 条）。
//!
//! 以前 `fetch_text` 的 publicOnly 通道用 `.no_proxy().resolve_to_addrs(...)` 直连，
//! Windows 上 Clash 等工具的「系统代理」模式完全无效（只有 TUN 模式能用）。这里统一读出代理：
//!
//! 1. 环境变量（显式配置优先）：`HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`（大小写均可）
//!    与 `NO_PROXY`；
//! 2. 没有环境变量时，Windows 读当前用户注册表
//!    `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings` 的
//!    `ProxyEnable` / `ProxyServer` / `ProxyOverride`。
//!
//! 只支持 http(s) 代理（reqwest 未开 socks 特性）；PAC（`AutoConfigURL`）与「自动检测设置」不支持。
//! 本机 / 内网字面地址永远直连，避免把本地中转站或内网服务送进代理。

use std::net::IpAddr;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProxySettings {
    /// 访问 `http://` 目标时用的代理地址（`http://host:port`）。
    pub http: Option<String>,
    /// 访问 `https://` 目标时用的代理地址（CONNECT 隧道）。
    pub https: Option<String>,
    /// 绕过列表（已小写、去端口）。
    pub bypass: Vec<String>,
    /// Windows `<local>`：不含点的主机名直连。
    pub bypass_local: bool,
}

impl ProxySettings {
    pub fn is_empty(&self) -> bool {
        self.http.is_none() && self.https.is_none()
    }

    /// 给定目标的协议与主机，返回应走的代理地址；直连时为 `None`。
    pub fn proxy_for(&self, scheme: &str, host: &str) -> Option<&str> {
        let host = host
            .trim_start_matches('[')
            .trim_end_matches(']')
            .trim_end_matches('.')
            .to_ascii_lowercase();
        if host.is_empty() || is_local_host(&host) || self.bypasses(&host) {
            return None;
        }
        match scheme.to_ascii_lowercase().as_str() {
            "https" => self.https.as_deref(),
            "http" => self.http.as_deref(),
            _ => None,
        }
    }

    fn bypasses(&self, host: &str) -> bool {
        if self.bypass_local && !host.contains('.') && host.parse::<IpAddr>().is_err() {
            return true;
        }
        self.bypass
            .iter()
            .any(|pattern| bypass_matches(pattern, host))
    }
}

/// 本机与内网字面地址：永远直连（不论代理配置怎么写）。
fn is_local_host(host: &str) -> bool {
    if host == "localhost" || host.ends_with(".localhost") {
        return true;
    }
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => {
            ip.is_loopback() || ip.is_private() || ip.is_link_local() || ip.is_unspecified()
        }
        Ok(IpAddr::V6(ip)) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || (ip.segments()[0] & 0xfe00) == 0xfc00
                || ip.is_unicast_link_local()
        }
        Err(_) => false,
    }
}

fn glob_matches(pattern: &str, text: &str) -> bool {
    let parts: Vec<&str> = pattern.split('*').collect();
    if parts.len() == 1 {
        return pattern == text;
    }
    let mut rest = text;
    for (index, part) in parts.iter().enumerate() {
        if part.is_empty() {
            continue;
        }
        if index == 0 {
            match rest.strip_prefix(part) {
                Some(tail) => rest = tail,
                None => return false,
            }
        } else if index == parts.len() - 1 {
            return rest.ends_with(part);
        } else {
            match rest.find(part) {
                Some(position) => rest = &rest[position + part.len()..],
                None => return false,
            }
        }
    }
    true
}

fn bypass_matches(pattern: &str, host: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if pattern.contains('*') {
        return glob_matches(pattern, host);
    }
    if let Some(suffix) = pattern.strip_prefix('.') {
        return host == suffix || host.ends_with(pattern);
    }
    host == pattern || host.ends_with(&format!(".{pattern}"))
}

fn strip_pattern_port(pattern: &str) -> &str {
    if pattern.matches(':').count() == 1 {
        if let Some((head, port)) = pattern.rsplit_once(':') {
            if !port.is_empty() && port.chars().all(|c| c.is_ascii_digit()) {
                return head;
            }
        }
    }
    pattern
}

/// 解析绕过列表；`separators` 环境变量用逗号，Windows 用分号。
pub fn parse_bypass_list(raw: &str, separators: &[char]) -> (Vec<String>, bool) {
    let mut patterns = Vec::new();
    let mut local = false;
    for item in raw.split(|c: char| separators.contains(&c)) {
        let item = item.trim().to_ascii_lowercase();
        if item.is_empty() {
            continue;
        }
        if item == "<local>" {
            local = true;
            continue;
        }
        let item = item
            .trim_start_matches("http://")
            .trim_start_matches("https://")
            .trim_end_matches('/');
        let item = strip_pattern_port(item)
            .trim_start_matches('[')
            .trim_end_matches(']');
        if !item.is_empty() && !patterns.iter().any(|existing| existing == item) {
            patterns.push(item.to_string());
        }
    }
    (patterns, local)
}

/// 规范化代理地址：缺协议补 `http://`；socks / 其他协议一律不用（reqwest 未开 socks 特性）。
pub fn normalize_proxy_url(raw: &str) -> Option<String> {
    let raw = raw.trim().trim_end_matches('/');
    if raw.is_empty() {
        return None;
    }
    let lower = raw.to_ascii_lowercase();
    let candidate = if lower.starts_with("http://") || lower.starts_with("https://") {
        raw.to_string()
    } else if lower.contains("://") {
        return None;
    } else {
        format!("http://{raw}")
    };
    let parsed = reqwest::Url::parse(&candidate).ok()?;
    if parsed.host_str().map_or(true, str::is_empty) {
        return None;
    }
    Some(candidate)
}

/// Windows `ProxyServer`：`host:port`（全部协议共用）或 `http=h:p;https=h:p;socks=h:p`。
pub fn parse_windows_proxy_server(server: &str) -> (Option<String>, Option<String>) {
    let server = server.trim();
    if server.is_empty() {
        return (None, None);
    }
    if !server.contains('=') {
        let shared = normalize_proxy_url(server);
        return (shared.clone(), shared);
    }
    let mut http = None;
    let mut https = None;
    for entry in server.split(';') {
        let Some((kind, address)) = entry.split_once('=') else {
            continue;
        };
        match kind.trim().to_ascii_lowercase().as_str() {
            "http" => http = normalize_proxy_url(address),
            "https" => https = normalize_proxy_url(address),
            _ => {}
        }
    }
    (http, https)
}

/// 由 Windows 注册表三个值构造设置；`ProxyEnable` 为 0 时视为未开启。
pub fn from_windows_values(enable: u32, server: &str, override_list: &str) -> ProxySettings {
    if enable == 0 {
        return ProxySettings::default();
    }
    let (http, https) = parse_windows_proxy_server(server);
    if http.is_none() && https.is_none() {
        return ProxySettings::default();
    }
    let (bypass, bypass_local) = parse_bypass_list(override_list, &[';']);
    ProxySettings {
        http,
        https,
        bypass,
        bypass_local,
    }
}

/// 由环境变量构造设置（`get` 便于测试注入）。小写变量优先，与 curl 一致。
pub fn from_env_with(get: impl Fn(&str) -> Option<String>) -> ProxySettings {
    let first = |names: &[&str]| {
        names
            .iter()
            .filter_map(|name| get(name))
            .find_map(|value| normalize_proxy_url(&value))
    };
    let all = first(&["all_proxy", "ALL_PROXY"]);
    let https = first(&["https_proxy", "HTTPS_PROXY"]).or_else(|| all.clone());
    let http = first(&["http_proxy", "HTTP_PROXY"]).or(all);
    if http.is_none() && https.is_none() {
        return ProxySettings::default();
    }
    let no_proxy = get("no_proxy")
        .or_else(|| get("NO_PROXY"))
        .unwrap_or_default();
    let (bypass, _) = parse_bypass_list(&no_proxy, &[',', ' ']);
    ProxySettings {
        http,
        https,
        bypass,
        bypass_local: false,
    }
}

#[cfg(windows)]
mod windows_registry {
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD, RRF_RT_REG_SZ,
    };

    const INTERNET_SETTINGS: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn read_dword(name: &str) -> Option<u32> {
        let key = wide(INTERNET_SETTINGS);
        let value = wide(name);
        let mut data: u32 = 0;
        let mut size = std::mem::size_of::<u32>() as u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                value.as_ptr(),
                RRF_RT_REG_DWORD,
                null_mut(),
                (&mut data as *mut u32).cast(),
                &mut size,
            )
        };
        (status == ERROR_SUCCESS).then_some(data)
    }

    pub fn read_string(name: &str) -> Option<String> {
        let key = wide(INTERNET_SETTINGS);
        let value = wide(name);
        let mut size: u32 = 0;
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                value.as_ptr(),
                RRF_RT_REG_SZ,
                null_mut(),
                null_mut(),
                &mut size,
            )
        };
        if status != ERROR_SUCCESS || size == 0 {
            return None;
        }
        let mut buffer = vec![0u16; (size as usize).div_ceil(2) + 1];
        let mut size = (buffer.len() * 2) as u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                value.as_ptr(),
                RRF_RT_REG_SZ,
                null_mut(),
                buffer.as_mut_ptr().cast(),
                &mut size,
            )
        };
        if status != ERROR_SUCCESS {
            return None;
        }
        let length = buffer
            .iter()
            .position(|&unit| unit == 0)
            .unwrap_or(buffer.len());
        Some(String::from_utf16_lossy(&buffer[..length]))
    }
}

/// Windows 系统代理（当前用户）；其他平台返回空设置。
pub fn from_system() -> ProxySettings {
    #[cfg(windows)]
    {
        let enable = windows_registry::read_dword("ProxyEnable").unwrap_or(0);
        if enable == 0 {
            return ProxySettings::default();
        }
        let server = windows_registry::read_string("ProxyServer").unwrap_or_default();
        let override_list = windows_registry::read_string("ProxyOverride").unwrap_or_default();
        from_windows_values(enable, &server, &override_list)
    }
    #[cfg(not(windows))]
    {
        ProxySettings::default()
    }
}

/// 当前生效的代理：环境变量优先，没有再读系统设置。每次建客户端时读，用户开关代理即时生效。
pub fn current() -> ProxySettings {
    let env = from_env_with(|name| std::env::var(name).ok());
    if !env.is_empty() {
        return env;
    }
    from_system()
}

/// 给非 publicOnly 的通用客户端挂上按目标决定的代理（环境变量 + Windows 系统代理）。
/// 没有任何代理配置时不改动 builder（保持 reqwest 原有行为）。
pub fn apply_to_builder(builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    let settings = current();
    if settings.is_empty() {
        return builder;
    }
    builder.proxy(reqwest::Proxy::custom(move |url: &reqwest::Url| {
        let host = url.host_str()?;
        settings.proxy_for(url.scheme(), host).map(str::to_string)
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn windows_single_server_applies_to_http_and_https() {
        let settings = from_windows_values(1, "127.0.0.1:7890", "");
        assert_eq!(settings.https.as_deref(), Some("http://127.0.0.1:7890"));
        assert_eq!(settings.http.as_deref(), Some("http://127.0.0.1:7890"));
        assert_eq!(
            settings.proxy_for("https", "www.bing.com"),
            Some("http://127.0.0.1:7890")
        );
    }

    #[test]
    fn windows_disabled_or_socks_only_means_direct() {
        assert!(from_windows_values(0, "127.0.0.1:7890", "").is_empty());
        assert!(from_windows_values(1, "socks=127.0.0.1:7891", "").is_empty());
        assert!(from_windows_values(1, "", "").is_empty());
    }

    #[test]
    fn windows_per_protocol_server_list() {
        let (http, https) =
            parse_windows_proxy_server("http=10.0.0.2:8080;https=proxy.corp:8443;socks=x:1080");
        assert_eq!(http.as_deref(), Some("http://10.0.0.2:8080"));
        assert_eq!(https.as_deref(), Some("http://proxy.corp:8443"));
        let (http, https) = parse_windows_proxy_server("https=127.0.0.1:7890");
        assert_eq!(http, None);
        assert_eq!(https.as_deref(), Some("http://127.0.0.1:7890"));
    }

    #[test]
    fn windows_override_list_with_local_and_wildcards() {
        // Clash for Windows 写入的默认绕过列表片段
        let settings = from_windows_values(
            1,
            "127.0.0.1:7890",
            "localhost;127.*;192.168.*;10.*;*.corp.example;<local>",
        );
        assert!(settings.bypass_local);
        assert_eq!(settings.proxy_for("https", "intranet"), None);
        assert_eq!(settings.proxy_for("https", "wiki.corp.example"), None);
        assert_eq!(
            settings.proxy_for("https", "corp.example"),
            Some("http://127.0.0.1:7890")
        );
        assert_eq!(
            settings.proxy_for("https", "www.behance.net"),
            Some("http://127.0.0.1:7890")
        );
    }

    #[test]
    fn local_and_private_literals_always_go_direct() {
        let settings = from_windows_values(1, "127.0.0.1:7890", "");
        for host in [
            "localhost",
            "api.localhost",
            "127.0.0.1",
            "192.168.1.8",
            "10.1.2.3",
            "[::1]",
            "169.254.1.1",
        ] {
            assert_eq!(settings.proxy_for("http", host), None, "{host}");
        }
        assert_eq!(
            settings.proxy_for("http", "8.8.8.8"),
            Some("http://127.0.0.1:7890")
        );
        assert_eq!(settings.proxy_for("ftp", "example.com"), None);
    }

    #[test]
    fn env_proxy_lowercase_wins_and_all_proxy_fills_gaps() {
        let vars: HashMap<&str, &str> = HashMap::from([
            ("HTTPS_PROXY", "http://upper:1"),
            ("https_proxy", "http://lower:2"),
            ("ALL_PROXY", "proxy.all:3"),
            ("NO_PROXY", "example.com, .internal.test,svc:8080"),
        ]);
        let settings = from_env_with(|name| vars.get(name).map(|value| value.to_string()));
        assert_eq!(settings.https.as_deref(), Some("http://lower:2"));
        assert_eq!(settings.http.as_deref(), Some("http://proxy.all:3"));
        assert_eq!(settings.proxy_for("https", "example.com"), None);
        assert_eq!(settings.proxy_for("https", "cdn.example.com"), None);
        assert_eq!(
            settings.proxy_for("https", "notexample.com"),
            Some("http://lower:2")
        );
        assert_eq!(settings.proxy_for("https", "a.internal.test"), None);
        assert_eq!(settings.proxy_for("http", "svc"), None);
    }

    #[test]
    fn env_rejects_socks_and_empty_values() {
        let vars: HashMap<&str, &str> = HashMap::from([
            ("ALL_PROXY", "socks5://127.0.0.1:7891"),
            ("HTTP_PROXY", "  "),
        ]);
        let settings = from_env_with(|name| vars.get(name).map(|value| value.to_string()));
        assert!(settings.is_empty());
        let wildcard = from_env_with(|name| match name {
            "HTTPS_PROXY" => Some("127.0.0.1:7890".into()),
            "NO_PROXY" => Some("*".into()),
            _ => None,
        });
        assert_eq!(wildcard.proxy_for("https", "www.bing.com"), None);
    }

    #[test]
    fn normalizes_proxy_urls() {
        assert_eq!(
            normalize_proxy_url("127.0.0.1:7890").as_deref(),
            Some("http://127.0.0.1:7890")
        );
        assert_eq!(
            normalize_proxy_url("HTTP://Proxy:80/").as_deref(),
            Some("HTTP://Proxy:80")
        );
        assert_eq!(normalize_proxy_url("socks5://h:1"), None);
        assert_eq!(normalize_proxy_url(""), None);
    }

    #[test]
    fn glob_patterns() {
        assert!(glob_matches("*.example.com", "a.example.com"));
        assert!(!glob_matches("*.example.com", "example.com"));
        assert!(glob_matches("192.168.*", "192.168.0.1"));
        assert!(glob_matches("a*c*e", "abcde"));
        assert!(!glob_matches("a*c*e", "abcd"));
    }
}
