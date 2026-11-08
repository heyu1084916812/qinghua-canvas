use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

const DEFAULT_PORT: u16 = 18766;
const RELEASE_GATE_PORT: u16 = 18768;
const PORT_ENV: &str = "QINGHUA_CANVAS_GATEWAY_PORT";
const RELEASE_GATE_ENV: &str = "QINGHUA_RELEASE_GATE";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_LOG_ENTRIES: usize = 200;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GatewayRequest {
    request_id: String,
    tool: String,
    arguments: Value,
}

#[derive(Clone)]
struct PendingRequest {
    request: GatewayRequest,
    created_at: Instant,
    response: Option<Value>,
}

struct CachedAction {
    fingerprint: String,
    response: Value,
}

#[derive(Default)]
struct GatewayState {
    token: String,
    sequence: u64,
    pending: HashMap<String, PendingRequest>,
    completed_actions: HashMap<String, CachedAction>,
    logs: VecDeque<Value>,
}

static GATEWAY: OnceLock<Arc<Mutex<GatewayState>>> = OnceLock::new();
static GATEWAY_PORT: OnceLock<u16> = OnceLock::new();

#[derive(Deserialize)]
struct ActionRequest {
    name: String,
    #[serde(default)]
    arguments: Value,
    #[serde(default, alias = "idempotencyKey")]
    idempotency_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayInfo {
    url: String,
    token: String,
    mcp_command: String,
    mcp_config: Value,
}

pub fn start(app: AppHandle) -> Result<(), String> {
    if GATEWAY.get().is_some() {
        return Ok(());
    }
    let port = configured_port()?;
    let _ = GATEWAY_PORT.set(port);
    let token = token();
    let server = match Server::http(("127.0.0.1", port)) {
        Ok(server) => Arc::new(server),
        Err(error) => {
            clear_info(&app);
            return Err(format!("start canvas gateway on {port}: {error}"));
        }
    };
    let state = Arc::new(Mutex::new(GatewayState {
        token: token.clone(),
        ..GatewayState::default()
    }));
    persist_info(&app, &token)?;
    GATEWAY
        .set(Arc::clone(&state))
        .map_err(|_| "canvas gateway already started".to_string())?;
    for _ in 0..4 {
        let server = Arc::clone(&server);
        let state = Arc::clone(&state);
        let app = app.clone();
        thread::spawn(move || {
            while let Ok(request) = server.recv() {
                handle(app.clone(), Arc::clone(&state), request);
            }
        });
    }
    eprintln!("[canvas-gateway] http://127.0.0.1:{port}");
    Ok(())
}

#[tauri::command]
pub fn canvas_gateway_info(app: AppHandle) -> Result<GatewayInfo, String> {
    let state = GATEWAY
        .get()
        .ok_or_else(|| "Canvas 网关尚未启动".to_string())?
        .lock()
        .map_err(|_| "Canvas 网关状态锁已损坏".to_string())?;
    let url = format!("http://127.0.0.1:{}", gateway_port());
    let token = state.token.clone();
    let script = app
        .path()
        .resolve("resources/canvas-mcp.ps1", BaseDirectory::Resource)
        .ok()
        .filter(|path| path.exists())
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/canvas-mcp.ps1")
        });
    let development = std::env::current_exe()
        .ok()
        .is_some_and(|exe| super::is_development_output(&exe));
    let release_gate = std::env::var(RELEASE_GATE_ENV).ok().as_deref() == Some("1");
    let config_switch = if release_gate {
        " -ReleaseGate"
    } else if development {
        " -Dev"
    } else {
        ""
    };
    let mcp_command = format!(
        "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"{}\"{}",
        script.display(),
        config_switch
    );
    let mut mcp_args = vec![
        "-NoProfile".to_string(),
        "-ExecutionPolicy".to_string(),
        "Bypass".to_string(),
        "-File".to_string(),
        script.display().to_string(),
    ];
    if release_gate {
        mcp_args.push("-ReleaseGate".to_string());
    } else if development {
        mcp_args.push("-Dev".to_string());
    }
    let mcp_config = json!({
        "mcpServers": {
            "qinghua-canvas": {
                "command": "powershell.exe",
                "args": mcp_args
            }
        }
    });
    Ok(GatewayInfo {
        url,
        token,
        mcp_command,
        mcp_config,
    })
}

