use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::thread;
use std::time::{Duration, Instant};
use tiny_http::{Method, Request, Response, Server, StatusCode};

mod hash;
mod http_guard;
pub use http_guard::{generate_session_token, TOKEN_ENV, TOKEN_HEADER};
use http_guard::{
    configured_env_token, header, normalize_token, origin_allowed, request_guard, respond_bytes,
    respond_json, token_guard, AUTH_TOKEN,
};
pub mod migration;
pub mod sqlite;
pub mod v2_admin;

pub const PORT: u16 = 18765;
pub const PORT_ENV: &str = "QINGHUA_SHARED_STORE_PORT";

/// 解析显式端口；空值回退到默认值，`0` 和无符号范围外的值直接拒绝。
///
/// release gate 的调用方会传入自己的默认端口，因此这里不把 18765 写死到所有入口。
pub fn parse_port(raw: Option<&str>, fallback: u16) -> Result<u16, String> {
    let value = raw.map(str::trim).filter(|value| !value.is_empty());
    let port = match value {
        Some(value) => value
            .parse::<u16>()
            .map_err(|error| format!("invalid shared-store port {value:?}: {error}"))?,
        None => fallback,
    };
    if port == 0 {
        return Err("shared-store port must be between 1 and 65535".to_string());
    }
    Ok(port)
}

static STARTED: OnceLock<()> = OnceLock::new();
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(1);
static ACTIVE_BACKEND: OnceLock<Arc<RwLock<Arc<dyn StoreBackend>>>> = OnceLock::new();

#[derive(Clone)]
struct Store {
    root: Arc<PathBuf>,
    lock: Arc<Mutex<()>>,
    maintenance: Arc<AtomicBool>,
    usage_cache: Arc<Mutex<Option<u64>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Usage {
    used: u64,
    quota: u64,
}

fn hex_id(value: &str) -> String {
    value
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn table_dir(root: &Path, table: &str) -> Result<PathBuf, String> {
    if !sqlite::TABLE_NAMES.contains(&table) {
        return Err(format!("unknown table: {table}"));
    }
    Ok(root.join(table))
}

fn row_path(root: &Path, table: &str, id: &str) -> Result<PathBuf, String> {
    Ok(table_dir(root, table)?.join(format!("{}.json", hex_id(id))))
}

fn meta_path(root: &Path, table: &str, id: &str) -> Result<PathBuf, String> {
    Ok(table_dir(root, table)?.join(format!("{}.meta.json", hex_id(id))))
}

fn is_row_file(path: &Path) -> bool {
    path.extension().is_some_and(|ext| ext == "json")
        && !path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with(".meta.json"))
}

fn thumb_path(root: &Path, id: &str) -> PathBuf {
    root.join("_thumbs").join(format!("{}.webp", hex_id(id)))
}

fn preview_path(root: &Path, id: &str) -> PathBuf {
    root.join("_previews").join(format!("{}.webp", hex_id(id)))
}

fn write_atomic(path: &Path, payload: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("create dir: {error}"))?;
    }
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary = path.with_file_name(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("row"),
        sequence
    ));
    fs::write(&temporary, payload).map_err(|error| format!("write temp: {error}"))?;
    let deadline = Instant::now() + Duration::from_millis(750);
    loop {
        if path.exists() {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::WouldBlock
                    ) && Instant::now() < deadline =>
                {
                    thread::sleep(Duration::from_millis(10));
                    continue;
                }
                Err(error) => {
                    let _ = fs::remove_file(&temporary);
                    return Err(format!("replace old file: {error}"));
                }
            }
        }
        match fs::rename(&temporary, path) {
            Ok(()) => return Ok(()),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::PermissionDenied
                        | std::io::ErrorKind::AlreadyExists
                        | std::io::ErrorKind::WouldBlock
                ) && Instant::now() < deadline =>
            {
                thread::sleep(Duration::from_millis(10));
            }
            Err(error) => {
                let _ = fs::remove_file(&temporary);
                return Err(format!("rename temp: {error}"));
            }
        }
    }
}

fn read_json(path: &Path) -> Result<Value, String> {
    let deadline = Instant::now() + Duration::from_millis(500);
    loop {
        match fs::read_to_string(path) {
            Ok(raw) => match serde_json::from_str(&raw) {
                Ok(value) => return Ok(value),
                Err(_error) if Instant::now() < deadline => {
                    thread::sleep(Duration::from_millis(10));
                }
                Err(error) => {
                    return Err(format!("parse {}: {error}", path.display()));
                }
            },
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::NotFound | std::io::ErrorKind::PermissionDenied
                ) && Instant::now() < deadline =>
            {
                /*
                 * Windows 不能原子覆盖已存在文件，`write_atomic` 会先删旧文件再
                 * rename 新文件。读线程可能正好落在这两个动作之间；短暂重试
                 * 等写完，而不是把一次正常写入暴露成页面未捕获异常。
                 */
                thread::sleep(Duration::from_millis(10));
            }
            Err(error) => return Err(format!("read {}: {error}", path.display())),
        }
    }
}

fn write_row(root: &Path, table: &str, row: &Value) -> Result<(), String> {
    let id = row
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "row.id must be a string".to_string())?;
    let payload = serde_json::to_vec(row).map_err(|error| format!("serialize row: {error}"))?;
    write_atomic(&row_path(root, table, id)?, &payload)?;
    write_sidecars(root, table, row)
}

fn delete_row(root: &Path, table: &str, id: &str) -> Result<(), String> {
    let path = row_path(root, table, id)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("delete row: {error}"))?;
    }
    remove_sidecars(root, table, id)
}

