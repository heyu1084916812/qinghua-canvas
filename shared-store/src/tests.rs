use super::*;

fn temp_root(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "qinghua-shared-store-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

#[test]
fn parse_port_uses_fallback_and_accepts_explicit_override() {
    assert_eq!(parse_port(None, PORT), Ok(PORT));
    assert_eq!(parse_port(Some("  "), 19876), Ok(19876));
    assert_eq!(parse_port(Some(" 19877 "), PORT), Ok(19877));
}

#[test]
fn parse_port_rejects_zero_and_out_of_range_values() {
    assert!(parse_port(Some("0"), PORT).is_err());
    assert!(parse_port(Some("65536"), PORT).is_err());
    assert!(parse_port(Some("not-a-port"), PORT).is_err());
}

fn exercise_backend_contract(backend: Arc<dyn StoreBackend>) {
    backend
        .put("projects", &json!({"id":"p1","name":"first","updatedAt":1}))
        .unwrap();
    backend
        .bulk_put(
            "nodes",
            &[
                json!({"id":"n1","projectId":"p1","title":"one"}),
                json!({"id":"n2","projectId":"p1","title":"two"}),
            ],
        )
        .unwrap();
    backend
        .bulk_put(
            "runRecords",
            &[
                json!({"id":"r1","projectId":"p1","createdAt":3,"workbench":"storyboard","action":"shot-image"}),
                json!({"id":"r2","projectId":"p1","createdAt":2,"workbench":"storyboard","action":"shot-image"}),
                json!({"id":"r3","projectId":"p1","createdAt":1,"workbench":"storyboard","action":"speech"}),
            ],
        )
        .unwrap();

    let projects = backend
        .query(
            "projects",
            &Map::from_iter([("id".into(), json!("p1"))]),
            false,
            Some("id,name"),
        )
        .unwrap();
    assert_eq!(projects, vec![json!({"id":"p1","name":"first"})]);
    let (nodes, total) = backend.scan_page("nodes", 0, 1, false).unwrap();
    assert_eq!(total, 2);
    assert_eq!(nodes.len(), 1);
    let (records, total) = backend
        .query_page(
            "runRecords",
            &Map::from_iter([
                ("projectId".into(), json!("p1")),
                ("workbench".into(), json!("storyboard")),
                ("action".into(), json!("shot-image")),
            ]),
            &PageQuery {
                ids: Vec::new(),
                missing_fields: Vec::new(),
                ranges: Vec::new(),
                order_by: Some(PageOrder {
                    field: "createdAt".into(),
                    direction: Some("desc".into()),
                }),
                offset: 1,
                limit: 1,
                include_payload: true,
                fields: None,
            },
        )
        .unwrap();
    assert_eq!(total, 2);
    assert_eq!(records.len(), 1);
    assert_eq!(records[0]["id"], json!("r2"));

    backend.kv_put("theme", &json!({"mode":"dark"})).unwrap();
    assert_eq!(backend.kv_get("theme").unwrap(), json!({"mode":"dark"}));
    backend.kv_delete("theme").unwrap();
    assert_eq!(backend.kv_get("theme").unwrap(), Value::Null);

    backend
        .transaction(vec![
            TxOp::Put {
                table: "projects".into(),
                row: json!({"id":"p1","name":"updated"}),
            },
            TxOp::Put {
                table: "nodes".into(),
                row: json!({"id":"n3","projectId":"p1","title":"three"}),
            },
        ])
        .unwrap();
    assert_eq!(
        backend
            .query(
                "projects",
                &Map::from_iter([("id".into(), json!("p1"))]),
                false,
                None,
            )
            .unwrap()[0]["name"],
        json!("updated")
    );

    let bytes = b"backend parity asset";
    let hash = crate::hash::sha1_hex(bytes)[..16].to_string();
    backend
        .put(
            "assets",
            &json!({
                "id":hash,
                "mime":"image/png",
                "bytes":{
                    "__qhType":"u8",
                    "base64":base64::engine::general_purpose::STANDARD.encode(bytes)
                }
            }),
        )
        .unwrap();
    assert_eq!(backend.asset_bytes(&hash).unwrap().0, bytes);
}

#[test]
fn json_and_sqlite_backends_share_the_storage_contract() {
    let json_root = temp_root("contract-json");
    exercise_backend_contract(Arc::new(Store {
        root: Arc::new(json_root.clone()),
        lock: Arc::new(Mutex::new(())),
        maintenance: Arc::new(AtomicBool::new(false)),
        usage_cache: Arc::new(Mutex::new(None)),
    }));
    let _ = fs::remove_dir_all(json_root);

    let sqlite_root = temp_root("contract-sqlite");
    exercise_backend_contract(Arc::new(sqlite::SqliteStore::open(&sqlite_root).unwrap()));
    let _ = fs::remove_dir_all(sqlite_root);
}

#[test]
fn maintenance_mode_blocks_new_writes_until_released() {
    let root = temp_root("maintenance");
    let store = Store {
        root: Arc::new(root.clone()),
        lock: Arc::new(Mutex::new(())),
        maintenance: Arc::new(AtomicBool::new(false)),
        usage_cache: Arc::new(Mutex::new(None)),
    };
    store
        .put("projects", &json!({"id":"p1","name":"before"}))
        .unwrap();
    store.set_maintenance(true);
    assert!(store.in_maintenance());
    assert!(store
        .put("projects", &json!({"id":"p2","name":"blocked"}))
        .unwrap_err()
        .contains("maintenance"));
    assert_eq!(
        store
            .query(
                "projects",
                &Map::from_iter([("id".into(), json!("p2"))]),
                false,
                None,
            )
            .unwrap()
            .len(),
        0
    );
    store.set_maintenance(false);
    store
        .put("projects", &json!({"id":"p3","name":"after"}))
        .unwrap();
    let _ = fs::remove_dir_all(root);
}

#[test]
fn put_query_delete_roundtrip() {
    let root = temp_root("roundtrip");
    let row = json!({ "id": "p1", "name": "项目一", "updatedAt": 1 });
    write_row(&root, "projects", &row).unwrap();
    assert_eq!(
        query_rows(
            &root,
            "projects",
            &Map::from_iter([("id".to_string(), Value::String("p1".to_string()))])
        )
        .unwrap(),
        vec![row.clone()]
    );
    delete_row(&root, "projects", "p1").unwrap();
    assert!(query_rows(&root, "projects", &Map::new())
        .unwrap()
        .is_empty());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn project_folders_table_is_available() {
    let root = temp_root("project-folders");
    let row = json!({ "id": "f1", "name": "客户项目", "updatedAt": 1 });
    write_row(&root, "projectFolders", &row).unwrap();
    assert_eq!(
        query_rows(
            &root,
            "projectFolders",
            &Map::from_iter([("id".to_string(), Value::String("f1".to_string()))])
        )
        .unwrap(),
        vec![row]
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn context_tables_are_available() {
    let root = temp_root("context-tables");
    let rows = [
        ("contextMemories", json!({ "id": "m1", "text": "偏好留白" })),
        (
            "contextMemoryRevisions",
            json!({ "id": "mr1", "memoryId": "m1", "revision": 1 }),
        ),
        (
            "contextKits",
            json!({ "id": "k1", "kind": "brand", "currentVersion": 1 }),
        ),
        (
            "contextKitVersions",
            json!({ "id": "kv1", "kitId": "k1", "version": 1 }),
        ),
        (
            "projectContextBindings",
            json!({ "id": "b1", "projectId": "p1", "kitId": "k1", "kitVersion": 1 }),
        ),
        (
            "referenceItems",
            json!({ "id": "r1", "projectId": "p1", "kind": "image", "what": "Logo" }),
        ),
        (
            "referenceUsages",
            json!({ "id": "u1", "itemId": "r1", "projectId": "p1", "taskKey": "kv", "usage": "identityAnchor" }),
        ),
    ];
    for (table, row) in rows {
        write_row(&root, table, &row).unwrap();
        let id = row.get("id").unwrap().as_str().unwrap().to_string();
        assert_eq!(
            query_rows(
                &root,
                table,
                &Map::from_iter([("id".to_string(), Value::String(id))])
            )
            .unwrap(),
            vec![row]
        );
    }
    let _ = fs::remove_dir_all(root);
}

#[test]
fn agent_message_table_filters_by_session() {
    let root = temp_root("agent-messages");
    let row = json!({
        "id": "chat-1::message::000000",
        "projectId": "p1",
        "sessionId": "chat-1",
        "sequence": 0,
        "message": { "role": "user", "content": "hello" },
        "updatedAt": 1
    });
    write_row(&root, "agentMessages", &row).unwrap();
    assert_eq!(
        query_rows(
            &root,
            "agentMessages",
            &Map::from_iter([("sessionId".to_string(), Value::String("chat-1".to_string()))])
        )
        .unwrap(),
        vec![row]
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn asset_save_queue_table_is_available() {
    let root = temp_root("asset-save-queue");
    let row = json!({
        "id": "result-1",
        "projectId": "p1",
        "resultId": "result-1",
        "assets": [{
            "hash": "hash-1",
            "mime": "image/png",
            "bytes": { "__qhType": "u8", "base64": "AQID" }
        }],
        "createdAt": 1
    });
    write_row(&root, "assetSaveQueue", &row).unwrap();
    assert_eq!(
        query_rows(
            &root,
            "assetSaveQueue",
            &Map::from_iter([(
                "resultId".to_string(),
                Value::String("result-1".to_string())
            )])
        )
        .unwrap(),
        vec![row]
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn transaction_rolls_back_partial_write() {
    let root = temp_root("rollback");
    let original = json!({ "id": "p1", "name": "原值" });
    write_row(&root, "projects", &original).unwrap();
    let error = apply_tx(
        &root,
        TxRequest {
            ops: vec![
                TxOp::Put {
                    table: "projects".to_string(),
                    row: json!({ "id": "p1", "name": "新值" }),
                },
                TxOp::Put {
                    table: "projects".to_string(),
                    row: json!({ "name": "缺 id" }),
                },
            ],
        },
    )
    .unwrap_err();
    assert!(error.contains("id"));
    let rows = list_rows(&root, "projects").unwrap();
    assert_eq!(rows, vec![original]);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn metadata_projection_removes_binary_but_keeps_length() {
    let mut row = json!({
        "id": "a1",
        "mime": "image/png",
        "bytes": {
            "__qhType": "u8",
            "base64": "AQIDBA=="
        },
        "thumb": {
            "__qhType": "u8",
            "base64": "AQID"
        },
        "preview": {
            "__qhType": "u8",
            "base64": "AQIDBA=="
        }
    });
    strip_payload(&mut row);
    assert!(row.get("bytes").is_none());
    assert!(row.get("thumb").is_none());
    assert!(row.get("preview").is_none());
    assert_eq!(row.get("bytesLength").and_then(Value::as_u64), Some(4));
    assert_eq!(row.get("previewLength").and_then(Value::as_u64), Some(4));
    project_fields(&mut row, Some("id,mime,bytesLength"));
    assert_eq!(
        row,
        json!({ "id": "a1", "mime": "image/png", "bytesLength": 4 })
    );
}

#[test]
fn metadata_projection_keeps_business_data_objects() {
    let mut row = json!({
        "id": "n1",
        "type": "generation",
        "data": {
            "channelId": "ch-1",
            "model": "image-model"
        }
    });
    strip_payload(&mut row);
    assert_eq!(
        row.get("data"),
        Some(&json!({
            "channelId": "ch-1",
            "model": "image-model"
        }))
    );
}

#[test]
fn row_page_lists_only_the_requested_file_slice() {
    let root = temp_root("page");
    for id in ["a", "b", "c"] {
        write_row(&root, "projects", &json!({ "id": id })).unwrap();
    }
    let files = row_files(&root, "projects").unwrap();
    assert_eq!(files.len(), 3);
    let page = files
        .into_iter()
        .skip(1)
        .take(1)
        .map(|file| read_json(&file).unwrap())
        .collect::<Vec<_>>();
    assert_eq!(page, vec![json!({ "id": "b" })]);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn asset_metadata_sidecars_are_not_listed_as_rows() {
    let root = temp_root("asset-sidecar");
    let row = json!({
        "id": "a1",
        "mime": "image/png",
        "bytes": {
            "__qhType": "u8",
            "base64": "AQIDBA=="
        }
    });
    write_row(&root, "assets", &row).unwrap();

    let files = row_files(&root, "assets").unwrap();
    assert_eq!(files, vec![row_path(&root, "assets", "a1").unwrap()]);
    assert_eq!(list_rows(&root, "assets").unwrap(), vec![row]);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn local_asset_endpoint_payload_returns_raw_bytes_and_mime() {
    let root = temp_root("asset-bytes");
    let row = json!({
        "id": "a1",
        "mime": "image/png",
        "bytes": {
            "__qhType": "u8",
            "base64": "AQIDBA=="
        }
    });
    write_row(&root, "assets", &row).unwrap();
    let (bytes, mime) = load_asset(&root, "a1").unwrap();
    assert_eq!(bytes, vec![1, 2, 3, 4]);
    assert_eq!(mime, "image/png");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn usage_reflects_writes_and_deletes_after_cache() {
    let root = temp_root("usage-cache");
    let store = Store {
        root: Arc::new(root.clone()),
        lock: Arc::new(Mutex::new(())),
        maintenance: Arc::new(AtomicBool::new(false)),
        usage_cache: Arc::new(Mutex::new(None)),
    };

    assert_eq!(store.usage(), 0);

    store
        .put("projects", &json!({"id":"p1","name":"one"}))
        .unwrap();
    let after_one = store.usage();
    assert!(after_one > 0);

    store
        .put("projects", &json!({"id":"p2","name":"two is longer"}))
        .unwrap();
    let after_two = store.usage();
    assert!(after_two > after_one, "usage must not be stale after write");

    store.delete("projects", "p2").unwrap();
    assert!(store.usage() < after_two, "usage must drop after delete");

    store
        .bulk_put("projects", &[json!({"id":"p3","name":"three"})])
        .unwrap();
    assert!(store.usage() > 0);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn cached_usage_survives_lazy_thumbnail_read() {
    let root = temp_root("usage-thumbnail-cache");
    let store = Store {
        root: Arc::new(root.clone()),
        lock: Arc::new(Mutex::new(())),
        maintenance: Arc::new(AtomicBool::new(false)),
        usage_cache: Arc::new(Mutex::new(None)),
    };

    let thumb = b"thumbnail-bytes";
    let hash = crate::hash::sha1_hex(thumb)[..16].to_string();
    store
        .put(
            "assets",
            &json!({
                "id": hash,
                "mime": "image/webp",
                "thumb": {
                    "__qhType": "u8",
                    "base64": base64::engine::general_purpose::STANDARD.encode(thumb)
                }
            }),
        )
        .unwrap();

    *store.usage_cache.lock().unwrap() = None;
    assert_eq!(store.asset_thumb(&hash).unwrap(), thumb.to_vec());
    let after_read = usage(&root).used;
    assert!(after_read > 0);
    *store.usage_cache.lock().unwrap() = Some(after_read);
    assert_eq!(store.usage(), after_read);

    assert_eq!(store.asset_thumb(&hash).unwrap(), thumb.to_vec());
    assert_eq!(store.usage(), after_read);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn query_page_total_filter_order_offset_and_limit() {
    let root = temp_root("query-page-semantics");
    let store = Store {
        root: Arc::new(root.clone()),
        lock: Arc::new(Mutex::new(())),
        maintenance: Arc::new(AtomicBool::new(false)),
        usage_cache: Arc::new(Mutex::new(None)),
    };

    for id in ["a", "b", "c", "d", "e"] {
        store
            .put(
                "projects",
                &json!({"id": id, "kind": "alpha", "updatedAt": 1}),
            )
            .unwrap();
    }
    store
        .put("projects", &json!({"id":"f","kind":"beta","updatedAt":2}))
        .unwrap();

    let page = PageQuery {
        ids: vec![],
        missing_fields: vec![],
        ranges: vec![],
        order_by: Some(PageOrder {
            field: "id".into(),
            direction: Some("desc".into()),
        }),
        offset: 1,
        limit: 2,
        include_payload: true,
        fields: None,
    };
    let (rows, total) = store
        .query_page(
            "projects",
            &Map::from_iter([("kind".into(), json!("alpha"))]),
            &page,
        )
        .unwrap();
    assert_eq!(total, 5, "total is filtered count, not page count");
    assert_eq!(
        rows.iter().map(|r| r["id"].clone()).collect::<Vec<_>>(),
        vec![json!("d"), json!("c")]
    );

    let page_asc = PageQuery {
        order_by: Some(PageOrder {
            field: "id".into(),
            direction: Some("asc".into()),
        }),
        ..page.clone()
    };
    let (rows, total) = store
        .query_page("projects", &Map::new(), &page_asc)
        .unwrap();
    assert_eq!(total, 6);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["id"], json!("b"));

    let page_empty = PageQuery {
        offset: 0,
        ..page.clone()
    };
    let (rows, total) = store
        .query_page(
            "projects",
            &Map::from_iter([("kind".into(), json!("none"))]),
            &page_empty,
        )
        .unwrap();
    assert_eq!(total, 0);
    assert!(rows.is_empty());

    let empty_root = temp_root("query-page-empty");
    let empty_store = Store {
        root: Arc::new(empty_root.clone()),
        lock: Arc::new(Mutex::new(())),
        maintenance: Arc::new(AtomicBool::new(false)),
        usage_cache: Arc::new(Mutex::new(None)),
    };
    let (rows, total) = empty_store
        .query_page("projects", &Map::new(), &page_empty)
        .unwrap();
    assert_eq!(total, 0);
    assert!(rows.is_empty());
    let _ = fs::remove_dir_all(root);
    let _ = fs::remove_dir_all(empty_root);
}

#[test]
fn read_retries_across_atomic_replace_window() {
    let root = temp_root("replace-window");
    fs::create_dir_all(&root).unwrap();
    let path = root.join("row.json");
    let writer_path = path.clone();
    let writer = thread::spawn(move || {
        thread::sleep(Duration::from_millis(30));
        fs::write(writer_path, br#"{"id":"a1"}"#).unwrap();
    });

    assert_eq!(read_json(&path).unwrap(), json!({ "id": "a1" }));
    writer.join().unwrap();
    let _ = fs::remove_dir_all(root);
}

#[test]
fn concurrent_atomic_writes_leave_a_valid_row() {
    let root = temp_root("concurrent-write");
    fs::create_dir_all(&root).unwrap();
    let path = root.join("row.json");
    let mut handles = Vec::new();
    for writer in 0..8 {
        let path = path.clone();
        handles.push(thread::spawn(move || {
            for sequence in 0..10 {
                let payload = format!(r#"{{"id":"{writer}-{sequence}"}}"#);
                write_atomic(&path, payload.as_bytes()).unwrap();
            }
        }));
    }
    for handle in handles {
        handle.join().unwrap();
    }
    assert!(read_json(&path).unwrap().get("id").is_some());
    assert!(fs::read_dir(&root)
        .unwrap()
        .flatten()
        .all(|entry| !entry.file_name().to_string_lossy().ends_with(".tmp")));
    let _ = fs::remove_dir_all(root);
}
