use serde::{Deserialize, Serialize};
use std::io::Read;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tiny_http::{Header, Method, Response, Server, StatusCode};

const PORT: u16 = 53684;
const CLIP_PATH: &str = "/clip";
const HEALTH_PATH: &str = "/health";
const MAX_BODY_BYTES: u64 = 32 * 1024;
const MAX_PENDING: usize = 100;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClipRequest {
    url: String,
    title: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingClip {
    pub id: String,
    pub url: String,
    pub title: Option<String>,
    pub received_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipperReceiverInfo {
    pub running: bool,
    pub endpoint: String,
    pub token: String,
    pub error: Option<String>,
}

static TOKEN: OnceLock<String> = OnceLock::new();
static PENDING: OnceLock<Mutex<Vec<PendingClip>>> = OnceLock::new();
static START_ERROR: OnceLock<String> = OnceLock::new();
static STARTED: AtomicBool = AtomicBool::new(false);
static NEXT_ID: AtomicUsize = AtomicUsize::new(1);

fn pending() -> &'static Mutex<Vec<PendingClip>> {
    PENDING.get_or_init(|| Mutex::new(Vec::new()))
}

fn token() -> &'static str {
    TOKEN.get_or_init(|| {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        format!("{:x}{:x}", std::process::id(), nanos)
    })
}

fn cros_header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("valid clipper header")
}

fn with_cors<R: Read>(response: Response<R>) -> Response<R> {
    response
        .with_header(cros_header("Access-Control-Allow-Origin", "*"))
        .with_header(cros_header(
            "Access-Control-Allow-Headers",
            "content-type,x-qinghua-clipper-token",
        ))
        .with_header(cros_header(
            "Access-Control-Allow-Methods",
            "GET,POST,OPTIONS",
        ))
        .with_header(cros_header("Cache-Control", "no-store"))
}

fn json_response(status: u16, body: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    with_cors(
        Response::from_string(body)
            .with_status_code(StatusCode(status))
            .with_header(cros_header("Content-Type", "application/json; charset=utf-8")),
    )
}

pub fn start() -> Result<(), String> {
    if STARTED.swap(true, Ordering::AcqRel) {
        return Ok(());
    }
    let _ = token();
    let server = match Server::http(("127.0.0.1", PORT)) {
        Ok(server) => server,
        Err(error) => {
            let message = format!("轻画 Clipper 接收端口启动失败：{error}");
            let _ = START_ERROR.set(message.clone());
            return Err(message);
        }
    };
    serve(server);
    Ok(())
}