fn list_rows(root: &Path, table: &str) -> Result<Vec<Value>, String> {
    let dir = table_dir(root, table)?;
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut files = fs::read_dir(&dir)
        .map_err(|error| format!("read table dir: {error}"))?
        .filter_map(Result::ok)
        .filter(|entry| is_row_file(&entry.path()))
        .collect::<Vec<_>>();
    files.sort_by_key(|entry| entry.file_name());
    let mut rows = Vec::with_capacity(files.len());
    for file in files {
        rows.push(read_json(&file.path())?);
    }
    Ok(rows)
}

fn row_files(root: &Path, table: &str) -> Result<Vec<PathBuf>, String> {
    let dir = table_dir(root, table)?;
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut files = fs::read_dir(&dir)
        .map_err(|error| format!("read table dir: {error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| is_row_file(path))
        .collect::<Vec<_>>();
    files.sort();
    Ok(files)
}

fn strip_payload(row: &mut Value) {
    let Value::Object(fields) = row else {
        return;
    };
    for name in ["bytes", "thumb", "thumbnail", "preview", "data"] {
        let Some(value) = fields.get(name) else {
            continue;
        };
        /*
         * `data` 在 nodes / storyboards 等表里是正常业务对象，只有 assets 的
         * bytes/thumb 这类字段才是 `{ "__qhType": "u8", base64 }` 二进制标记。
         * 不能按字段名盲删，否则节点 data 会在列表投影里整体消失。
         */
        if value.get("__qhType").and_then(Value::as_str) != Some("u8") {
            continue;
        }
        let length = value
            .get("base64")
            .and_then(Value::as_str)
            .map(|encoded| {
                let padding = if encoded.ends_with("==") {
                    2
                } else if encoded.ends_with('=') {
                    1
                } else {
                    0
                };
                (encoded.len().saturating_mul(3) / 4).saturating_sub(padding)
            })
            .unwrap_or(0);
        fields.insert(format!("{name}Length"), json!(length));
        fields.remove(name);
    }
}

fn binary_marker_bytes(value: &Value) -> Option<Vec<u8>> {
    if value.get("__qhType").and_then(Value::as_str) != Some("u8") {
        return None;
    }
    base64::engine::general_purpose::STANDARD
        .decode(value.get("base64").and_then(Value::as_str)?)
        .ok()
}

fn write_sidecars(root: &Path, table: &str, row: &Value) -> Result<(), String> {
    if table != "assets" {
        return Ok(());
    }
    let id = row
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "asset row id missing".to_string())?;
    let mut metadata = row.clone();
    strip_payload(&mut metadata);
    write_atomic(
        &meta_path(root, table, id)?,
        &serde_json::to_vec(&metadata).map_err(|error| error.to_string())?,
    )?;
    if let Some(thumb) = row
        .get("thumb")
        .or_else(|| row.get("thumbnail"))
        .and_then(binary_marker_bytes)
    {
        write_atomic(&thumb_path(root, id), &thumb)?;
    }
    if let Some(preview) = row.get("preview").and_then(binary_marker_bytes) {
        write_atomic(&preview_path(root, id), &preview)?;
    }
    Ok(())
}

fn remove_sidecars(root: &Path, table: &str, id: &str) -> Result<(), String> {
    if table == "assets" {
        for path in [
            meta_path(root, table, id)?,
            thumb_path(root, id),
            preview_path(root, id),
        ] {
            if path.exists() {
                fs::remove_file(path).map_err(|error| format!("remove sidecar: {error}"))?;
            }
        }
    }
    Ok(())
}

fn project_fields(row: &mut Value, fields: Option<&str>) {
    let Some(fields) = fields else {
        return;
    };
    let keep = fields
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<std::collections::HashSet<_>>();
    if let Value::Object(values) = row {
        values.retain(|key, _| keep.contains(key.as_str()));
    }
}

fn row_matches(row: &Value, filter: &Map<String, Value>) -> bool {
    filter
        .iter()
        .all(|(key, expected)| row.get(key).is_some_and(|actual| actual == expected))
}

fn page_row_matches(row: &Value, filter: &Map<String, Value>, page: &PageQuery) -> bool {
    if !row_matches(row, filter) {
        return false;
    }
    if !page.ids.is_empty()
        && !row
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| page.ids.iter().any(|candidate| candidate == id))
    {
        return false;
    }
    if page
        .missing_fields
        .iter()
        .any(|field| row.get(field).is_some())
    {
        return false;
    }
    page.ranges.iter().all(|range| {
        row.get(&range.field)
            .and_then(Value::as_i64)
            .is_some_and(|value| {
                range.from.is_none_or(|from| value >= from) && range.to.is_none_or(|to| value <= to)
            })
    })
}

fn compare_page_values(left: Option<&Value>, right: Option<&Value>) -> std::cmp::Ordering {
    match (left.and_then(Value::as_i64), right.and_then(Value::as_i64)) {
        (Some(a), Some(b)) => a.cmp(&b),
        _ => left
            .map(Value::to_string)
            .unwrap_or_default()
            .cmp(&right.map(Value::to_string).unwrap_or_default()),
    }
}

