use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tiny_http::{Header, Response, Server, StatusCode};

const CALLBACK_PORT: u16 = 53682;
const CALLBACK_PATH: &str = "/pinterest/callback";
const LISTEN_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinterestOAuthCallback {
    pub code: String,
    pub state: String,
}

type CallbackResult = Result<PinterestOAuthCallback, String>;
struct OAuthListener {
    receiver: Receiver<CallbackResult>,
    stop: Arc<AtomicBool>,
    handle: thread::JoinHandle<()>,
}

static LISTENERS: OnceLock<Mutex<HashMap<String, OAuthListener>>> = OnceLock::new();

fn listeners() -> &'static Mutex<HashMap<String, OAuthListener>> {
    LISTENERS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("valid oauth callback header")
}

fn bind_callback_server() -> Result<Server, String> {
    let mut last_error = None;
    for _ in 0..20 {
        match Server::http(("127.0.0.1", CALLBACK_PORT)) {
            Ok(server) => return Ok(server),
            Err(error) => {
                last_error = Some(error);
                thread::sleep(Duration::from_millis(50));
            }
        }
    }
    Err(format!(
        "启动 Pinterest OAuth 回调端口失败：{}",
        last_error
            .map(|error| error.to_string())
            .unwrap_or_else(|| "端口被占用".to_string())
    ))
}

fn stop_listener(listener: OAuthListener) {
    listener.stop.store(true, Ordering::Release);
    let _ = listener.handle.join();
}

#[tauri::command]
pub fn pinterest_oauth_listen(state: String) -> Result<String, String> {
    let state = state.trim().to_string();
    if state.len() < 16 || state.len() > 200 {
        return Err("Pinterest OAuth state 长度无效".to_string());
    }
    if listeners()
        .lock()
        .map_err(|_| "Pinterest OAuth 状态锁已损坏".to_string())?
        .contains_key(&state)
    {
        return Err("Pinterest OAuth state 已在使用".to_string());
    }

    let server = bind_callback_server()?;
    let (tx, rx) = mpsc::channel();
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = Arc::clone(&stop);
    let thread_state = state.clone();
    let handle = thread::spawn(move || {
        let deadline = std::time::Instant::now() + LISTEN_TIMEOUT;
        while !thread_stop.load(Ordering::Acquire) && std::time::Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            match server.recv_timeout(remaining.min(Duration::from_millis(100))) {
                Ok(Some(request)) => {
                    let url = request.url().to_string();
                    let callback = parse_callback_url(&url, &thread_state);
                    match callback {
                        Ok(value) => {
                            let _ = request.respond(callback_page(
                                StatusCode(200),
                                "Pinterest 授权完成，可以关闭此页面并回到轻画。",
                            ));
                            let _ = tx.send(Ok(value));
                            break;
                        }
                        Err(error) => {
                            let _ = request.respond(callback_page(
                                StatusCode(400),
                                &format!("授权失败：{error}"),
                            ));
                        }
                    }
                }
                Ok(None) | Err(_) => {}
            }
        }
    });

    let mut guard = match listeners().lock() {
        Ok(guard) => guard,
        Err(_) => {
            stop.store(true, Ordering::Release);
            let _ = handle.join();
            return Err("Pinterest OAuth 状态锁已损坏".to_string());
        }
    };
    guard.insert(
        state,
        OAuthListener {
            receiver: rx,
            stop,
            handle,
        },
    );

    Ok(format!("http://127.0.0.1:{CALLBACK_PORT}{CALLBACK_PATH}"))
}

#[tauri::command]
pub fn pinterest_oauth_wait(
    state: String,
    timeout_ms: Option<u64>,
) -> Result<PinterestOAuthCallback, String> {
    let listener = listeners()
        .lock()
        .map_err(|_| "Pinterest OAuth 状态锁已损坏".to_string())?
        .remove(&state)
        .ok_or_else(|| "Pinterest OAuth 回调监听不存在".to_string())?;
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(180_000).clamp(10_000, 300_000));
    let result = listener
        .receiver
        .recv_timeout(timeout)
        .map_err(|_| "等待 Pinterest 授权超时".to_string());
    stop_listener(listener);
    result?
}

#[tauri::command]
pub fn pinterest_oauth_cancel(state: String) -> Result<(), String> {
    let listener = listeners()
        .lock()
        .map_err(|_| "Pinterest OAuth 状态锁已损坏".to_string())?
        .remove(&state);
    if let Some(listener) = listener {
        stop_listener(listener);
    }
    Ok(())
}

fn parse_callback_url(url: &str, expected_state: &str) -> Result<PinterestOAuthCallback, String> {
    let (path, query) = url.split_once('?').unwrap_or((url, ""));
    if path != CALLBACK_PATH {
        return Err("回调路径不匹配".to_string());
    }
    let mut code = String::new();
    let mut state = String::new();
    let mut error = String::new();
    for pair in query.split('&').filter(|pair| !pair.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        let value = percent_decode(value);
        match key {
            "code" => code = value,
            "state" => state = value,
            "error" => error = value,
            "error_description" => {
                if error.is_empty() {
                    error = value;
                }
            }
            _ => {}
        }
    }
    if !error.is_empty() {
        return Err(error);
    }
    if state != expected_state {
        return Err("OAuth state 不匹配".to_string());
    }
    if code.trim().is_empty() {
        return Err("Pinterest 没有返回 authorization code".to_string());
    }
    Ok(PinterestOAuthCallback { code, state })
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = &value[index + 1..index + 3];
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(if bytes[index] == b'+' {
            b' '
        } else {
            bytes[index]
        });
        index += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn callback_page(status: StatusCode, message: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    let safe = message
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;");
    let body = format!(
        "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><title>Pinterest OAuth</title><body style=\"font:16px system-ui;padding:40px;background:#111;color:#eee\">{safe}</body></html>"
    );
    Response::from_string(body)
        .with_status_code(status)
        .with_header(header("content-type", "text/html; charset=utf-8"))
        .with_header(header("cache-control", "no-store"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callback_requires_matching_state_and_code() {
        let value = parse_callback_url(
            "/pinterest/callback?code=code-1&state=state-1234567890",
            "state-1234567890",
        )
        .unwrap();
        assert_eq!(value.code, "code-1");
        assert!(parse_callback_url(
            "/pinterest/callback?code=code-1&state=wrong",
            "state-1234567890"
        )
        .is_err());
        assert!(parse_callback_url(
            "/pinterest/callback?state=state-1234567890",
            "state-1234567890"
        )
        .is_err());
    }

    #[test]
    fn callback_decodes_url_encoded_values() {
        let value = parse_callback_url(
            "/pinterest/callback?code=a%2Fb%2Bc&state=state%2D1234567890",
            "state-1234567890",
        )
        .unwrap();
        assert_eq!(value.code, "a/b+c");
    }

    #[test]
    fn callback_surfaces_oauth_error_description() {
        let error = parse_callback_url(
            "/pinterest/callback?error=access_denied&error_description=User%20declined&state=state-1234567890",
            "state-1234567890",
        )
        .unwrap_err();
        assert_eq!(error, "access_denied");
    }
}
