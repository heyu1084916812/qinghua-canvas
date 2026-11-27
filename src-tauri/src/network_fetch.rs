use crate::{base64_decode, base64_encode, system_proxy};
use std::collections::HashSet;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::State;

/// 取一个 URL 的字节（**只给"从网站抓站点图标"用**，对账 #396）。
///
/// 为什么必须放在 Rust 侧：前端那条 `fetch`（浏览器与壳里的 webview 用的是同一份实现，
/// 见 `platform/desktop/index.ts` 的装配注释）受 **CORS** 限制 —— 站点不给
/// `Access-Control-Allow-Origin` 时读不到 `favicon.ico`，而绝大多数站点都不给。
/// 壳里用 reqwest 发这一条就没有这个限制。
///
/// 三条边界：
/// 1. **只做 GET**，只认 http / https；
/// 2. **超过 512KB 直接拒**（站点图标不该这么大，防止被当成下载器用）；
/// 3. 状态码原样回给前端，由前端决定"算不算抓到"（这里不替它判断）。
#[derive(serde::Serialize)]
pub(crate) struct FetchedBytes {
    status: u16,
    content_type: Option<String>,
    bytes: Vec<u8>,
}

#[tauri::command]
pub(crate) async fn fetch_bytes(url: String, timeout_ms: Option<u64>) -> Result<FetchedBytes, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("只支持 http / https 地址".into());
    }
    let client = system_proxy::apply_to_builder(reqwest::Client::builder())
        .timeout(std::time::Duration::from_millis(timeout_ms.unwrap_or(8000)))
        .build()
        .map_err(|err| err.to_string())?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|err| err.to_string())?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let bytes = response.bytes().await.map_err(|err| err.to_string())?;
    if bytes.len() > 512 * 1024 {
        return Err("文件太大（超过 512KB），不像是站点图标".into());
    }
    Ok(FetchedBytes {
        status,
        content_type,
        bytes: bytes.to_vec(),
    })
}

/**
 * **通用 HTTP 请求**（对账 #518）：给"站点不给 CORS 头"的中转站用。
 *
 * 与 `fetch_bytes` 的分工：那个只做 GET、只取字节、有 512KB 上限，服务的是"抓站点图标"；
 * 这一条要能带上自定义头与请求体去打 `/v1/models` / `/v1/chat/completions`，
 * 所以支持 GET / POST / PUT / DELETE / HEAD，返回的是**文本 + 响应头**（渠道层要读 JSON）。
 *
 * 为什么需要它：壳里的 webview 与浏览器是同一份 `fetch` 实现，**同样受 CORS 限制**。
 * 实测（`154.19.242.25:7863`）`/v1/models` 返回 200，但响应头里**没有任何**
 * `access-control-*` ⇒ 页面侧请求被拦下，应用只看到"网络错误"，于是"验证协议"报
 * 「连不上这个地址（域名解析失败或连接被拒绝）」，而真实原因是跨域、不是地址不可达。
 * 别的客户端（cc switch / workbuddy）不走浏览器，所以它们能正常用同一地址。
 *
 * 边界：
 * 1. 只认 http / https；
 * 2. **不跟随重定向以外的魔法**：状态码与响应头原样回给前端，"算不算通过"由渠道层判断；
 * 3. 文本正文上限 8MB；图片 / 视频等二进制上限 64MB。
 *    前者覆盖模型列表与对话回包，后者只服务生成产物回落，不做通用下载器。
 */
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FetchedText {
    status: u16,
    headers: std::collections::HashMap<String, String>,
    text: String,
    body_base64: String,
    final_url: String,
}