fn serve(server: Server) {
    thread::spawn(move || {
        for mut request in server.incoming_requests() {
            let method = request.method().clone();
            let path = request.url().split('?').next().unwrap_or("");
            if method == Method::Options {
                let _ = request.respond(with_cors(
                    Response::empty(StatusCode(204)),
                ));
                continue;
            }
            if method == Method::Get && path == HEALTH_PATH {
                let _ = request.respond(json_response(200, r#"{"ok":true}"#));
                continue;
            }
            if method != Method::Post || path != CLIP_PATH {
                let _ = request.respond(json_response(404, r#"{"ok":false,"error":"not found"}"#));
                continue;
            }
            let authorized = request.headers().iter().any(|header| {
                header.field.as_str().as_str().eq_ignore_ascii_case("x-qinghua-clipper-token")
                    && header.value.as_str() == token()
            });
            if !authorized {
                let _ = request.respond(json_response(
                    401,
                    r#"{"ok":false,"error":"invalid clipper token"}"#,
                ));
                continue;
            }
            let mut body = String::new();
            if request
                .as_reader()
                .take(MAX_BODY_BYTES + 1)
                .read_to_string(&mut body)
                .is_err()
            {
                let _ = request.respond(json_response(
                    400,
                    r#"{"ok":false,"error":"invalid request body"}"#,
                ));
                continue;
            }
            if body.len() as u64 > MAX_BODY_BYTES {
                let _ = request.respond(json_response(
                    413,
                    r#"{"ok":false,"error":"request body too large"}"#,
                ));
                continue;
            }
            let parsed: ClipRequest = match serde_json::from_str(&body) {
                Ok(value) => value,
                Err(_) => {
                    let _ = request.respond(json_response(
                        400,
                        r#"{"ok":false,"error":"invalid clip payload"}"#,
                    ));
                    continue;
                }
            };
            let clip = match normalize_clip(parsed) {
                Ok(value) => value,
                Err(error) => {
                    let _ = request.respond(json_response(
                        400,
                        &serde_json::json!({ "ok": false, "error": error }).to_string(),
                    ));
                    continue;
                }
            };
            if let Ok(mut rows) = pending().lock() {
                if rows.len() >= MAX_PENDING {
                    rows.remove(0);
                }
                rows.push(clip);
                let _ = request.respond(json_response(200, r#"{"ok":true}"#));
            } else {
                let _ = request.respond(json_response(
                    500,
                    r#"{"ok":false,"error":"clipper queue unavailable"}"#,
                ));
            }
        }
    });
}

#[tauri::command]
pub fn clipper_receiver_info() -> ClipperReceiverInfo {
    ClipperReceiverInfo {
        running: STARTED.load(Ordering::Acquire) && START_ERROR.get().is_none(),
        endpoint: format!("http://127.0.0.1:{PORT}{CLIP_PATH}"),
        token: token().to_string(),
        error: START_ERROR.get().cloned(),
    }
}

#[tauri::command]
pub fn clipper_take_pending() -> Vec<PendingClip> {
    pending()
        .lock()
        .map(|mut rows| std::mem::take(&mut *rows))
        .unwrap_or_default()
}

fn normalize_clip(input: ClipRequest) -> Result<PendingClip, String> {
    let url = parse_public_http_url(&input.url)?;
    let title = input.title.unwrap_or_default().trim().chars().take(300).collect::<String>();
    Ok(PendingClip {
        id: format!("clip-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed)),
        url,
        title: (!title.is_empty()).then_some(title),
        received_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or_default(),
    })
}

fn parse_public_http_url(raw: &str) -> Result<String, String> {
    let value = raw.trim();
    if value.is_empty() || value.len() > 2048 {
        return Err("网页地址为空或过长".to_string());
    }
    let url = reqwest::Url::parse(value).map_err(|_| "网页地址格式无效".to_string())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("只接受 http / https 网页地址".to_string());
    }
    if url.host_str().is_none() {
        return Err("网页地址缺少主机名".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("网页地址不能包含账号或密码".to_string());
    }
    Ok(url.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(url: &str, title: Option<&str>) -> ClipRequest {
        ClipRequest {
            url: url.to_string(),
            title: title.map(str::to_string),
        }
    }

    #[test]
    fn accepts_public_http_and_trims_title() {
        let clip = normalize_clip(request("https://example.com/page", Some("  Example  "))).unwrap();
        assert_eq!(clip.url, "https://example.com/page");
        assert_eq!(clip.title.as_deref(), Some("Example"));
        assert!(clip.id.starts_with("clip-"));
    }

    #[test]
    fn rejects_non_http_credentials_and_empty_hosts() {
        assert!(normalize_clip(request("javascript:alert(1)", None)).is_err());
        assert!(normalize_clip(request("https://user:pass@example.com/", None)).is_err());
        assert!(normalize_clip(request("https:///", None)).is_err());
    }

    #[test]
    fn limits_title_and_empty_title() {
        let clip = normalize_clip(request(
            "https://example.com/",
            Some(&"x".repeat(500)),
        ))
        .unwrap();
        assert_eq!(clip.title.as_deref().map(str::len), Some(300));
        let empty = normalize_clip(request("https://example.com/", Some("   "))).unwrap();
        assert_eq!(empty.title, None);
    }

    #[test]
    fn receiver_serves_health_and_queues_authorized_clip() {
        let server = Server::http(("127.0.0.1", 0)).unwrap();
        let port = server
            .server_addr()
            .to_ip()
            .expect("test server must use an IP socket")
            .port();
        serve(server);

        let health = raw_request(port, "GET", HEALTH_PATH, "", "");
        assert!(health.starts_with("HTTP/1.1 200"));

        let body = serde_json::json!({
            "url": "https://example.com/clip",
            "title": "Example"
        })
        .to_string();
        let unauthorized = raw_request(
            port,
            "POST",
            CLIP_PATH,
            &format!("Content-Length: {}\r\n", body.len()),
            &body,
        );
        assert!(unauthorized.starts_with("HTTP/1.1 401"));

        let token = clipper_receiver_info().token;
        let authorized = raw_request(
            port,
            "POST",
            CLIP_PATH,
            &format!(
                "Content-Type: application/json\r\nX-Qinghua-Clipper-Token: {token}\r\nContent-Length: {}\r\n",
                body.len()
            ),
            &body,
        );
        assert!(authorized.starts_with("HTTP/1.1 200"));
        let rows = clipper_take_pending();
        assert!(rows.iter().any(|row| row.url == "https://example.com/clip"));
    }

    fn raw_request(port: u16, method: &str, path: &str, headers: &str, body: &str) -> String {
        use std::io::{Read, Write};
        use std::net::TcpStream;

        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(
            stream,
            "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n{headers}\r\n{body}"
        )
        .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
    }
}
