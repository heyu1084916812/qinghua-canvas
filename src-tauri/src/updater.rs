use tauri_plugin_updater::UpdaterExt;

/// 「检查更新」后交给前端的**一份状态**（方案 §5 / 对账 #223）。
///
/// 为什么不让前端直接调 updater 的 JS API：那样"没配地址"和"网络不通"会糊成同一个异常串，
/// 界面就只能说一句含糊的"检查失败"。这里把四档说清楚，前端照着显示，不解析错误文本。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateStatus {
    /// `not-configured` / `up-to-date` / `available` / `failed`
    state: String,
    /// 装在用户机器上的版本（不是清单上的）
    current: String,
    version: Option<String>,
    notes: Option<String>,
    /// 失败时的原话：**如实回**，不吞
    error: Option<String>,
}

fn update_status(state: &str, current: String) -> UpdateStatus {
    UpdateStatus {
        state: state.into(),
        current,
        version: None,
        notes: None,
        error: None,
    }
}

fn update_failed(current: String, error: String) -> UpdateStatus {
    UpdateStatus {
        state: "failed".into(),
        current,
        version: None,
        notes: None,
        error: Some(error),
    }
}

/// 「没有配更新地址」要单独认出来（见 `check_update` 里的说明）
fn is_not_configured(err: &tauri_plugin_updater::Error) -> bool {
    matches!(err, tauri_plugin_updater::Error::EmptyEndpoints)
}

/// 检查有没有新版。
///
/// **没配更新地址时回 `not-configured`**：目标地址还没定（GitHub Releases 还是自有地址），
/// 这时不能假装"已是最新"——用户会以为自动更新在守着，其实什么都没查。
#[tauri::command]
pub(crate) async fn check_update(app: tauri::AppHandle) -> UpdateStatus {
    let current = app.package_info().version.to_string();
    // ⚠️ 更新地址为空时，**`app.updater()` 这一步就报错**（`Error::EmptyEndpoints`），
    // 根本走不到 `check()` —— 所以前后两处都要认这一档。少认一处，界面就会把
    // 「还没接完」说成「检查失败」（真机上就是这么显示的，已修）。
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(err) if is_not_configured(&err) => return update_status("not-configured", current),
        Err(err) => return update_failed(current, err.to_string()),
    };
    match updater.check().await {
        Ok(Some(update)) => UpdateStatus {
            state: "available".into(),
            current,
            version: Some(update.version.clone()),
            notes: update.body.clone(),
            error: None,
        },
        Ok(None) => update_status("up-to-date", current),
        Err(err) if is_not_configured(&err) => update_status("not-configured", current),
        Err(err) => update_failed(current, err.to_string()),
    }
}

/// 下载 → **验签**（公钥在 `tauri.conf.json`）→ 交给安装器。
///
/// Windows 上安装器一起来应用就会自己退出（NSIS 默认带 `/R` 重启），
/// 所以这里**不**再调 `app.restart()` —— 那等于把应用启动两次。
#[tauri::command]
pub(crate) async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|err| err.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "没有可用的更新".to_string())?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}