#[derive(Default)]
pub(crate) struct FetchStreamCancels(Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FetchStreamEvent {
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

fn emit_stream_text(
    on_event: &Channel<FetchStreamEvent>,
    bytes: &[u8],
    pending: &mut Vec<u8>,
) -> Result<(), String> {
    pending.extend_from_slice(bytes);
    let Some(last_newline) = pending.iter().rposition(|byte| *byte == b'\n') else {
        return Ok(());
    };
    let complete = pending.drain(..=last_newline).collect::<Vec<_>>();
    on_event
        .send(FetchStreamEvent {
            kind: "chunk".into(),
            text: Some(String::from_utf8_lossy(&complete).to_string()),
            status: None,
            message: None,
        })
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub(crate) async fn cancel_fetch_stream(
    stream_id: String,
    state: State<'_, FetchStreamCancels>,
) -> Result<(), String> {
    let cancelled = state
        .0
        .lock()
        .map_err(|_| "流式请求状态锁已损坏".to_string())?
        .get(&stream_id)
        .cloned();
    if let Some(flag) = cancelled {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn fetch_stream(
    stream_id: String,
    url: String,
    method: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
    body: Option<String>,
    timeout_ms: Option<u64>,
    on_event: Channel<FetchStreamEvent>,
    state: State<'_, FetchStreamCancels>,
) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("只支持 http / https 地址".into());
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    state
        .0
        .lock()
        .map_err(|_| "流式请求状态锁已损坏".to_string())?
        .insert(stream_id.clone(), cancelled.clone());

    let client = system_proxy::apply_to_builder(reqwest::Client::builder())
        .timeout(Duration::from_millis(timeout_ms.unwrap_or(180_000)))
        .build()
        .map_err(|err| err.to_string())?;
    let verb = method.unwrap_or_else(|| "POST".into()).to_uppercase();
    let mut req = match verb.as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        other => return Err(format!("流式请求不支持的方法：{other}")),
    };
    if let Some(map) = headers {
        for (key, value) in map {
            req = req.header(key, value);
        }
    }
    if let Some(payload) = body.filter(|value| !value.is_empty()) {
        req = req.body(payload);
    }

    let result = async {
        let mut response = req.send().await.map_err(|err| err.to_string())?;
        let status = response.status().as_u16();
        if !response.status().is_success() {
            let text = response.text().await.unwrap_or_default();
            on_event
                .send(FetchStreamEvent {
                    kind: "error".into(),
                    text: Some(text.chars().take(500).collect()),
                    status: Some(status),
                    message: None,
                })
                .map_err(|err| err.to_string())?;
            return Ok(());
        }

        let mut pending = Vec::<u8>::new();
        loop {
            if cancelled.load(Ordering::Relaxed) {
                return Ok(());
            }
            let next = tokio::select! {
                _ = tokio::time::sleep(Duration::from_millis(100)) => continue,
                next = response.chunk() => next,
            };
            match next {
                Ok(Some(bytes)) => emit_stream_text(&on_event, &bytes, &mut pending)?,
                Ok(None) => break,
                Err(err) => {
                    if cancelled.load(Ordering::Relaxed) {
                        return Ok(());
                    }
                    on_event
                        .send(FetchStreamEvent {
                            kind: "error".into(),
                            text: None,
                            status: None,
                            message: Some(err.to_string()),
                        })
                        .map_err(|err| err.to_string())?;
                    return Ok(());
                }
            }
        }
        if !pending.is_empty() {
            on_event
                .send(FetchStreamEvent {
                    kind: "chunk".into(),
                    text: Some(String::from_utf8_lossy(&pending).to_string()),
                    status: None,
                    message: None,
                })
                .map_err(|err| err.to_string())?;
        }
        on_event
            .send(FetchStreamEvent {
                kind: "done".into(),
                text: None,
                status: None,
                message: None,
            })
            .map_err(|err| err.to_string())
    }
    .await;

    if let Ok(mut map) = state.0.lock() {
        map.remove(&stream_id);
    }
    result
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FetchMultipartPart {
    pub(crate) name: String,
    pub(crate) value: Option<String>,
    pub(crate) data_base64: Option<String>,
    pub(crate) file_name: Option<String>,
    pub(crate) content_type: Option<String>,
}

fn quoted_param(value: &str) -> Result<String, String> {
    if value.contains('\r') || value.contains('\n') {
        return Err("multipart 字段名或文件名不能包含换行".into());
    }
    Ok(value.replace('\\', "\\\\").replace('"', "\\\""))
}

pub(crate) fn multipart_body(parts: Vec<FetchMultipartPart>) -> Result<(String, Vec<u8>), String> {
    static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let sequence = SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let boundary = format!("----qinghua-form-{}-{sequence}", std::process::id());
    let mut out = Vec::new();
    for part in parts {
        out.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        let name = quoted_param(&part.name)?;
        if let Some(data) = part.data_base64.filter(|value| !value.is_empty()) {
            let file_name = quoted_param(
                part.file_name
                    .as_deref()
                    .filter(|value| !value.is_empty())
                    .unwrap_or(&part.name),
            )?;
            out.extend_from_slice(
                format!(
                    "Content-Disposition: form-data; name=\"{name}\"; filename=\"{file_name}\"\r\n"
                )
                .as_bytes(),
            );
            if let Some(content_type) = part.content_type.filter(|value| !value.is_empty()) {
                if content_type.contains('\r') || content_type.contains('\n') {
                    return Err("multipart 文件类型不能包含换行".into());
                }
                out.extend_from_slice(format!("Content-Type: {content_type}\r\n").as_bytes());
            }
            out.extend_from_slice(b"\r\n");
            out.extend_from_slice(&base64_decode(&data)?);
            out.extend_from_slice(b"\r\n");
        } else {
            out.extend_from_slice(
                format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n").as_bytes(),
            );
            out.extend_from_slice(part.value.unwrap_or_default().as_bytes());
            out.extend_from_slice(b"\r\n");
        }
    }
    out.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    Ok((format!("multipart/form-data; boundary={boundary}"), out))
}

fn is_textual_content_type(value: Option<&str>) -> bool {
    let Some(value) = value else {
        return false;
    };
    let lower = value.to_ascii_lowercase();
    lower.starts_with("text/")
        || lower.contains("json")
        || lower.contains("xml")
        || lower.contains("javascript")
        || lower.contains("x-www-form-urlencoded")
}

static CANCELLED_FETCH_TEXTS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn cancelled_fetch_texts() -> &'static Mutex<HashSet<String>> {
    CANCELLED_FETCH_TEXTS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn fetch_text_is_cancelled(request_id: &str) -> bool {
    cancelled_fetch_texts()
        .lock()
        .map(|items| items.contains(request_id))
        .unwrap_or(false)
}

#[tauri::command]
pub(crate) fn cancel_fetch_text(request_id: String) {
    if let Ok(mut items) = cancelled_fetch_texts().lock() {
        items.insert(request_id);
    }
}

struct FetchTextCancelGuard(Option<String>);

impl Drop for FetchTextCancelGuard {
    fn drop(&mut self) {
        if let Some(request_id) = self.0.as_ref() {
            if let Ok(mut items) = cancelled_fetch_texts().lock() {
                items.remove(request_id);
            }
        }
    }
}

async fn wait_for_fetch_cancel(request_id: &str) {
    loop {
        if fetch_text_is_cancelled(request_id) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(80)).await;
    }
}

async fn send_fetch_request(
    request: reqwest::RequestBuilder,
    request_id: Option<&str>,
) -> Result<reqwest::Response, String> {
    if let Some(request_id) = request_id {
        if fetch_text_is_cancelled(request_id) {
            return Err("请求已取消".into());
        }
        tokio::select! {
            result = request.send() => result.map_err(|error| error.to_string()),
            _ = wait_for_fetch_cancel(request_id) => Err("请求已取消".into()),
        }
    } else {
        request.send().await.map_err(|error| error.to_string())
    }
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(value) => {
            let octets = value.octets();
            let shared = octets[0] == 100 && (64..=127).contains(&octets[1]);
            let reserved = octets[0] >= 240;
            !(octets[0] == 0
                || value.is_unspecified()
                || value.is_private()
                || value.is_loopback()
                || value.is_link_local()
                || value.is_broadcast()
                || value.is_documentation()
                || value.is_multicast()
                || shared
                || reserved
                || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19))
                || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0))
        }
        IpAddr::V6(value) => {
            if let Some(mapped) = value.to_ipv4_mapped() {
                return is_public_ip(IpAddr::V4(mapped));
            }
            let first = value.segments()[0];
            !(value.is_unspecified()
                || value.is_loopback()
                || value.is_multicast()
                || value.is_unicast_link_local()
                || (first == 0x2001 && value.segments()[1] == 0x0db8)
                || (first & 0xfe00) == 0xfc00)
        }
    }
}