#[tauri::command]
pub fn canvas_gateway_respond(request_id: String, result: Value) -> Result<(), String> {
    let state = GATEWAY
        .get()
        .ok_or_else(|| "Canvas 网关尚未启动".to_string())?;
    let mut guard = state
        .lock()
        .map_err(|_| "Canvas 网关状态锁已损坏".to_string())?;
    let Some(pending) = guard.pending.get_mut(&request_id) else {
        return Err(format!("未知的 Canvas 网关请求：{request_id}"));
    };
    let tool = pending.request.tool.clone();
    pending.response = Some(result.clone());
    push_log(
        &mut guard,
        if result.get("ok").and_then(Value::as_bool) == Some(false) {
            "error"
        } else {
            "info"
        },
        "canvas_tool_completed",
        Some(&request_id),
        Some(&tool),
        json!({ "result": result }),
    );
    Ok(())
}

fn token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hash, Hasher};

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let mut first = RandomState::new().build_hasher();
    (now, std::process::id(), "qinghua-canvas-gateway-a").hash(&mut first);
    let mut second = RandomState::new().build_hasher();
    (
        now.rotate_left(29),
        std::process::id(),
        "qinghua-canvas-gateway-b",
    )
        .hash(&mut second);
    format!("{:016x}{:016x}", first.finish(), second.finish())
}

fn persist_info(app: &AppHandle, token: &str) -> Result<(), String> {
    let path = gateway_config_path(app)?;
    let dir = path
        .parent()
        .ok_or_else(|| "canvas gateway config has no parent directory".to_string())?;
    std::fs::create_dir_all(dir)
        .map_err(|error| format!("create canvas gateway config dir: {error}"))?;
    let content = serde_json::to_vec_pretty(&json!({
        "url": format!("http://127.0.0.1:{}", gateway_port()),
        "token": token,
        "protocolVersion": 1
    }))
    .map_err(|error| format!("encode canvas gateway config: {error}"))?;
    std::fs::write(&path, content).map_err(|error| format!("write {}: {error}", path.display()))
}

fn gateway_port() -> u16 {
    GATEWAY_PORT.get().copied().unwrap_or(DEFAULT_PORT)
}

fn configured_port() -> Result<u16, String> {
    let release_gate = std::env::var(RELEASE_GATE_ENV).ok().as_deref() == Some("1");
    resolve_port(release_gate, std::env::var(PORT_ENV).ok().as_deref())
}

fn resolve_port(release_gate: bool, raw: Option<&str>) -> Result<u16, String> {
    if let Some(raw) = raw.map(str::trim).filter(|value| !value.is_empty()) {
        let port = raw
            .parse::<u16>()
            .map_err(|_| format!("{PORT_ENV} 必须是 1-65535 的端口号：{raw}"))?;
        if port == 0 {
            return Err(format!("{PORT_ENV} 不能是 0"));
        }
        return Ok(port);
    }
    Ok(if release_gate {
        RELEASE_GATE_PORT
    } else {
        DEFAULT_PORT
    })
}

fn gateway_config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|error| format!("read current exe: {error}"))?;
    let dir = std::env::var_os("LOCALAPPDATA")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .map(|root| root.join(app.config().identifier.clone()))
        .map(Ok)
        .unwrap_or_else(|| {
            app.path()
                .app_local_data_dir()
                .map_err(|error| format!("read app data dir: {error}"))
        })?;
    Ok(dir.join(gateway_config_name(
        &exe,
        std::env::var(RELEASE_GATE_ENV).ok().as_deref() == Some("1"),
    )))
}

fn gateway_config_name(exe: &std::path::Path, release_gate: bool) -> &'static str {
    if release_gate {
        "canvas-gateway.release-gate.json"
    } else if super::is_development_output(exe) {
        "canvas-gateway.dev.json"
    } else {
        "canvas-gateway.json"
    }
}

