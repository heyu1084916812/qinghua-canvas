use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use tiny_http::{Header, Method, Request, Response, StatusCode};

pub const TOKEN_ENV: &str = "QINGHUA_SHARED_STORE_TOKEN";
pub const TOKEN_HEADER: &str = "x-qinghua-token";
static TOKEN_SEQUENCE: AtomicU64 = AtomicU64::new(1);

pub(crate) static AUTH_TOKEN: OnceLock<Option<String>> = OnceLock::new();

pub(crate) fn normalize_token(raw: Option<&str>) -> Option<String> {
    raw.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

pub(crate) fn configured_env_token() -> Option<String> {
    normalize_token(std::env::var(TOKEN_ENV).ok().as_deref())
}

/// 生成 256-bit 随机会话令牌（64 位十六进制），不引入额外 crate。
pub fn generate_session_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};

    let mut out = String::with_capacity(64);
    let pid = std::process::id();
    for round in 0..4u64 {
        let state = RandomState::new();
        let mut hasher = state.build_hasher();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let seq = TOKEN_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        hasher.write_u32(pid);
        hasher.write_u64(round);
        hasher.write_u64(seq);
        hasher.write_u128(nanos);
        out.push_str(&format!("{:016x}", hasher.finish()));
    }
    out
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn token_exempt_path(method: &Method, path: &str) -> bool {
    method == &Method::Get
        && (path == "/health"
            || path.starts_with("/asset/")
            || path.starts_with("/thumb/")
            || path.starts_with("/preview/"))
}

pub(crate) fn token_guard(
    method: &Method,
    path: &str,
    expected: Option<&str>,
    provided: Option<&str>,
) -> Result<(), &'static str> {
    let Some(expected) = expected.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(());
    };
    if token_exempt_path(method, path) {
        return Ok(());
    }
    let provided = provided.map(str::trim).unwrap_or("");
    if !constant_time_eq(provided.as_bytes(), expected.as_bytes()) {
        return Err("unauthorized: missing or invalid shared-store token");
    }
    Ok(())
}

pub(crate) fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("valid header")
}

pub(crate) fn origin_allowed(origin: &str) -> bool {
    matches!(
        origin,
        "http://127.0.0.1:1420"
            | "http://localhost:1420"
            | "http://tauri.localhost"
            | "https://tauri.localhost"
    )
}

/// DNS rebinding 防护：只接受指向回环地址的 Host（端口不限）。
/// 攻击者域名重绑到 127.0.0.1 时，浏览器发来的 Host 仍是攻击者域名，会在这里被拒。
fn host_allowed(host: Option<&str>) -> bool {
    let Some(host) = host.map(str::trim) else {
        // HTTP/1.0 等无 Host 的本机工具请求：浏览器总会带 Host，放行不影响网页侧防护。
        return true;
    };
    let name = if let Some(rest) = host.strip_prefix('[') {
        match rest.split_once(']') {
            Some((inner, _)) => inner,
            None => return false,
        }
    } else {
        host.rsplit_once(':').map(|(name, _)| name).unwrap_or(host)
    };
    matches!(name.to_ascii_lowercase().as_str(), "127.0.0.1" | "localhost" | "::1")
}

/// 跨站请求防护（CSRF）：
/// - 带 Origin 的请求必须来自白名单（应用自身 / 开发服务器）；
/// - 写入类 POST 必须是 `application/json`，迫使浏览器先走预检，
///   而预检只对白名单 Origin 放行，网页无法再用 `text/plain` 简单请求直接写库。
pub(crate) fn request_guard(
    method: &Method,
    host: Option<&str>,
    origin: Option<&str>,
    content_type: Option<&str>,
) -> Result<(), &'static str> {
    if !host_allowed(host) {
        return Err("forbidden host");
    }
    if let Some(origin) = origin {
        if !origin_allowed(origin) {
            return Err("forbidden origin");
        }
    }
    if method == &Method::Post {
        let json = content_type
            .and_then(|value| value.split(';').next())
            .map(|value| value.trim().eq_ignore_ascii_case("application/json"))
            .unwrap_or(false);
        if !json {
            return Err("content-type must be application/json");
        }
    }
    Ok(())
}