/// Clash / Surge 等代理的 fake-ip 段（RFC 2544 基准测试段 198.18.0.0/15）。
/// 本地 DNS 被代理接管时，公网域名会解析成这里的地址；只有**走代理**时才放行，
/// 因为真正的连接由代理按主机名建立，本机不会直连这个地址。
fn is_proxy_fake_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(value) => {
            let octets = value.octets();
            octets[0] == 198 && (octets[1] == 18 || octets[1] == 19)
        }
        IpAddr::V6(value) => value
            .to_ipv4_mapped()
            .is_some_and(|mapped| is_proxy_fake_ip(IpAddr::V4(mapped))),
    }
}

/// 公网校验通过的一跳目标。
struct PublicTarget {
    host: String,
    addresses: Vec<SocketAddr>,
    /// 按系统 / 环境代理设置，这一跳应走的代理；`None` 为直连（DNS 钉死到 `addresses`）。
    proxy: Option<String>,
}

/**
 * publicOnly 的每一跳校验（对账：免 Key 联网 · 跟随系统代理）。
 *
 * - 直连：本机解析 DNS，所有地址必须是公网，然后 `resolve_to_addrs` 把连接钉死在这些地址上，
 *   杜绝「校验时公网、连接时内网」的 DNS rebinding。
 * - 走代理：仍然先在本机解析并要求公网（fake-ip 段除外），但连接由代理按主机名完成，
 *   **无法钉死 DNS**——代理端解析结果理论上可能与本机不同。这是跟随系统代理的已知取舍：
 *   字面 IP、localhost、内网后缀和本机解析到内网的域名照旧拒绝；本机与内网字面地址
 *   永远不走代理（见 `system_proxy::ProxySettings::proxy_for`）。
 */