fn clear_info(app: &AppHandle) {
    if let Ok(path) = gateway_config_path(app) {
        let _ = std::fs::remove_file(path);
    }
}

fn handle(app: AppHandle, state: Arc<Mutex<GatewayState>>, mut request: Request) {
    let method = request.method().clone();
    let path = request.url().split('?').next().unwrap_or("/").to_string();
    if method == Method::Options {
        let _ = request.respond(
            Response::empty(StatusCode(204))
                .with_header(header("access-control-allow-origin", "*"))
                .with_header(header("access-control-allow-methods", "GET,POST,OPTIONS"))
                .with_header(header(
                    "access-control-allow-headers",
                    "authorization,content-type,x-idempotency-key",
                )),
        );
        return;
    }
    if path == "/health" {
        let _ = respond_json(
            request,
            StatusCode(200),
            json!({
                "ok": true,
                "service": "qinghua-canvas-gateway",
                "protocolVersion": 1
            }),
        );
        return;
    }
    if !authorized(&request, &state) {
        let _ = respond_json(
            request,
            StatusCode(401),
            json!({ "ok": false, "error": "missing_or_invalid_bearer_token" }),
        );
        return;
    }

    match (method, path.as_str()) {
        (Method::Get, "/capabilities") => {
            match dispatch(&app, "__capabilities", json!({}), REQUEST_TIMEOUT) {
                Ok(value) => {
                    let _ = respond_json(request, StatusCode(200), value);
                }
                Err(error) => {
                    let _ = respond_json(
                        request,
                        StatusCode(503),
                        json!({ "ok": false, "error": error }),
                    );
                }
            }
        }
        (Method::Get, "/state") => {
            match dispatch(
                &app,
                "readGraph",
                json!({ "scope": "all" }),
                REQUEST_TIMEOUT,
            ) {
                Ok(value) => {
                    let _ = respond_json(request, StatusCode(200), value);
                }
                Err(error) => {
                    let _ = respond_json(
                        request,
                        StatusCode(503),
                        json!({ "ok": false, "error": error }),
                    );
                }
            }
        }
        (Method::Post, "/action") => {
            let action = match body_json::<ActionRequest>(&mut request) {
                Ok(value) => value,
                Err(error) => {
                    let _ = respond_json(
                        request,
                        StatusCode(400),
                        json!({ "ok": false, "error": error }),
                    );
                    return;
                }
            };
            if action.name.trim().is_empty() {
                let _ = respond_json(
                    request,
                    StatusCode(400),
                    json!({ "ok": false, "error": "tool name is required" }),
                );
                return;
            }
            let cache_key = if action.idempotency_key.trim().is_empty() {
                String::new()
            } else {
                format!("{}::{}", action.name, action.idempotency_key.trim())
            };
            let request_fingerprint = value_fingerprint(&action.arguments);
            if !cache_key.is_empty() {
                if let Ok(guard) = state.lock() {
                    if let Some(cached) = guard.completed_actions.get(&cache_key) {
                        if cached.fingerprint == request_fingerprint {
                            let _ = respond_json(request, StatusCode(200), cached.response.clone());
                        } else {
                            let _ = respond_json(
                                request,
                                StatusCode(409),
                                json!({
                                    "ok": false,
                                    "error": "idempotency_key_conflict"
                                }),
                            );
                        }
                        return;
                    }
                }
            }
            match dispatch(&app, &action.name, action.arguments, REQUEST_TIMEOUT) {
                Ok(value) => {
                    if !cache_key.is_empty() {
                        if let Ok(mut guard) = state.lock() {
                            guard.completed_actions.insert(
                                cache_key,
                                CachedAction {
                                    fingerprint: request_fingerprint,
                                    response: value.clone(),
                                },
                            );
                            if guard.completed_actions.len() > 512 {
                                if let Some(first) = guard.completed_actions.keys().next().cloned()
                                {
                                    guard.completed_actions.remove(&first);
                                }
                            }
                        }
                    }
                    let _ = respond_json(request, StatusCode(200), value);
                }
                Err(error) => {
                    let _ = respond_json(
                        request,
                        StatusCode(503),
                        json!({ "ok": false, "error": error }),
                    );
                }
            }
        }
        (Method::Get, "/events") => {
            let logs = GATEWAY
                .get()
                .and_then(|state| state.lock().ok())
                .map(|guard| guard.logs.iter().cloned().collect::<Vec<_>>())
                .unwrap_or_default();
            let _ = respond_json(
                request,
                StatusCode(200),
                json!({ "ok": true, "events": logs }),
            );
        }
        _ => {
            let _ = respond_json(
                request,
                StatusCode(404),
                json!({ "ok": false, "error": "not_found" }),
            );
        }
    }
}