pub(crate) fn respond_json(
    request: Request,
    status: StatusCode,
    value: Value,
    origin: Option<&str>,
) -> Result<(), String> {
    let body =
        serde_json::to_string(&value).map_err(|error| format!("serialize response: {error}"))?;
    let mut response = Response::from_string(body)
        .with_status_code(status)
        .with_header(header("content-type", "application/json; charset=utf-8"))
        .with_header(header("cache-control", "no-store"))
        .with_header(header("access-control-allow-methods", "GET,POST,OPTIONS"))
        .with_header(header(
            "access-control-allow-headers",
            "content-type, x-qinghua-token",
        ));
    if let Some(origin) = origin.filter(|origin| origin_allowed(origin)) {
        response = response.with_header(header("access-control-allow-origin", origin));
    }
    request
        .respond(response)
        .map_err(|error| format!("respond: {error}"))
}

pub(crate) fn respond_bytes(
    request: Request,
    status: StatusCode,
    body: Vec<u8>,
    content_type: &str,
    origin: Option<&str>,
) -> Result<(), String> {
    let mut response = Response::from_data(body)
        .with_status_code(status)
        .with_header(header("content-type", content_type))
        .with_header(header(
            "cache-control",
            "public, max-age=31536000, immutable",
        ));
    if let Some(origin) = origin.filter(|origin| origin_allowed(origin)) {
        response = response.with_header(header("access-control-allow-origin", origin));
    }
    request
        .respond(response)
        .map_err(|error| format!("respond: {error}"))
}

#[cfg(test)]
mod request_guard_tests {
    use super::*;

    #[test]
    fn host_must_be_loopback() {
        assert!(host_allowed(Some("127.0.0.1:18765")));
        assert!(host_allowed(Some("localhost:18765")));
        assert!(host_allowed(Some("[::1]:18765")));
        assert!(host_allowed(None));
        assert!(!host_allowed(Some("evil.example.com:18765")));
        assert!(!host_allowed(Some("127.0.0.1.evil.com")));
        assert!(!host_allowed(Some("[::1")));
    }

    #[test]
    fn foreign_origin_is_rejected() {
        let host = Some("127.0.0.1:18765");
        let json = Some("application/json");
        assert!(request_guard(&Method::Get, host, Some("https://evil.example.com"), None).is_err());
        assert!(request_guard(&Method::Post, host, Some("https://evil.example.com"), json).is_err());
        assert!(request_guard(&Method::Post, host, Some("http://tauri.localhost"), json).is_ok());
        assert!(request_guard(&Method::Get, host, None, None).is_ok());
    }

    #[test]
    fn post_requires_json_content_type() {
        let host = Some("127.0.0.1:18765");
        assert!(request_guard(&Method::Post, host, None, Some("text/plain")).is_err());
        assert!(request_guard(&Method::Post, host, None, None).is_err());
        assert!(request_guard(&Method::Post, host, None, Some("application/x-www-form-urlencoded")).is_err());
        assert!(request_guard(&Method::Post, host, None, Some("Application/JSON; charset=utf-8")).is_ok());
    }

    #[test]
    fn token_guard_enforces_session_token_on_data_endpoints() {
        let secret = Some("secret-token-123");
        assert!(token_guard(&Method::Post, "/kv/get", None, None).is_ok());
        assert!(token_guard(&Method::Post, "/kv/get", secret, None).is_err());
        assert!(token_guard(&Method::Post, "/kv/get", secret, Some("wrong")).is_err());
        assert!(token_guard(&Method::Get, "/rows?table=projects", secret, None).is_err());
        assert!(token_guard(&Method::Post, "/kv/get", secret, Some("secret-token-123")).is_ok());
        assert!(token_guard(&Method::Get, "/health", secret, None).is_ok());
        assert!(token_guard(&Method::Get, "/thumb/abc", secret, None).is_ok());
        assert!(token_guard(&Method::Get, "/asset/abc", secret, None).is_ok());
        assert!(token_guard(&Method::Post, "/asset/abc", secret, None).is_err());
    }

    #[test]
    fn generate_session_token_produces_distinct_64_hex_tokens() {
        let a = generate_session_token();
        let b = generate_session_token();
        assert_eq!(a.len(), 64);
        assert_eq!(b.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }
}