async fn validate_public_url(
    raw: &str,
    proxies: &system_proxy::ProxySettings,
) -> Result<PublicTarget, String> {
    let parsed = reqwest::Url::parse(raw).map_err(|error| error.to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("只支持 http / https 地址".into());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "地址缺少主机名".to_string())?
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if host.is_empty()
        || host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host.ends_with(".home.arpa")
    {
        return Err("设计调研只允许公开互联网地址".into());
    }
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| "无法确定目标端口".to_string())?;
    let proxy = proxies.proxy_for(parsed.scheme(), &host).map(str::to_string);
    if let Ok(ip) = host.parse::<IpAddr>() {
        return if is_public_ip(ip) {
            Ok(PublicTarget {
                host,
                addresses: vec![SocketAddr::new(ip, port)],
                proxy,
            })
        } else {
            Err("设计调研拒绝本机、内网或链路本地地址".into())
        };
    }
    let lookup_host = host.clone();
    let addresses = tauri::async_runtime::spawn_blocking(move || {
        (lookup_host.as_str(), port)
            .to_socket_addrs()
            .map(|items| items.collect::<Vec<_>>())
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?;
    if addresses.is_empty() {
        return Err("目标域名没有解析到地址".into());
    }
    if !resolved_addresses_allowed(&addresses, proxy.is_some()) {
        return Err("目标域名解析到了本机、内网或链路本地地址".into());
    }
    Ok(PublicTarget {
        host,
        addresses,
        proxy,
    })
}

/// 解析结果是否可用：全部公网；走代理时额外容忍代理 fake-ip 段。
fn resolved_addresses_allowed(addresses: &[SocketAddr], proxied: bool) -> bool {
    !addresses.is_empty()
        && addresses
            .iter()
            .all(|address| is_public_ip(address.ip()) || (proxied && is_proxy_fake_ip(address.ip())))
}

#[tauri::command]
pub(crate) async fn fetch_text(
    url: String,
    method: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
    body: Option<String>,
    body_base64: Option<String>,
    content_type: Option<String>,
    multipart: Option<Vec<FetchMultipartPart>>,
    timeout_ms: Option<u64>,
    public_only: Option<bool>,
    max_response_bytes: Option<u64>,
    request_id: Option<String>,
) -> Result<FetchedText, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("只支持 http / https 地址".into());
    }
    let verb = method.unwrap_or_else(|| "GET".into()).to_uppercase();
    let _cancel_guard = FetchTextCancelGuard(request_id.clone());
    if request_id.as_deref().is_some_and(fetch_text_is_cancelled) {
        return Err("请求已取消".into());
    }
    let public_only = public_only.unwrap_or(false);
    if public_only && verb != "GET" && verb != "HEAD" {
        return Err("公开互联网请求只允许 GET / HEAD".into());
    }
    if public_only {
        // 每次请求读一次代理设置（环境变量优先，其次 Windows 系统代理），用户开关代理即时生效。
        let proxies = system_proxy::current();
        let mut current = url.clone();
        let mut response = None;
        for _ in 0..=5 {
            let target = if let Some(request_id) = request_id.as_deref() {
                tokio::select! {
                    resolved = validate_public_url(&current, &proxies) => resolved?,
                    _ = wait_for_fetch_cancel(request_id) => return Err("请求已取消".into()),
                }
            } else {
                validate_public_url(&current, &proxies).await?
            };
            let builder = reqwest::Client::builder()
                .timeout(std::time::Duration::from_millis(
                    timeout_ms.unwrap_or(10000),
                ))
                .redirect(reqwest::redirect::Policy::none());
            let builder = match target.proxy.as_deref() {
                Some(proxy_url) => builder.proxy(
                    reqwest::Proxy::all(proxy_url).map_err(|err| format!("代理地址无效：{err}"))?,
                ),
                None => builder
                    .no_proxy()
                    .resolve_to_addrs(&target.host, &target.addresses),
            };
            let hop_client = builder.build().map_err(|err| err.to_string())?;
            let mut request = if verb == "HEAD" {
                hop_client.head(&current)
            } else {
                hop_client.get(&current)
            };
            if let Some(map) = headers.as_ref() {
                for (key, value) in map {
                    request = request.header(key, value);
                }
            }
            let next = send_fetch_request(request, request_id.as_deref()).await?;
            if next.status().is_redirection() {
                let location = next
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|value| value.to_str().ok())
                    .ok_or_else(|| "公开页面重定向缺少 Location".to_string())?;
                let base = reqwest::Url::parse(&current).map_err(|err| err.to_string())?;
                current = base
                    .join(location)
                    .map_err(|err| err.to_string())?
                    .to_string();
                continue;
            }
            response = Some(next);
            break;
        }
        let response = response.ok_or_else(|| "公开页面重定向次数过多".to_string())?;
        return collect_fetched_text(response, max_response_bytes, request_id.as_deref()).await;
    }

    let client = system_proxy::apply_to_builder(reqwest::Client::builder())
        .timeout(std::time::Duration::from_millis(
            timeout_ms.unwrap_or(10000),
        ))
        .build()
        .map_err(|err| err.to_string())?;

    let mut req = match verb.as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        "HEAD" => client.head(&url),
        other => return Err(format!("不支持的请求方法：{other}")),
    };
    let has_multipart = multipart.as_ref().is_some_and(|parts| !parts.is_empty());
    let has_binary_body = body_base64.as_ref().is_some_and(|value| !value.is_empty());
    if let Some(map) = headers {
        for (k, v) in map {
            if (has_multipart || has_binary_body) && k.eq_ignore_ascii_case("content-type") {
                continue;
            }
            req = req.header(k, v);
        }
    }
    if has_multipart {
        let (content_type, payload) = multipart_body(multipart.unwrap_or_default())?;
        req = req.header("content-type", content_type).body(payload);
    } else if let Some(payload) = body_base64.filter(|value| !value.is_empty()) {
        if let Some(content_type) = content_type.filter(|value| !value.is_empty()) {
            req = req.header("content-type", content_type);
        }
        req = req.body(base64_decode(&payload)?);
    } else if let Some(payload) = body {
        if !payload.is_empty() {
            req = req.body(payload);
        }
    }

    let response = send_fetch_request(req, request_id.as_deref()).await?;
    collect_fetched_text(response, max_response_bytes, request_id.as_deref()).await
}