fn dispatch(
    app: &AppHandle,
    tool: &str,
    arguments: Value,
    timeout: Duration,
) -> Result<Value, String> {
    let state = GATEWAY
        .get()
        .ok_or_else(|| "Canvas 网关尚未启动".to_string())?;
    let request_id = {
        let mut guard = state
            .lock()
            .map_err(|_| "Canvas 网关状态锁已损坏".to_string())?;
        guard.sequence = guard.sequence.wrapping_add(1);
        let id = format!(
            "cgw-{:x}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis(),
            guard.sequence
        );
        let pending = PendingRequest {
            request: GatewayRequest {
                request_id: id.clone(),
                tool: tool.to_string(),
                arguments,
            },
            created_at: Instant::now(),
            response: None,
        };
        push_log(
            &mut guard,
            "info",
            "canvas_tool_requested",
            Some(&id),
            Some(tool),
            pending.request.arguments.clone(),
        );
        guard.pending.insert(id.clone(), pending);
        id
    };

    let payload = state
        .lock()
        .map_err(|_| "Canvas 网关状态锁已损坏".to_string())?
        .pending
        .get(&request_id)
        .map(|pending| pending.request.clone())
        .ok_or_else(|| "Canvas 网关请求状态丢失".to_string())?;
    if let Err(error) = app.emit("canvas-gateway-request", payload) {
        if let Ok(mut guard) = state.lock() {
            guard.pending.remove(&request_id);
            push_log(
                &mut guard,
                "error",
                "canvas_tool_dispatch_failed",
                Some(&request_id),
                Some(tool),
                json!({ "error": error.to_string() }),
            );
        }
        return Err(format!("发送 Canvas 网关事件失败：{error}"));
    }

    let deadline = Instant::now() + timeout;
    loop {
        let mut guard = state
            .lock()
            .map_err(|_| "Canvas 网关状态锁已损坏".to_string())?;
        if let Some(pending) = guard.pending.get_mut(&request_id) {
            if let Some(response) = pending.response.take() {
                guard.pending.remove(&request_id);
                return Ok(response);
            }
            if pending.created_at.elapsed() >= timeout {
                guard.pending.remove(&request_id);
                push_log(
                    &mut guard,
                    "error",
                    "canvas_tool_timeout",
                    Some(&request_id),
                    Some(tool),
                    json!({ "timeoutMs": timeout.as_millis() }),
                );
                return Err("画布未打开、未响应，或请求超过 30 秒".to_string());
            }
        } else {
            return Err("Canvas 网关请求已被移除".to_string());
        }
        drop(guard);
        if Instant::now() >= deadline {
            return Err("画布请求超时".to_string());
        }
        thread::sleep(Duration::from_millis(40));
    }
}

fn push_log(
    state: &mut GatewayState,
    level: &str,
    event: &str,
    request_id: Option<&str>,
    tool: Option<&str>,
    detail: Value,
) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    state.logs.push_back(json!({
        "at": now,
        "level": level,
        "event": event,
        "requestId": request_id,
        "tool": tool,
        "detail": detail
    }));
    while state.logs.len() > MAX_LOG_ENTRIES {
        state.logs.pop_front();
    }
}