fn query_rows(root: &Path, table: &str, filter: &Map<String, Value>) -> Result<Vec<Value>, String> {
    if let Some(Value::String(id)) = filter.get("id") {
        if filter.len() == 1 {
            let path = row_path(root, table, id)?;
            if path.exists() {
                return Ok(vec![read_json(&path)?]);
            }
            return Ok(Vec::new());
        }
    }
    Ok(list_rows(root, table)?
        .into_iter()
        .filter(|row| row_matches(row, filter))
        .collect())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PutRequest {
    table: String,
    row: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BulkPutRequest {
    table: String,
    rows: Vec<Value>,
}

#[derive(Deserialize)]
struct DeleteRequest {
    table: String,
    id: String,
}

#[derive(Deserialize)]
struct QueryRequest {
    table: String,
    filter: Map<String, Value>,
    #[serde(default = "default_true", rename = "includePayload")]
    include_payload: bool,
    fields: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRange {
    pub field: String,
    pub from: Option<i64>,
    pub to: Option<i64>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageOrder {
    pub field: String,
    pub direction: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageQuery {
    #[serde(default)]
    pub ids: Vec<String>,
    #[serde(default)]
    pub missing_fields: Vec<String>,
    #[serde(default)]
    pub ranges: Vec<PageRange>,
    pub order_by: Option<PageOrder>,
    #[serde(default)]
    pub offset: usize,
    #[serde(default = "default_page_limit")]
    pub limit: usize,
    #[serde(default = "default_true")]
    pub include_payload: bool,
    pub fields: Option<String>,
}

fn default_page_limit() -> usize {
    200
}

#[derive(Deserialize)]
struct QueryPageRequest {
    table: String,
    filter: Map<String, Value>,
    #[serde(flatten)]
    page: PageQuery,
}

fn default_true() -> bool {
    true
}

#[derive(Deserialize)]
struct TxRequest {
    ops: Vec<TxOp>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum TxOp {
    Put { table: String, row: Value },
    BulkPut { table: String, rows: Vec<Value> },
    Delete { table: String, id: String },
}

fn apply_tx(root: &Path, request: TxRequest) -> Result<i128, String> {
    let mut snapshots: Vec<(PathBuf, Option<Vec<u8>>)> = Vec::new();
    let mut touched: Vec<PathBuf> = Vec::new();
    let mut usage_delta: i128 = 0;

    let add_snapshot = |path: PathBuf,
                        snapshots: &mut Vec<(PathBuf, Option<Vec<u8>>)>,
                        touched: &mut Vec<PathBuf>,
                        usage_delta: &mut i128|
     -> Result<(), String> {
        if touched.contains(&path) {
            return Ok(());
        }
        let old = if path.exists() {
            let bytes = fs::read(&path).map_err(|error| format!("snapshot row: {error}"))?;
            *usage_delta -= bytes.len() as i128;
            Some(bytes)
        } else {
            None
        };
        snapshots.push((path.clone(), old));
        touched.push(path);
        Ok(())
    };

    let result = (|| -> Result<(), String> {
        for op in request.ops {
            match op {
                TxOp::Put { table, row } => {
                    let id = row
                        .get("id")
                        .and_then(Value::as_str)
                        .ok_or_else(|| "row.id missing".to_string())?;
                    add_snapshot(
                        row_path(root, &table, id)?,
                        &mut snapshots,
                        &mut touched,
                        &mut usage_delta,
                    )?;
                    write_row(root, &table, &row)?;
                    usage_delta += fs::metadata(row_path(root, &table, id)?)
                        .map(|meta| meta.len() as i128)
                        .unwrap_or(0);
                }
                TxOp::BulkPut { table, rows } => {
                    for row in rows {
                        let id = row
                            .get("id")
                            .and_then(Value::as_str)
                            .ok_or_else(|| "row.id missing".to_string())?;
                        add_snapshot(
                            row_path(root, &table, id)?,
                            &mut snapshots,
                            &mut touched,
                            &mut usage_delta,
                        )?;
                        write_row(root, &table, &row)?;
                        usage_delta += fs::metadata(row_path(root, &table, id)?)
                            .map(|meta| meta.len() as i128)
                            .unwrap_or(0);
                    }
                }
                TxOp::Delete { table, id } => {
                    add_snapshot(
                        row_path(root, &table, &id)?,
                        &mut snapshots,
                        &mut touched,
                        &mut usage_delta,
                    )?;
                    delete_row(root, &table, &id)?;
                }
            }
        }
        Ok(())
    })();

    if let Err(error) = result {
        for (path, old) in snapshots.into_iter().rev() {
            if let Some(bytes) = old {
                let _ = write_atomic(&path, &bytes);
            } else if path.exists() {
                let _ = fs::remove_file(path);
            }
        }
        return Err(error);
    }
    Ok(usage_delta)
}

fn usage(root: &Path) -> Usage {
    fn sum(path: &Path) -> u64 {
        let Ok(entries) = fs::read_dir(path) else {
            return 0;
        };
        entries
            .filter_map(Result::ok)
            .map(|entry| {
                let path = entry.path();
                if path.is_dir() {
                    sum(&path)
                } else {
                    entry.metadata().map(|meta| meta.len()).unwrap_or(0)
                }
            })
            .sum()
    }
    Usage {
        used: sum(root),
        quota: 0,
    }
}

/// V1 目录后端 `/usage` recursively walks the whole data dir, which is slow on
/// large stores. Every write path holds the same store lock, so invalidating
/// inside that lock keeps reads fresh without weakening the HTTP contract.
fn cached_usage(store: &Store) -> u64 {
    {
        let cache = store.usage_cache.lock().expect("usage cache poisoned");
        if let Some(used) = *cache {
            return used;
        }
    }
    let used = usage(store.root.as_path()).used;
    let mut cache = store.usage_cache.lock().expect("usage cache poisoned");
    *cache = Some(used);
    used
}

fn shift_usage(store: &Store, delta: i128) {
    let mut cache = store.usage_cache.lock().expect("usage cache poisoned");
    if cache.is_none() {
        *cache = Some(usage(store.root.as_path()).used);
    }
    if delta == 0 {
        return;
    }
    if let Some(used) = cache.as_mut() {
        *used = (*used as i128 + delta).max(0) as u64;
    }
}

fn invalidate_usage(store: &Store) {
    *store.usage_cache.lock().expect("usage cache poisoned") = None;
}

/// Track exact byte deltas for plain row writes; asset writes create several
/// sidecars, so they invalidate the cache. Lazy thumbnail/preview reads apply
/// only the newly materialized sidecar size.
fn apply_usage_delta(store: &Store, removed_bytes: i128, written_path: Option<&Path>) {
    let mut cache = store.usage_cache.lock().expect("usage cache poisoned");
    match (written_path, cache.as_mut()) {
        (Some(_), _) if written_path.is_some_and(|p| p.starts_with(store.root.join("assets"))) => {
            *cache = None;
        }
        (Some(_), Some(used)) => {
            let written = written_path
                .and_then(|path| fs::metadata(path).ok())
                .map(|meta| meta.len() as i128)
                .unwrap_or(0);
            let next = *used as i128 + removed_bytes + written;
            *cache = Some(next.max(0) as u64);
        }
        _ => *cache = None,
    }
}


fn load_thumb(root: &Path, id: &str) -> Result<Vec<u8>, String> {
    let sidecar = thumb_path(root, id);
    if sidecar.exists() {
        return fs::read(sidecar).map_err(|error| format!("read thumb: {error}"));
    }
    let row = read_json(&row_path(root, "assets", id)?)?;
    let bytes = row
        .get("thumb")
        .or_else(|| row.get("thumbnail"))
        .and_then(binary_marker_bytes)
        .ok_or_else(|| "asset has no thumb".to_string())?;
    write_atomic(&sidecar, &bytes)?;
    Ok(bytes)
}

fn load_preview(root: &Path, id: &str) -> Result<Vec<u8>, String> {
    let sidecar = preview_path(root, id);
    if sidecar.exists() {
        return fs::read(sidecar).map_err(|error| format!("read preview: {error}"));
    }
    let row = read_json(&row_path(root, "assets", id)?)?;
    let bytes = row
        .get("preview")
        .and_then(binary_marker_bytes)
        .ok_or_else(|| "asset has no preview".to_string())?;
    write_atomic(&sidecar, &bytes)?;
    Ok(bytes)
}

fn load_asset(root: &Path, id: &str) -> Result<(Vec<u8>, String), String> {
    let row = read_json(&row_path(root, "assets", id)?)?;
    let mime = row
        .get("mime")
        .and_then(Value::as_str)
        .unwrap_or("application/octet-stream")
        .to_string();
    let bytes = row
        .get("bytes")
        .and_then(binary_marker_bytes)
        .ok_or_else(|| "asset has no local bytes".to_string())?;
    Ok((bytes, mime))
}

trait StoreBackend: Send + Sync {
    fn kind(&self) -> &'static str;
    fn root(&self) -> &Path;
    fn put(&self, table: &str, row: &Value) -> Result<(), String>;
    fn bulk_put(&self, table: &str, rows: &[Value]) -> Result<(), String>;
    fn delete(&self, table: &str, id: &str) -> Result<(), String>;
    fn transaction(&self, ops: Vec<TxOp>) -> Result<(), String>;
    fn query(
        &self,
        table: &str,
        filter: &Map<String, Value>,
        include_payload: bool,
        fields: Option<&str>,
    ) -> Result<Vec<Value>, String>;
    fn query_page(
        &self,
        table: &str,
        filter: &Map<String, Value>,
        page: &PageQuery,
    ) -> Result<(Vec<Value>, u64), String>;
    fn scan_page(
        &self,
        table: &str,
        offset: usize,
        limit: usize,
        include_payload: bool,
    ) -> Result<(Vec<Value>, u64), String>;
    fn usage(&self) -> u64;
    fn kv_get(&self, key: &str) -> Result<Value, String>;
    fn kv_put(&self, key: &str, value: &Value) -> Result<(), String>;
    fn kv_delete(&self, key: &str) -> Result<(), String>;
    fn asset_bytes(&self, id: &str) -> Result<(Vec<u8>, String), String>;
    fn asset_thumb(&self, id: &str) -> Result<Vec<u8>, String>;
    fn asset_preview(&self, id: &str) -> Result<Vec<u8>, String>;
    fn set_maintenance(&self, enabled: bool);
    fn in_maintenance(&self) -> bool;
}

impl Store {
    fn ensure_writes_allowed(&self) -> Result<(), String> {
        if self.maintenance.load(Ordering::SeqCst) {
            Err("storage is in maintenance mode".into())
        } else {
            Ok(())
        }
    }
}

impl StoreBackend for Store {
    fn kind(&self) -> &'static str {
        "json-v1"
    }

    fn root(&self) -> &Path {
        self.root.as_path()
    }

    fn put(&self, table: &str, row: &Value) -> Result<(), String> {
        let _guard = self.lock.lock().expect("store lock poisoned");
        self.ensure_writes_allowed()?;
        let path = row_path(
            self.root.as_path(),
            table,
            row.get("id")
                .and_then(Value::as_str)
                .ok_or("row.id must be a string")?,
        )?;
        let before = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
        write_row(self.root.as_path(), table, row)?;
        if table == "assets" {
            invalidate_usage(self);
        } else {
            apply_usage_delta(self, -(before as i128), Some(&path));
        }
        Ok(())
    }

    fn bulk_put(&self, table: &str, rows: &[Value]) -> Result<(), String> {
        let _guard = self.lock.lock().expect("store lock poisoned");
        self.ensure_writes_allowed()?;
        for row in rows {
            let path = row_path(
                self.root.as_path(),
                table,
                row.get("id")
                    .and_then(Value::as_str)
                    .ok_or("row.id must be a string")?,
            )?;
            let before = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
            write_row(self.root.as_path(), table, row)?;
            if table == "assets" {
                invalidate_usage(self);
            } else {
                apply_usage_delta(self, -(before as i128), Some(&path));
            }
        }
        Ok(())
    }

    fn delete(&self, table: &str, id: &str) -> Result<(), String> {
        let _guard = self.lock.lock().expect("store lock poisoned");
        self.ensure_writes_allowed()?;
        let path = row_path(self.root.as_path(), table, id)?;
        let before = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
        delete_row(self.root.as_path(), table, id)?;
        if table == "assets" {
            invalidate_usage(self);
        } else {
            apply_usage_delta(self, -(before as i128), None);
        }
        Ok(())
    }

    fn transaction(&self, ops: Vec<TxOp>) -> Result<(), String> {
        let _guard = self.lock.lock().expect("store lock poisoned");
        self.ensure_writes_allowed()?;
        let delta = apply_tx(self.root.as_path(), TxRequest { ops })?;
        shift_usage(self, delta);
        Ok(())
    }

    fn query(
        &self,
        table: &str,
        filter: &Map<String, Value>,
        include_payload: bool,
        fields: Option<&str>,
    ) -> Result<Vec<Value>, String> {
        let root = self.root.as_path();
        let _guard = self.lock.lock().expect("store lock poisoned");
        let mut rows = if !include_payload
            && table == "assets"
            && filter.len() == 1
            && filter.get("id").and_then(Value::as_str).is_some()
        {
            let id = filter.get("id").and_then(Value::as_str).unwrap();
            let metadata_file = meta_path(root, table, id)?;
            if metadata_file.exists() {
                vec![read_json(&metadata_file)?]
            } else {
                let full = read_json(&row_path(root, table, id)?)?;
                write_sidecars(root, table, &full)?;
                let mut metadata = full;
                strip_payload(&mut metadata);
                vec![metadata]
            }
        } else {
            query_rows(root, table, filter)?
        };
        for row in &mut rows {
            if !include_payload {
                strip_payload(row);
            }
            project_fields(row, fields);
        }
        Ok(rows)
    }

    fn query_page(
        &self,
        table: &str,
        filter: &Map<String, Value>,
        page: &PageQuery,
    ) -> Result<(Vec<Value>, u64), String> {
        let root = self.root.as_path();
        let _guard = self.lock.lock().expect("store lock poisoned");
        let mut rows = list_rows(root, table)?
            .into_iter()
            .filter(|row| page_row_matches(row, filter, page))
            .collect::<Vec<_>>();
        if let Some(order) = &page.order_by {
            rows.sort_by(|left, right| {
                let mut compared =
                    compare_page_values(left.get(&order.field), right.get(&order.field));
                if order.direction.as_deref() == Some("desc") {
                    compared = compared.reverse();
                }
                compared.then_with(|| {
                    left.get("id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .cmp(right.get("id").and_then(Value::as_str).unwrap_or_default())
                })
            });
        }
        let total = rows.len() as u64;
        let mut paged = rows
            .into_iter()
            .skip(page.offset)
            .take(page.limit)
            .collect::<Vec<_>>();
        for row in &mut paged {
            if !page.include_payload {
                strip_payload(row);
            }
            project_fields(row, page.fields.as_deref());
        }
        Ok((paged, total))
    }

    fn scan_page(
        &self,
        table: &str,
        offset: usize,
        limit: usize,
        include_payload: bool,
    ) -> Result<(Vec<Value>, u64), String> {
        let root = self.root.as_path();
        let _guard = self.lock.lock().expect("store lock poisoned");
        let files = row_files(root, table)?;
        let total = files.len() as u64;
        let page = files
            .into_iter()
            .skip(offset)
            .take(limit)
            .map(|file| {
                if include_payload {
                    return read_json(&file);
                }
                let metadata_file = file.with_extension("meta.json");
                if metadata_file.exists() {
                    return read_json(&metadata_file);
                }
                let row = read_json(&file)?;
                write_sidecars(root, table, &row)?;
                let mut metadata = row;
                strip_payload(&mut metadata);
                Ok(metadata)
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok((page, total))
    }

    fn usage(&self) -> u64 {
        let _guard = self.lock.lock().expect("store lock poisoned");
        cached_usage(self)
    }

    fn kv_get(&self, key: &str) -> Result<Value, String> {
        let path = self.root.join("_kv").join(format!("{}.json", hex_id(key)));
        if path.exists() {
            read_json(&path)
        } else {
            Ok(Value::Null)
        }
    }

    fn kv_put(&self, key: &str, value: &Value) -> Result<(), String> {
        let _guard = self.lock.lock().expect("store lock poisoned");
        self.ensure_writes_allowed()?;
        let path = self.root.join("_kv").join(format!("{}.json", hex_id(key)));
        let before = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
        let payload = serde_json::to_vec(value).map_err(|error| format!("encode kv: {error}"))?;
        write_atomic(&path, &payload)
            .map(|_| ())?;
        shift_usage(self, payload.len() as i128 - before as i128);
        Ok(())
    }

    fn kv_delete(&self, key: &str) -> Result<(), String> {
        let _guard = self.lock.lock().expect("store lock poisoned");
        self.ensure_writes_allowed()?;
        let path = self.root.join("_kv").join(format!("{}.json", hex_id(key)));
        let before = fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
        if path.exists() {
            fs::remove_file(path).map_err(|error| error.to_string())?;
            shift_usage(self, -(before as i128));
        }
        Ok(())
    }

    fn asset_bytes(&self, id: &str) -> Result<(Vec<u8>, String), String> {
        let _guard = self.lock.lock().expect("store lock poisoned");
        load_asset(self.root.as_path(), id)
    }

    fn asset_thumb(&self, id: &str) -> Result<Vec<u8>, String> {
        let _guard = self.lock.lock().expect("store lock poisoned");
        let sidecar = thumb_path(self.root.as_path(), id);
        let before = fs::metadata(&sidecar).map(|meta| meta.len() as i128).unwrap_or(0);
        let bytes = load_thumb(self.root.as_path(), id)?;
        let after = fs::metadata(&sidecar).map(|meta| meta.len() as i128).unwrap_or(0);
        if after > before {
            shift_usage(self, after - before);
        }
        Ok(bytes)
    }

    fn asset_preview(&self, id: &str) -> Result<Vec<u8>, String> {
        let _guard = self.lock.lock().expect("store lock poisoned");
        let sidecar = preview_path(self.root.as_path(), id);
        let before = fs::metadata(&sidecar).map(|meta| meta.len() as i128).unwrap_or(0);
        let bytes = load_preview(self.root.as_path(), id)?;
        let after = fs::metadata(&sidecar).map(|meta| meta.len() as i128).unwrap_or(0);
        if after > before {
            shift_usage(self, after - before);
        }
        Ok(bytes)
    }

    fn set_maintenance(&self, enabled: bool) {
        let _guard = self.lock.lock().expect("store lock poisoned");
        self.maintenance.store(enabled, Ordering::SeqCst);
    }

    fn in_maintenance(&self) -> bool {
        self.maintenance.load(Ordering::SeqCst)
    }
}

impl StoreBackend for sqlite::SqliteStore {
    fn kind(&self) -> &'static str {
        "sqlite-v2"
    }

    fn root(&self) -> &Path {
        self.root_path()
    }

    fn put(&self, table: &str, row: &Value) -> Result<(), String> {
        sqlite::SqliteStore::put(self, table, row)
    }

    fn bulk_put(&self, table: &str, rows: &[Value]) -> Result<(), String> {
        sqlite::SqliteStore::bulk_put(self, table, rows)
    }

    fn delete(&self, table: &str, id: &str) -> Result<(), String> {
        sqlite::SqliteStore::delete(self, table, id)
    }

    fn transaction(&self, ops: Vec<TxOp>) -> Result<(), String> {
        let ops = ops
            .into_iter()
            .map(|op| match op {
                TxOp::Put { table, row } => sqlite::SqliteOp::Put { table, row },
                TxOp::BulkPut { table, rows } => sqlite::SqliteOp::BulkPut { table, rows },
                TxOp::Delete { table, id } => sqlite::SqliteOp::Delete { table, id },
            })
            .collect::<Vec<_>>();
        sqlite::SqliteStore::transaction(self, &ops)
    }

    fn query(
        &self,
        table: &str,
        filter: &Map<String, Value>,
        include_payload: bool,
        fields: Option<&str>,
    ) -> Result<Vec<Value>, String> {
        sqlite::SqliteStore::query(self, table, filter, include_payload, fields)
    }

    fn query_page(
        &self,
        table: &str,
        filter: &Map<String, Value>,
        page: &PageQuery,
    ) -> Result<(Vec<Value>, u64), String> {
        sqlite::SqliteStore::query_page(self, table, filter, page)
    }

    fn scan_page(
        &self,
        table: &str,
        offset: usize,
        limit: usize,
        include_payload: bool,
    ) -> Result<(Vec<Value>, u64), String> {
        sqlite::SqliteStore::scan_page(self, table, offset, limit, include_payload)
    }

    fn usage(&self) -> u64 {
        sqlite::SqliteStore::usage(self)
    }

    fn kv_get(&self, key: &str) -> Result<Value, String> {
        sqlite::SqliteStore::kv_get(self, key)
    }

    fn kv_put(&self, key: &str, value: &Value) -> Result<(), String> {
        sqlite::SqliteStore::kv_put(self, key, value)
    }

    fn kv_delete(&self, key: &str) -> Result<(), String> {
        sqlite::SqliteStore::kv_delete(self, key)
    }

    fn asset_bytes(&self, id: &str) -> Result<(Vec<u8>, String), String> {
        sqlite::SqliteStore::asset_bytes(self, id)
    }

    fn asset_thumb(&self, id: &str) -> Result<Vec<u8>, String> {
        sqlite::SqliteStore::asset_thumb(self, id)
    }

    fn asset_preview(&self, id: &str) -> Result<Vec<u8>, String> {
        sqlite::SqliteStore::asset_preview(self, id)
    }

    fn set_maintenance(&self, enabled: bool) {
        sqlite::SqliteStore::set_maintenance(self, enabled);
    }

    fn in_maintenance(&self) -> bool {
        sqlite::SqliteStore::in_maintenance(self)
    }
}

fn select_backend(data_dir: &Path) -> Result<Arc<dyn StoreBackend>, String> {
    let requested = std::env::var("QINGHUA_STORE_BACKEND")
        .unwrap_or_else(|_| "json-v1".to_string())
        .trim()
        .to_ascii_lowercase();
    match requested.as_str() {
        "" | "json" | "json-v1" | "v1" => Ok(Arc::new(Store {
            root: Arc::new(data_dir.to_path_buf()),
            lock: Arc::new(Mutex::new(())),
            maintenance: Arc::new(AtomicBool::new(false)),
            usage_cache: Arc::new(Mutex::new(None)),
        })),
        "sqlite" | "sqlite-v2" | "v2" => Ok(Arc::new(sqlite::SqliteStore::open(data_dir)?)),
        other => Err(format!(
            "unsupported QINGHUA_STORE_BACKEND={other}; expected v1 or v2"
        )),
    }
}

fn open_backend(data_dir: &Path, requested: &str) -> Result<Arc<dyn StoreBackend>, String> {
    match requested.trim().to_ascii_lowercase().as_str() {
        "json" | "json-v1" | "v1" => Ok(Arc::new(Store {
            root: Arc::new(data_dir.to_path_buf()),
            lock: Arc::new(Mutex::new(())),
            maintenance: Arc::new(AtomicBool::new(false)),
            usage_cache: Arc::new(Mutex::new(None)),
        })),
        "sqlite" | "sqlite-v2" | "v2" => Ok(Arc::new(sqlite::SqliteStore::open(data_dir)?)),
        other => Err(format!("unsupported storage backend: {other}")),
    }
}

pub fn switch_backend(data_dir: &Path, backend: &str) -> Result<(), String> {
    let next = open_backend(data_dir, backend)?;
    let active = ACTIVE_BACKEND
        .get()
        .ok_or_else(|| "shared-store has not started".to_string())?;
    let mut guard = active
        .write()
        .map_err(|_| "shared-store backend lock poisoned".to_string())?;
    *guard = next;
    Ok(())
}

fn body_json<T: for<'de> Deserialize<'de>>(request: &mut Request) -> Result<T, String> {
    let mut raw = Vec::new();
    request
        .as_reader()
        .read_to_end(&mut raw)
        .map_err(|error| format!("read body: {error}"))?;
    serde_json::from_slice(&raw).map_err(|error| format!("parse body: {error}"))
}

fn request_header(request: &Request, name: &'static str) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|item| item.field.equiv(name))
        .map(|item| item.value.as_str().to_string())
}

fn handle(backends: Arc<RwLock<Arc<dyn StoreBackend>>>, mut request: Request) {
    let origin = request
        .headers()
        .iter()
        .find(|item| item.field.equiv("origin"))
        .map(|item| item.value.as_str().to_string());
    let path = request.url().to_string();
    if request.method() == &Method::Options {
        let _ = request.respond(
            Response::empty(StatusCode(204))
                .with_header(header("access-control-allow-methods", "GET,POST,OPTIONS"))
                .with_header(header(
                    "access-control-allow-headers",
                    "content-type, x-qinghua-token",
                ))
                .with_header(header(
                    "access-control-allow-origin",
                    origin
                        .as_deref()
                        .filter(|value| origin_allowed(value))
                        .unwrap_or("null"),
                )),
        );
        return;
    }
    let host = request_header(&request, "host");
    let content_type = request_header(&request, "content-type");
    if let Err(reason) = request_guard(
        request.method(),
        host.as_deref(),
        origin.as_deref(),
        content_type.as_deref(),
    ) {
        let _ = request.respond(
            Response::from_string(json!({ "ok": false, "error": reason }).to_string())
                .with_status_code(StatusCode(403))
                .with_header(header("content-type", "application/json; charset=utf-8"))
                .with_header(header("cache-control", "no-store")),
        );
        return;
    }
    let expected_token = AUTH_TOKEN.get().and_then(|value| value.as_deref());
    let provided_token = request_header(&request, TOKEN_HEADER);
    if let Err(reason) = token_guard(
        request.method(),
        &path,
        expected_token,
        provided_token.as_deref(),
    ) {
        let _ = respond_json(
            request,
            StatusCode(401),
            json!({ "ok": false, "error": reason }),
            origin.as_deref(),
        );
        return;
    }
    let store = backends
        .read()
        .expect("shared-store backend lock poisoned")
        .clone();

    if request.method() == &Method::Get && path.starts_with("/asset/") {
        let id = path.trim_start_matches("/asset/");
        match store.asset_bytes(id) {
            Ok((bytes, mime)) => {
                let _ = respond_bytes(request, StatusCode(200), bytes, &mime, origin.as_deref());
            }
            Err(error) => {
                let _ = respond_json(
                    request,
                    StatusCode(404),
                    json!({ "ok": false, "error": error }),
                    origin.as_deref(),
                );
            }
        }
        return;
    }
    if request.method() == &Method::Get && path.starts_with("/thumb/") {
        let id = path.trim_start_matches("/thumb/");
        match store.asset_thumb(id) {
            Ok(bytes) => {
                let _ = respond_bytes(
                    request,
                    StatusCode(200),
                    bytes,
                    "image/webp",
                    origin.as_deref(),
                );
            }
            Err(error) => {
                let _ = respond_json(
                    request,
                    StatusCode(404),
                    json!({ "ok": false, "error": error }),
                    origin.as_deref(),
                );
            }
        }
        return;
    }
    if request.method() == &Method::Get && path.starts_with("/preview/") {
        let id = path.trim_start_matches("/preview/");
        match store.asset_preview(id) {
            Ok(bytes) => {
                let _ = respond_bytes(
                    request,
                    StatusCode(200),
                    bytes,
                    "image/webp",
                    origin.as_deref(),
                );
            }
            Err(error) => {
                let _ = respond_json(
                    request,
                    StatusCode(404),
                    json!({ "ok": false, "error": error }),
                    origin.as_deref(),
                );
            }
        }
        return;
    }
    let result = (|| -> Result<Value, String> {
        if request.method() == &Method::Get && path == "/health" {
            return Ok(json!({
                "ok": true,
                "service": "qinghua-shared-store",
                "version": 8,
                "backend": store.kind(),
                "maintenance": store.in_maintenance(),
                "dataDir": store.root().to_string_lossy(),
            }));
        }
        if request.method() == &Method::Post
            && matches!(path.as_str(), "/maintenance/begin" | "/maintenance/end")
        {
            let enabled = path == "/maintenance/begin";
            store.set_maintenance(enabled);
            return Ok(json!({ "ok": true, "maintenance": enabled }));
        }
        if request.method() == &Method::Post && path == "/put" {
            let body: PutRequest = body_json(&mut request)?;
            store.put(&body.table, &body.row)?;
            return Ok(json!({ "ok": true }));
        }
        if request.method() == &Method::Post && path == "/bulkPut" {
            let body: BulkPutRequest = body_json(&mut request)?;
            store.bulk_put(&body.table, &body.rows)?;
            return Ok(json!({ "ok": true, "count": body.rows.len() }));
        }
        if request.method() == &Method::Post && path == "/delete" {
            let body: DeleteRequest = body_json(&mut request)?;
            store.delete(&body.table, &body.id)?;
            return Ok(json!({ "ok": true }));
        }
        if request.method() == &Method::Post && path == "/query" {
            let body: QueryRequest = body_json(&mut request)?;
            let rows = store.query(
                &body.table,
                &body.filter,
                body.include_payload,
                body.fields.as_deref(),
            )?;
            return Ok(json!({ "rows": rows }));
        }
        if request.method() == &Method::Post && path == "/queryPage" {
            let body: QueryPageRequest = body_json(&mut request)?;
            let (rows, total) = store.query_page(&body.table, &body.filter, &body.page)?;
            return Ok(json!({ "rows": rows, "total": total }));
        }
        if request.method() == &Method::Get && path.starts_with("/rows") {
            let url = url::Url::parse(&format!("http://127.0.0.1{path}"))
                .map_err(|error| format!("parse url: {error}"))?;
            let table = url
                .query_pairs()
                .find(|(key, _)| key == "table")
                .map(|(_, value)| value.to_string())
                .ok_or_else(|| "table query is required".to_string())?;
            let offset = url
                .query_pairs()
                .find(|(key, _)| key == "offset")
                .and_then(|(_, value)| value.parse::<usize>().ok())
                .unwrap_or(0);
            let limit = url
                .query_pairs()
                .find(|(key, _)| key == "limit")
                .and_then(|(_, value)| value.parse::<usize>().ok())
                .unwrap_or(100)
                .min(1000);
            let include_payload = url
                .query_pairs()
                .find(|(key, _)| key == "includePayload")
                .map(|(_, value)| value == "1")
                .unwrap_or(true);
            let (page, total) = store.scan_page(&table, offset, limit, include_payload)?;
            return Ok(json!({ "rows": page, "total": total }));
        }
        if request.method() == &Method::Post && path == "/tx" {
            let body: TxRequest = body_json(&mut request)?;
            store.transaction(body.ops)?;
            return Ok(json!({ "ok": true }));
        }
        if request.method() == &Method::Get && path == "/usage" {
            return Ok(json!({ "used": store.usage(), "quota": 0 }));
        }
        if request.method() == &Method::Post && path == "/kv/put" {
            let body: Map<String, Value> = body_json(&mut request)?;
            let key = body
                .get("key")
                .and_then(Value::as_str)
                .ok_or("key missing")?;
            let value = body.get("value").cloned().unwrap_or(Value::Null);
            store.kv_put(key, &value)?;
            return Ok(json!({ "ok": true }));
        }
        if request.method() == &Method::Post && path == "/kv/get" {
            let body: Map<String, Value> = body_json(&mut request)?;
            let key = body
                .get("key")
                .and_then(Value::as_str)
                .ok_or("key missing")?;
            let value = store.kv_get(key)?;
            return Ok(json!({ "value": value }));
        }
        if request.method() == &Method::Post && path == "/kv/delete" {
            let body: Map<String, Value> = body_json(&mut request)?;
            let key = body
                .get("key")
                .and_then(Value::as_str)
                .ok_or("key missing")?;
            store.kv_delete(key)?;
            return Ok(json!({ "ok": true }));
        }
        Err(format!("unknown route: {} {path}", request.method()))
    })();

    match result {
        Ok(value) => {
            let _ = respond_json(request, StatusCode(200), value, origin.as_deref());
        }
        Err(error) => {
            let _ = respond_json(
                request,
                StatusCode(400),
                json!({ "ok": false, "error": error }),
                origin.as_deref(),
            );
        }
    }
}

pub fn default_v1_data_dir() -> PathBuf {
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        return PathBuf::from(local)
            .join("com.qinghua.canvas")
            .join("shared-store-v1");
    }
    PathBuf::from("qinghua-shared-store-v1")
}

pub fn default_data_dir() -> PathBuf {
    if let Ok(custom) = std::env::var("QINGHUA_DATA_DIR") {
        let custom = custom.trim();
        if !custom.is_empty() {
            return PathBuf::from(custom);
        }
    }
    default_v1_data_dir()
}

pub fn start(data_dir: &Path, port: u16) -> Result<(), String> {
    start_with_token(data_dir, port, configured_env_token())
}

pub fn start_with_token(data_dir: &Path, port: u16, token: Option<String>) -> Result<(), String> {
    fs::create_dir_all(data_dir).map_err(|error| format!("create data dir: {error}"))?;
    let server = Arc::new(
        Server::http(("127.0.0.1", port))
            .map_err(|error| format!("start shared store on {port}: {error}"))?,
    );
    let backend = select_backend(data_dir)?;
    let normalized_token = normalize_token(token.as_deref());
    let _ = AUTH_TOKEN.set(normalized_token);
    eprintln!(
        "[shared-store] backend={} data={}",
        backend.kind(),
        backend.root().display()
    );
    let store = Arc::new(RwLock::new(backend));
    ACTIVE_BACKEND
        .set(Arc::clone(&store))
        .map_err(|_| "shared-store already started".to_string())?;
    for _ in 0..4 {
        let server = Arc::clone(&server);
        let store = Arc::clone(&store);
        thread::spawn(move || {
            while let Ok(request) = server.recv() {
                handle(store.clone(), request);
            }
        });
    }
    Ok(())
}

pub fn start_in_background() {
    start_in_background_on(PORT);
}

pub fn start_in_background_on(port: u16) {
    start_in_background_on_with_token(port, configured_env_token());
}

pub fn start_in_background_on_with_token(port: u16, token: Option<String>) {
    let _ = STARTED.get_or_init(|| {
        let data_dir = default_data_dir();
        match start_with_token(&data_dir, port, token) {
            Ok(()) => eprintln!(
                "[shared-store] http://127.0.0.1:{port} {}",
                data_dir.display()
            ),
            Err(error) => eprintln!("[shared-store] {error}"),
        }
    });
}

pub fn block_forever() {
    loop {
        thread::sleep(Duration::from_secs(3600));
    }
}

#[cfg(test)]
mod tests;