async fn collect_fetched_text(
    mut response: reqwest::Response,
    max_response_bytes: Option<u64>,
    request_id: Option<&str>,
) -> Result<FetchedText, String> {
    let status = response.status().as_u16();
    let mut out_headers = std::collections::HashMap::new();
    for (name, value) in response.headers().iter() {
        if let Ok(v) = value.to_str() {
            out_headers.insert(name.as_str().to_string(), v.to_string());
        }
    }
    let content_type = out_headers
        .get("content-type")
        .cloned()
        .or_else(|| out_headers.get("Content-Type").cloned());
    let textual = is_textual_content_type(content_type.as_deref());
    let hard_limit = if textual {
        8 * 1024 * 1024
    } else {
        64 * 1024 * 1024
    };
    let limit = max_response_bytes
        .map(|value| (value as usize).min(hard_limit))
        .unwrap_or(hard_limit);
    let mut bytes = Vec::new();
    loop {
        let chunk = if let Some(request_id) = request_id {
            tokio::select! {
                chunk = response.chunk() => chunk.map_err(|error| error.to_string())?,
                _ = wait_for_fetch_cancel(request_id) => return Err("请求已取消".into()),
            }
        } else {
            response.chunk().await.map_err(|err| err.to_string())?
        };
        let Some(chunk) = chunk else { break };
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err(if textual {
                format!("响应太大（文本上限 {} bytes）", limit)
            } else {
                format!("响应太大（二进制上限 {} bytes）", limit)
            });
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.len() > hard_limit {
        return Err(if textual {
            "响应太大（文本超过 8MB）".into()
        } else {
            "响应太大（二进制超过 64MB）".into()
        });
    }
    Ok(FetchedText {
        status,
        headers: out_headers,
        final_url: response.url().to_string(),
        // 文本响应完整解码；二进制只留前 64KB 供 HTTP 错误文案使用，
        // 不把几十 MB 的图片再复制成一份无意义字符串。
        text: if textual {
            String::from_utf8_lossy(&bytes).to_string()
        } else {
            String::from_utf8_lossy(&bytes[..bytes.len().min(64 * 1024)]).to_string()
        },
        // 文本响应不额外复制一份 base64；图片 / 视频等二进制必须走原始字节。
        // 0x89 在 text 里会变成 U+FFFD，永远不能从 text 反推文件内容。
        body_base64: if textual {
            String::new()
        } else {
            base64_encode(&bytes)
        },
    })
}

/**
 * `fetch_text` 的输入校验（对账 #518）。
 *
 * 这几条锁的是**没发请求就该拒**的那部分：地址协议与方法白名单。
 * 真打真实站点的用例不写在这里 —— 单测不该依赖外网（本机到 Google 域就常年不通）。
 */
#[cfg(test)]
mod fetch_text_tests {
    use super::{
        cancel_fetch_text, fetch_text_is_cancelled, is_proxy_fake_ip, is_public_ip,
        resolved_addresses_allowed, validate_public_url, FetchTextCancelGuard,
    };
    use crate::system_proxy::{from_windows_values, ProxySettings};
    use std::net::{IpAddr, SocketAddr};

    fn addr(value: &str) -> SocketAddr {
        SocketAddr::new(value.parse().unwrap(), 443)
    }

    #[test]
    fn proxied_targets_tolerate_fake_ip_but_never_private_ranges() {
        let fake = [addr("198.18.0.7")];
        let public = [addr("8.8.8.8")];
        let private = [addr("8.8.8.8"), addr("192.168.1.2")];
        assert!(is_proxy_fake_ip("198.19.255.1".parse().unwrap()));
        assert!(!is_proxy_fake_ip("198.20.0.1".parse().unwrap()));
        assert!(resolved_addresses_allowed(&public, false));
        assert!(!resolved_addresses_allowed(&fake, false));
        assert!(resolved_addresses_allowed(&fake, true));
        assert!(!resolved_addresses_allowed(&private, true));
        assert!(!resolved_addresses_allowed(&[], true));
    }

    #[test]
    fn public_url_validation_keeps_rejecting_local_targets_when_proxied() {
        let proxies = from_windows_values(1, "127.0.0.1:7890", "");
        let block_on = |raw: &str| tauri::async_runtime::block_on(validate_public_url(raw, &proxies));
        for raw in [
            "http://127.0.0.1:18765/state",
            "http://localhost/x",
            "http://printer.local/",
            "http://10.0.0.1/",
            "http://[::1]/",
        ] {
            assert!(block_on(raw).is_err(), "{raw}");
        }
        let target = block_on("https://8.8.8.8/dns-query").expect("public literal");
        assert_eq!(target.proxy.as_deref(), Some("http://127.0.0.1:7890"));
        let direct = tauri::async_runtime::block_on(validate_public_url(
            "https://8.8.8.8/dns-query",
            &ProxySettings::default(),
        ))
        .expect("public literal");
        assert_eq!(direct.proxy, None);
        assert_eq!(direct.addresses, vec![SocketAddr::new("8.8.8.8".parse().unwrap(), 443)]);
    }

    #[test]
    fn public_only_ip_guard_rejects_local_and_private_ranges() {
        let public: IpAddr = "8.8.8.8".parse().unwrap();
        let private: IpAddr = "192.168.1.20".parse().unwrap();
        let loopback: IpAddr = "127.0.0.1".parse().unwrap();
        let link_local: IpAddr = "169.254.169.254".parse().unwrap();
        let mapped: IpAddr = "::ffff:7f00:1".parse().unwrap();
        let zero_network: IpAddr = "0.1.2.3".parse().unwrap();
        let shared: IpAddr = "100.64.0.1".parse().unwrap();
        let benchmark: IpAddr = "198.18.0.1".parse().unwrap();

        assert!(is_public_ip(public));
        assert!(!is_public_ip(private));
        assert!(!is_public_ip(loopback));
        assert!(!is_public_ip(link_local));
        assert!(!is_public_ip(mapped));
        assert!(!is_public_ip(zero_network));
        assert!(!is_public_ip(shared));
        assert!(!is_public_ip(benchmark));
    }

    #[test]
    fn fetch_text_cancel_guard_clears_the_request_id() {
        let id = "cancel-test-request".to_string();
        cancel_fetch_text(id.clone());
        assert!(fetch_text_is_cancelled(&id));
        {
            let _guard = FetchTextCancelGuard(Some(id.clone()));
        }
        assert!(!fetch_text_is_cancelled(&id));
    }

    #[test]
    fn rejects_non_http_url() {
        assert!(!"ftp://x/y".starts_with("http://") && !"ftp://x/y".starts_with("https://"));
        assert!("http://a/b".starts_with("http://"));
        assert!("https://a/b".starts_with("https://"));
    }

    #[test]
    fn method_allowlist_is_exactly_five() {
        // 与 `fetch_text` 里 match 的分支逐字一致：加/改方法时必须同时改这里
        for m in ["GET", "POST", "PUT", "DELETE", "HEAD"] {
            assert!(matches!(m, "GET" | "POST" | "PUT" | "DELETE" | "HEAD"));
        }
        assert!(!matches!(
            "PATCH",
            "GET" | "POST" | "PUT" | "DELETE" | "HEAD"
        ));
    }

    #[test]
    fn content_type_splits_text_from_binary() {
        assert!(super::is_textual_content_type(Some(
            "application/json; charset=utf-8"
        )));
        assert!(super::is_textual_content_type(Some("text/event-stream")));
        assert!(!super::is_textual_content_type(Some("image/png")));
        assert!(!super::is_textual_content_type(Some("video/mp4")));
        assert!(!super::is_textual_content_type(None));
    }
}