fn authorized(request: &Request, state: &Arc<Mutex<GatewayState>>) -> bool {
    let expected = state
        .lock()
        .ok()
        .map(|guard| format!("Bearer {}", guard.token))
        .unwrap_or_default();
    request
        .headers()
        .iter()
        .find(|header| header.field.equiv("authorization"))
        .is_some_and(|header| header.value.as_str() == expected)
}

fn value_fingerprint(value: &Value) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let raw = serde_json::to_vec(value).unwrap_or_default();
    let mut hasher = DefaultHasher::new();
    raw.hash(&mut hasher);
    format!("{:016x}:{}", hasher.finish(), raw.len())
}

fn body_json<T: for<'de> Deserialize<'de>>(request: &mut Request) -> Result<T, String> {
    let mut raw = Vec::new();
    request
        .as_reader()
        .take(2 * 1024 * 1024)
        .read_to_end(&mut raw)
        .map_err(|error| format!("read canvas gateway body: {error}"))?;
    serde_json::from_slice(&raw).map_err(|error| format!("parse JSON body: {error}"))
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("valid header")
}

fn respond_json(request: Request, status: StatusCode, value: Value) -> Result<(), String> {
    let body = serde_json::to_string(&value)
        .map_err(|error| format!("serialize canvas gateway response: {error}"))?;
    request
        .respond(
            Response::from_string(body)
                .with_status_code(status)
                .with_header(header("content-type", "application/json; charset=utf-8"))
                .with_header(header("cache-control", "no-store"))
                .with_header(header("access-control-allow-origin", "*")),
        )
        .map_err(|error| format!("respond canvas gateway: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_is_stable_shape_and_not_empty() {
        let value = token();
        assert_eq!(value.len(), 32);
        assert!(value.chars().all(|ch| ch.is_ascii_hexdigit()));
    }

    #[test]
    fn gateway_info_keeps_loopback_url() {
        let url = format!("http://127.0.0.1:{DEFAULT_PORT}");
        assert!(url.starts_with("http://127.0.0.1:"));
    }

    #[test]
    fn release_gate_uses_isolated_gateway_port() {
        assert_eq!(resolve_port(false, None).unwrap(), 18766);
        assert_eq!(resolve_port(true, None).unwrap(), 18768);
        assert_eq!(resolve_port(true, Some("19001")).unwrap(), 19001);
    }

    #[test]
    fn gateway_port_override_rejects_invalid_or_zero() {
        assert!(resolve_port(false, Some("abc")).is_err());
        assert!(resolve_port(false, Some("0")).is_err());
        assert!(resolve_port(false, Some("65535")).is_ok());
    }

    #[test]
    fn development_gateway_config_is_isolated_from_installed_app() {
        assert_eq!(
            gateway_config_name(
                std::path::Path::new("E:\\work\\qinghua\\src-tauri\\target\\debug\\qinghua.exe"),
                false,
            ),
            "canvas-gateway.dev.json"
        );
        assert_eq!(
            gateway_config_name(std::path::Path::new("E:\\apps\\轻画\\qinghua.exe"), false,),
            "canvas-gateway.json"
        );
        assert_eq!(
            gateway_config_name(std::path::Path::new("E:\\apps\\轻画\\qinghua.exe"), true,),
            "canvas-gateway.release-gate.json"
        );
    }

    #[test]
    fn release_gate_config_name_keeps_harness_and_app_on_the_same_profile() {
        assert_eq!(
            gateway_config_name(std::path::Path::new("E:\\apps\\轻画\\qinghua.exe"), true),
            "canvas-gateway.release-gate.json"
        );
    }

    #[test]
    fn idempotency_fingerprint_distinguishes_arguments() {
        assert_ne!(
            value_fingerprint(&json!({ "nodeIds": ["n1"] })),
            value_fingerprint(&json!({ "nodeIds": ["n2"] }))
        );
        assert_eq!(
            value_fingerprint(&json!({ "nodeIds": ["n1"], "dx": 10 })),
            value_fingerprint(&json!({ "dx": 10, "nodeIds": ["n1"] }))
        );
    }
}
