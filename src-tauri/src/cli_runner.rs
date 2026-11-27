use crate::{current_data_dir, lower, SharedStoreRuntime};
use std::path::{Path, PathBuf};
use tauri::path::BaseDirectory;
use tauri::Manager;

//
// 用户原话：「……能用里面的额度调用模型生成图片或者视频，或者对话，runninghub 也要，
// 需要真的能跑本机的 cli」。
//
// **安全边界**（写在这里，免得以后被"顺手改成 shell 更灵活"）：
// 走 `Command::new(program).args(args)`，**不经过 shell**（没有 `cmd /c`、没有 `sh -c`），
// 参数是数组、不拼字符串 ⇒ 命令注入不成立。命令由**用户自己**在设置里填 ——
// 那等价于他自己开一个终端，这正是他要的能力；壳这边不额外加白名单，也不替他拼字符串。
//
// **一次调用拿到什么**：退出码 / stdout / stderr / 是否超时 / 是否被取消 / 耗时。
// 没有"假装成功"这一档：起不来就是 `Err`，跑起来退码非零就如实回 `code`。

/// 一次 CLI 调用的结果。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CliOutcome {
    /// 退出码。被信号杀掉、或系统没给码时为 `None`
    code: Option<i32>,
    stdout: String,
    stderr: String,
    timed_out: bool,
    /// 被 `cli_kill` 主动掐掉的（用户点了"停止"）
    cancelled: bool,
    ms: u64,
}

/// 单条输出（stdout / stderr 各一份）最多回传这么多字节：CLI 可能吐几百 MB。
const CLI_MAX_OUTPUT: usize = 200 * 1024;
const CLI_DEFAULT_TIMEOUT_MS: u64 = 120_000;
const CLI_MAX_TIMEOUT_MS: u64 = 30 * 60 * 1000;
const CLI_MEDIA_IMPORT_TIMEOUT_MS: u64 = 120_000;

/// 超时夹在 [1s, 30min]：`Some(0)` 会让它在下一轮轮询就被杀，比不填更糟。
fn clamp_timeout(ms: Option<u64>) -> u64 {
    ms.unwrap_or(CLI_DEFAULT_TIMEOUT_MS)
        .clamp(1_000, CLI_MAX_TIMEOUT_MS)
}

/// 只留**尾部**：CLI 的报错与结果永远在最后。
///
/// 必须按 **char 边界**裁 —— `&text[start..]` 落在字符中间会直接 panic，
/// 而这类 CLI 的输出里有中文是常态。
fn tail_of(text: String, max: usize) -> String {
    if text.len() <= max {
        return text;
    }
    let mut start = text.len() - max;
    while start < text.len() && !text.is_char_boundary(start) {
        start += 1;
    }
    format!("…（前 {} 字节已省略）\n{}", start, &text[start..])
}

/// 在 PATH 里找可执行文件。
///
/// `exists` 是注入的（单测不碰真实文件系统）；Windows 上还要按 `PATHEXT` 逐个后缀试
/// —— 用户填的往往是 `codex` 而不是 `codex.cmd`。
fn find_in_path(program: &str, path_var: &str, exists: &dyn Fn(&Path) -> bool) -> Option<PathBuf> {
    // 带路径分隔符的一律当"用户已经给全了"，**不再去 PATH 里找**
    if program.contains('/') || program.contains('\\') {
        let direct = Path::new(program);
        return if exists(direct) {
            Some(direct.to_path_buf())
        } else {
            None
        };
    }
    let mut exts: Vec<String> = vec![String::new()];
    if cfg!(windows) {
        let pathext =
            std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
        for ext in pathext.split(';').filter(|s| !s.is_empty()) {
            exts.push(ext.to_lowercase());
            exts.push(ext.to_uppercase());
        }
    }
    for dir in std::env::split_paths(path_var) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        for ext in &exts {
            let cand = dir.join(format!("{program}{ext}"));
            if exists(&cand) {
                return Some(cand);
            }
        }
    }
    None
}

/// 起子进程失败时**说人话**（用户看到的是这一句，不是 io error）。
fn describe_spawn_error(program: &str, err: std::io::Error) -> String {
    match err.kind() {
        std::io::ErrorKind::NotFound => format!(
            "找不到命令「{program}」：先在设置里确认它的命令名或完整路径，并确保它在系统 PATH 里"
        ),
        std::io::ErrorKind::PermissionDenied => format!("没有权限执行「{program}」"),
        _ => format!("启动「{program}」失败：{err}"),
    }
}

/// 正在跑的 CLI 进程。`cli_kill` 与超时都按 `id` 找它 —— 同一时刻可以有多个在跑。
#[derive(Default)]
pub(crate) struct CliRegistry(std::sync::Mutex<std::collections::HashMap<String, std::process::Child>>);

/// 可见安装 / 登录窗口。句柄仍只归壳持有，前端只拿到可等待的 id。
#[derive(Default)]
pub(crate) struct CliWindowRegistry(std::sync::Mutex<std::collections::HashMap<String, std::process::Child>>);

/// `taskkill.exe` 只能按本方持有的 `Child::id()` 终止进程树。
///
/// 刻意不提供进程名入口：`/IM` 或按名字匹配会误伤同名的其它用户进程。
#[cfg(any(windows, test))]
fn cli_child_tree_kill_args(pid: u32) -> Vec<String> {
    vec![
        "/PID".to_string(),
        pid.to_string(),
        "/T".to_string(),
        "/F".to_string(),
    ]
}

#[cfg(windows)]
fn terminate_cli_child_tree(child: &mut std::process::Child) {
    let taskkill_succeeded = std::process::Command::new("taskkill.exe")
        .args(cli_child_tree_kill_args(child.id()))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false);

    if !taskkill_succeeded {
        let _ = child.kill();
    }
    let _ = child.wait();
}

#[cfg(not(windows))]
fn terminate_cli_child_tree(child: &mut std::process::Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod cli_tests {
    use super::*;

    #[test]
    fn timeout_is_clamped_to_sane_bounds() {
        assert_eq!(clamp_timeout(None), CLI_DEFAULT_TIMEOUT_MS);
        assert_eq!(clamp_timeout(Some(0)), 1_000);
        assert_eq!(clamp_timeout(Some(999)), 1_000);
        assert_eq!(clamp_timeout(Some(5_000)), 5_000);
        assert_eq!(
            clamp_timeout(Some(CLI_MAX_TIMEOUT_MS + 1)),
            CLI_MAX_TIMEOUT_MS
        );
    }

    #[test]
    fn taskkill_arguments_target_only_the_held_pid_tree() {
        let args = cli_child_tree_kill_args(42);
        assert_eq!(args, ["/PID", "42", "/T", "/F"]);
        assert!(!args.iter().any(|arg| arg.eq_ignore_ascii_case("/IM")));
        assert!(!args.iter().any(|arg| arg.ends_with(".exe")));
    }

    #[cfg(windows)]
    #[test]
    fn windows_taskkill_terminates_the_parent_and_descendant() {
        use std::io::Read;
        use std::time::{Duration, Instant};

        let marker = std::env::temp_dir().join(format!(
            "qinghua-cli-tree-{}-{}.pid",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let mut helper = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "cli_runner::cli_tests::windows_taskkill_process_tree_helper",
                "--nocapture",
            ])
            .env("QINGHUA_CLI_TREE_HELPER", "1")
            .env("QINGHUA_CLI_TREE_MARKER", &marker)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("启动测试辅助进程失败");

        let descendant_pid = {
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                if let Ok(text) = std::fs::read_to_string(&marker) {
                    if let Ok(pid) = text.trim().parse::<u32>() {
                        break pid;
                    }
                }
                if let Some(status) = helper.try_wait().unwrap() {
                    let mut stderr = String::new();
                    if let Some(pipe) = helper.stderr.as_mut() {
                        let _ = pipe.read_to_string(&mut stderr);
                    }
                    panic!("测试辅助进程提前退出（{status}）：{stderr}");
                }
                if Instant::now() >= deadline {
                    terminate_cli_child_tree(&mut helper);
                    let _ = std::fs::remove_file(&marker);
                    panic!("等待测试辅助进程写出子进程 PID 超时");
                }
                std::thread::sleep(Duration::from_millis(25));
            }
        };

        terminate_cli_child_tree(&mut helper);
        let descendant_stopped = wait_for_test_pid_exit(descendant_pid, Duration::from_secs(3));
        if !descendant_stopped {
            cleanup_test_pid(descendant_pid);
        }
        let _ = std::fs::remove_file(&marker);

        assert!(
            descendant_stopped,
            "父进程被终止后，子进程 {descendant_pid} 仍然存活"
        );
    }

    #[cfg(windows)]
    #[test]
    fn cli_window_wait_returns_exit_code_and_removes_handle() {
        let windows = CliWindowRegistry::default();
        let child = std::process::Command::new("cmd.exe")
            .args(["/C", "exit 7"])
            .spawn()
            .expect("启动测试窗口进程失败");
        windows
            .0
            .lock()
            .expect("测试窗口表锁失败")
            .insert("test-window".to_string(), child);

        assert_eq!(
            wait_for_cli_window(&windows, "test-window").expect("等待测试窗口失败"),
            Some(7)
        );
        assert!(wait_for_cli_window(&windows, "test-window").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn windows_taskkill_process_tree_helper() {
        use std::io::Write;
        use std::time::Duration;

        if std::env::var_os("QINGHUA_CLI_TREE_HELPER").is_none() {
            return;
        }
        let marker =
            std::env::var_os("QINGHUA_CLI_TREE_MARKER").expect("测试辅助进程缺少 PID 标记文件路径");
        let descendant = std::process::Command::new("ping.exe")
            .args(["-n", "60", "127.0.0.1"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("启动无害子进程失败");
        let descendant_pid = descendant.id();
        let marker_result = std::fs::File::create(marker).and_then(|mut marker_file| {
            write!(marker_file, "{descendant_pid}")?;
            marker_file.flush()
        });
        if let Err(err) = marker_result {
            let mut descendant = descendant;
            let _ = descendant.kill();
            let _ = descendant.wait();
            panic!("写入 PID 标记失败：{err}");
        }

        loop {
            std::thread::sleep(Duration::from_secs(1));
        }
    }

    #[cfg(windows)]
    fn wait_for_test_pid_exit(pid: u32, timeout: std::time::Duration) -> bool {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            if !test_process_is_running(pid) {
                return true;
            }
            if std::time::Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }

    #[cfg(windows)]
    fn test_process_is_running(pid: u32) -> bool {
        let output = std::process::Command::new("tasklist.exe")
            .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
            .output()
            .expect("查询测试子进程状态失败");
        String::from_utf8_lossy(&output.stdout).contains(&format!("\"{pid}\""))
    }

    #[cfg(windows)]
    fn cleanup_test_pid(pid: u32) {
        let _ = std::process::Command::new("taskkill.exe")
            .args(cli_child_tree_kill_args(pid))
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
        let _ = wait_for_test_pid_exit(pid, std::time::Duration::from_secs(2));
    }

    #[test]
    fn tail_keeps_the_end_and_never_splits_a_char() {
        let short = "abc".to_string();
        assert_eq!(tail_of(short.clone(), 16), short);
        // 64 个汉字 = 192 字节，从 (len - 10) 起必然落在某个汉字中间
        let text = "汉".repeat(64);
        let cut = tail_of(text, 10);
        assert!(cut.starts_with("…（前 "));
        assert!(cut.ends_with('汉'));
        let tail = cut.split('\n').nth(1).unwrap();
        assert!(tail.len() <= 10, "尾部实际长度 {}", tail.len());
    }

    #[test]
    fn path_with_separator_is_never_searched_in_path() {
        let hits = |p: &Path| p.to_string_lossy().contains("tools");
        assert!(find_in_path(r"C:\tools\a.exe", "", &hits).is_some());
        assert!(find_in_path("/opt/tools/a", "/nope", &hits).is_some());
        assert!(find_in_path("/opt/tools/a", "/nope", &|_| false).is_none());
    }

    #[cfg(windows)]
    #[test]
    fn finds_executable_by_pathext_extension() {
        let hit = |p: &Path| {
            // 目录也要判：只认文件名的话 `C:\missing\tool.exe` 也会被当成"存在"
            p.to_string_lossy().to_lowercase().contains(r"c:\bin")
                && p.file_name()
                    .map(|n| n.to_string_lossy().to_lowercase())
                    .unwrap_or_default()
                    == "tool.exe"
        };
        let found = find_in_path("tool", r"C:\missing;C:\bin", &hit);
        assert_eq!(
            found.map(|p| p.to_string_lossy().to_string()),
            Some(r"C:\bin\tool.exe".to_string())
        );
        assert!(find_in_path("nope", r"C:\bin", &hit).is_none());
    }
}

fn bundled_program_relative(program: &str) -> Option<PathBuf> {
    if program.eq_ignore_ascii_case("ffmpeg") {
        Some(PathBuf::from("resources").join("ffmpeg.exe"))
    } else {
        None
    }
}

fn bundled_program_path(app: &tauri::AppHandle, program: &str) -> Option<PathBuf> {
    let relative = bundled_program_relative(program)?;
    if let Ok(path) = app.path().resolve(&relative, BaseDirectory::Resource) {
        if path.is_file() {
            return Some(path);
        }
    }
    #[cfg(debug_assertions)]
    {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative);
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

/// 「这个命令到底能不能跑」——只看文件在不在，**不执行任何东西**。
#[tauri::command]
pub(crate) fn cli_which(app: tauri::AppHandle, program: String) -> Option<String> {
    if let Some(path) = bundled_program_path(&app, &program) {
        return Some(path.to_string_lossy().to_string());
    }
    let path_var = std::env::var("PATH").unwrap_or_default();
    find_in_path(&program, &path_var, &|p| p.is_file()).map(|p| p.to_string_lossy().to_string())
}

/// 真的跑一条命令。**异步**：耗时可到 30 分钟，不能占着 IPC 线程。
#[tauri::command]
pub(crate) async fn cli_run(
    app: tauri::AppHandle,
    id: String,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    stdin: Option<String>,
) -> Result<CliOutcome, String> {
    // 阻塞式的 `spawn` + 轮询放到阻塞线程池：直接写在 async 命令里会占住运行时线程，
    // 期间别的 IPC 都得排队。
    tauri::async_runtime::spawn_blocking(move || {
        run_cli_blocking(app, id, program, args, cwd, timeout_ms, stdin)
    })
    .await
    .map_err(|err| format!("CLI 任务没能跑起来：{err}"))?
}

/// 掐掉一条正在跑的命令（用户点"停止"）。找不到 = 它已经自己结束了 ⇒ 返回 false。
#[tauri::command]
pub(crate) fn cli_kill(app: tauri::AppHandle, id: String) -> bool {
    let registry = app.state::<CliRegistry>();
    let Ok(mut map) = registry.0.lock() else {
        return false;
    };
    match map.remove(&id) {
        Some(mut child) => {
            terminate_cli_child_tree(&mut child);
            true
        }
        None => false,
    }
}

/// 在一个**可见的控制台窗口**里跑命令 —— 给"一键登录"用（用户 2026-10-06 第 13 批第 2 条：
/// 「我希望是我一键设置，然后输入密码或者其他的就可以保持登录」）。
///
/// 与 `cli_run` 的三点不同，每一点都是有意为之：
/// 1. **要一个自己的窗口**（`CREATE_NEW_CONSOLE`）—— 登录要么在浏览器里点授权、要么在终端里
///    输密码，而我们的 `cli_run` 恰恰是 `CREATE_NO_WINDOW`（不弹框）。这里反过来；
/// 2. **不捕获输出** —— 输出是给用户看的，不是给我们解析的；
/// 3. **不等待它结束** —— 交互登录没有"跑完"这一说（用户可能几分钟后才点完授权），
///    等它只会把界面卡住。所以这个命令**立刻返回**，用户在那个窗口里自己完成登录。
///
/// 安全边界与 `cli_run` **完全一致**：`Command::new(program).args(args)`、不过 shell、
/// 参数是数组 ⇒ 命令注入不成立；命令与参数都是用户在设置里填的。
#[tauri::command]
pub(crate) fn cli_spawn_window(
    windows: tauri::State<CliWindowRegistry>,
    id: String,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    use std::process::Command;

    let mut map = windows
        .0
        .lock()
        .map_err(|_| "CLI 窗口表被上一次崩溃污染了，请重启应用".to_string())?;
    if map.contains_key(&id) {
        return Err(format!("CLI 窗口 id 已存在：{id}"));
    }
    let mut cmd = Command::new(&program);
    cmd.args(&args);
    if let Some(dir) = cwd.as_deref().filter(|d| !d.is_empty()) {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // 0x0000_0010 = CREATE_NEW_CONSOLE：**故意**给它一个可见窗口（见上面的说明）。
        // 注意别顺手加上 0x0800_0000（CREATE_NO_WINDOW）—— 两个标志一起加就等于又藏起来了。
        cmd.creation_flags(0x0000_0010);
    }
    let child = cmd
        .spawn()
        .map_err(|err| describe_spawn_error(&program, err))?;
    map.insert(id, child);
    Ok(())
}

fn wait_for_cli_window(
    windows: &CliWindowRegistry,
    id: &str,
) -> Result<Option<i32>, String> {
    loop {
        let status = {
            let mut map = windows
                .0
                .lock()
                .map_err(|_| "CLI 窗口表被上一次崩溃污染了，请重启应用".to_string())?;
            let Some(child) = map.get_mut(id) else {
                return Err(format!("CLI 窗口已不存在：{id}"));
            };
            let status = child
                .try_wait()
                .map_err(|err| format!("读取 CLI 窗口状态失败：{err}"))?;
            if status.is_some() {
                map.remove(id);
            }
            status
        };
        if let Some(status) = status {
            return Ok(status.code());
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

#[tauri::command]
pub(crate) async fn cli_wait_window(app: tauri::AppHandle, id: String) -> Result<Option<i32>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        wait_for_cli_window(&app.state::<CliWindowRegistry>(), &id)
    })
    .await
    .map_err(|err| format!("等待 CLI 窗口失败：{err}"))?
}

fn run_cli_blocking(
    app: tauri::AppHandle,
    id: String,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    stdin: Option<String>,
) -> Result<CliOutcome, String> {
    use std::io::Read;
    use std::process::{Command, Stdio};

    /// 一轮轮询的结论（写成枚举是为了**先出借用块再动 map**，见下面的两段式）
    enum Poll {
        Running,
        Exited(Option<i32>),
        /// 表里已经没有它 = 被 `cli_kill` 拿走并杀掉了
        Gone,
        Broken(String),
    }

    let started = std::time::Instant::now();
    let timeout = clamp_timeout(timeout_ms);

    let mut cmd = Command::new(&program);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // 没有 stdin 就不给管道：给了却不写，CLI 会一直等输入（"卡住"的经典成因）
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        });
    if let Some(dir) = cwd.as_deref().filter(|d| !d.is_empty()) {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW：别为一次调用弹一个黑框（会闪一下还抢焦点）
        cmd.creation_flags(0x0800_0000);
    }

    let mut child = cmd
        .spawn()
        .map_err(|err| describe_spawn_error(&program, err))?;

    if let Some(text) = stdin {
        if let Some(mut pipe) = child.stdin.take() {
            use std::io::Write;
            // 写完就出作用域 ⇒ 管道被 drop。**必须** drop，否则 CLI 一直等输入
            let _ = pipe.write_all(text.as_bytes());
        }
    }

    // 两条读管道**必须先被读走**：管道缓冲写满后子进程会卡在 write 上，
    // 而我们正等着它退出 ⇒ 两边互相等，死锁。所以各起一个线程读到底。
    let mut out_pipe = child.stdout.take();
    let mut err_pipe = child.stderr.take();
    let out_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(pipe) = out_pipe.as_mut() {
            let _ = pipe.read_to_end(&mut buf);
        }
        buf
    });
    let err_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(pipe) = err_pipe.as_mut() {
            let _ = pipe.read_to_end(&mut buf);
        }
        buf
    });

    // 登记进来，`cli_kill` 才找得到它
    {
        let registry = app.state::<CliRegistry>();
        let mut map = registry
            .0
            .lock()
            .map_err(|_| "CLI 进程表被上一次崩溃污染了，请重启应用".to_string())?;
        map.insert(id.clone(), child);
    }

    let mut code: Option<i32> = None;
    let mut timed_out = false;
    let mut cancelled = false;

    loop {
        // 两段式：第一个块里只"问状态"并把结论带出来，出了块才动 `map`
        // （在 `get_mut` 的借用里再 `remove` 会被借用检查拦住）
        let poll = {
            let registry = app.state::<CliRegistry>();
            let mut map = match registry.0.lock() {
                Ok(map) => map,
                Err(_) => return Err("CLI 进程表被上一次崩溃污染了，请重启应用".to_string()),
            };
            let mut exit: Option<std::process::ExitStatus> = None;
            let mut broken: Option<String> = None;
            let mut gone = false;
            match map.get_mut(&id) {
                None => gone = true,
                Some(child) => match child.try_wait() {
                    Ok(status) => exit = status,
                    Err(err) => broken = Some(err.to_string()),
                },
            }
            if gone {
                Poll::Gone
            } else if let Some(message) = broken {
                if let Some(mut dead) = map.remove(&id) {
                    terminate_cli_child_tree(&mut dead);
                }
                Poll::Broken(format!("等待「{program}」结束失败：{message}"))
            } else if let Some(status) = exit {
                let exit_code = status.code();
                map.remove(&id);
                Poll::Exited(exit_code)
            } else {
                Poll::Running
            }
        };

        match poll {
            Poll::Running => {}
            Poll::Exited(exit_code) => {
                code = exit_code;
                break;
            }
            Poll::Gone => {
                // 不在了 ≠ 失败：这是用户点了"停止"
                cancelled = true;
                break;
            }
            Poll::Broken(message) => return Err(message),
        }

        if started.elapsed().as_millis() as u64 >= timeout {
            timed_out = true;
            let registry = app.state::<CliRegistry>();
            if let Ok(mut map) = registry.0.lock() {
                if let Some(mut child) = map.remove(&id) {
                    terminate_cli_child_tree(&mut child);
                }
            }
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    // 进程已退（或被掐）⇒ 写端关闭，两个读线程会把剩余输出读完返回
    let stdout = out_reader.join().unwrap_or_default();
    let stderr = err_reader.join().unwrap_or_default();

    Ok(CliOutcome {
        code,
        stdout: decode_cli_output(&stdout),
        stderr: decode_cli_output(&stderr),
        timed_out,
        cancelled,
        ms: started.elapsed().as_millis() as u64,
    })
}

/// Windows CLI 可能输出 UTF-8、带或不带 BOM 的 UTF-16、系统 ANSI/GBK，以及 ANSI 色码；
/// 一律按 UTF-8 解会把中文和彩色控制序列变成菱形乱码。
pub(crate) fn decode_cli_output(bytes: &[u8]) -> String {
    let decoded = if bytes.starts_with(&[0xFF, 0xFE]) {
        decode_utf16(&bytes[2..], true)
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        decode_utf16(&bytes[2..], false)
    } else if let Some(text) = decode_utf16_without_bom(bytes) {
        text
    } else if let Ok(utf8) = std::str::from_utf8(bytes) {
        utf8.to_string()
    } else {
        decode_windows_ansi(bytes).unwrap_or_else(|| String::from_utf8_lossy(bytes).to_string())
    };
    tail_of(clean_cli_text(&decoded), CLI_MAX_OUTPUT)
}

fn decode_utf16(bytes: &[u8], little_endian: bool) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| {
            if little_endian {
                u16::from_le_bytes([pair[0], pair[1]])
            } else {
                u16::from_be_bytes([pair[0], pair[1]])
            }
        })
        .collect();
    String::from_utf16_lossy(&units)
}

/// PowerShell / CMD 重定向时常见无 BOM 的 UTF-16LE：ASCII 字符之间夹着 NUL。
/// 只在高比例间隔 NUL 且解码没有替换符时采用，避免把普通二进制误判成文本。
fn decode_utf16_without_bom(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 4 || bytes.len() % 2 != 0 {
        return None;
    }
    let even_nul = bytes.iter().step_by(2).filter(|byte| **byte == 0).count();
    let odd_nul = bytes
        .iter()
        .skip(1)
        .step_by(2)
        .filter(|byte| **byte == 0)
        .count();
    let half = bytes.len() / 2;
    let (little_endian, nul_count) = if odd_nul >= half / 3 && even_nul <= odd_nul / 4 {
        (true, odd_nul)
    } else if even_nul >= half / 3 && odd_nul <= even_nul / 4 {
        (false, even_nul)
    } else {
        return None;
    };
    if nul_count == 0 {
        return None;
    }
    let text = decode_utf16(bytes, little_endian);
    let readable = text
        .chars()
        .filter(|ch| ch.is_ascii_graphic() || ch.is_ascii_whitespace() || !ch.is_ascii())
        .count();
    if text.contains('\u{FFFD}') || readable < 2 {
        return None;
    }
    Some(text)
}

/// 去掉 CSI / OSC 颜色序列和不可见控制符，保留换行、制表与回车。
fn clean_cli_text(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '\u{1b}' {
            i += 1;
            if i >= chars.len() {
                break;
            }
            if chars[i] == '[' {
                i += 1;
                while i < chars.len() && !('@'..='~').contains(&chars[i]) {
                    i += 1;
                }
                i += usize::from(i < chars.len());
                continue;
            }
            if chars[i] == ']' {
                i += 1;
                while i < chars.len() && chars[i] != '\u{7}' && chars[i] != '\u{1b}' {
                    i += 1;
                }
                if i < chars.len() && chars[i] == '\u{1b}' && i + 1 < chars.len() {
                    i += 2;
                } else {
                    i += usize::from(i < chars.len());
                }
                continue;
            }
            if i < chars.len() {
                i += 1;
            }
            continue;
        }
        let ch = chars[i];
        if ch == '\n' || ch == '\r' || ch == '\t' || !ch.is_control() {
            out.push(ch);
        }
        i += 1;
    }
    out
}

#[cfg(windows)]
fn decode_windows_ansi(bytes: &[u8]) -> Option<String> {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetACP() -> u32;
        fn MultiByteToWideChar(
            code_page: u32,
            flags: u32,
            multi_byte_str: *const u8,
            multi_byte_len: i32,
            wide_char_str: *mut u16,
            wide_char_len: i32,
        ) -> i32;
    }
    unsafe {
        let page = GetACP();
        let len = i32::try_from(bytes.len()).ok()?;
        let needed = MultiByteToWideChar(page, 0, bytes.as_ptr(), len, std::ptr::null_mut(), 0);
        if needed <= 0 {
            return None;
        }
        let mut wide = vec![0u16; needed as usize];
        let written = MultiByteToWideChar(
            page,
            0,
            bytes.as_ptr(),
            len,
            wide.as_mut_ptr(),
            needed,
        );
        if written <= 0 {
            return None;
        }
        wide.truncate(written as usize);
        Some(String::from_utf16_lossy(&wide))
    }
}

#[cfg(not(windows))]
fn decode_windows_ansi(_bytes: &[u8]) -> Option<String> {
    None
}

// ── 本机 CLI 的产物文件 ──
//
// 用户同一句的后半段：「**链接后能用里面的额度调用模型生成图片或者视频**，或者对话」。
// 对话只要 stdout，产物（图 / 视频）却只能落在**文件**里 —— 各家 CLI 都用 `--out <路径>`
// 这类参数。所以这一层回答两件事：给它一个能写的目录（`cli_out_dir`）、
// 把写出来的字节读回来（`cli_read_out`）。
//
// **安全边界**：`cli_read_out` 只认 `<数据目录>/cli-out/` **里面**的文件。
// 路径是前端拼的，若允许它读任意文件，这个命令就等于给页面开了一个"任意文件读取"原语
// —— 拿到那种 IPC，`%APPDATA%` 下的令牌与数据库都能被读走。
// 产物本来就只该落在这个目录，所以把范围收死：越界一律拒。

const CLI_OUT_DIR_NAME: &str = "cli-out";
const CLI_IN_DIR_NAME: &str = "cli-in";

/// 标准 base64 编码（含 `=` 补齐）。
///
/// 手写而不引依赖：整个壳只有这一个用途，而它必须与前端
/// `domain/shared/base64.ts` 的 `base64ToBytes` 精确对上（单测按 RFC 4648 的向量钉住）。
pub(crate) fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

pub(crate) fn base64_decode(text: &str) -> Result<Vec<u8>, String> {
    let clean = text.trim();
    if clean.len() % 4 != 0 {
        return Err("base64 长度不是 4 的倍数".into());
    }
    let mut out = Vec::with_capacity(clean.len() / 4 * 3);
    for chunk in clean.as_bytes().chunks_exact(4) {
        let digit = |value: u8| -> Result<u8, String> {
            match value {
                b'A'..=b'Z' => Ok(value - b'A'),
                b'a'..=b'z' => Ok(value - b'a' + 26),
                b'0'..=b'9' => Ok(value - b'0' + 52),
                b'+' => Ok(62),
                b'/' => Ok(63),
                _ => Err("base64 含非法字符".into()),
            }
        };
        if chunk[0] == b'=' || chunk[1] == b'=' {
            return Err("base64 首两位不能是填充符".into());
        }
        let a = digit(chunk[0])? as u32;
        let b = digit(chunk[1])? as u32;
        let c = if chunk[2] == b'=' {
            0
        } else {
            digit(chunk[2])? as u32
        };
        let d = if chunk[3] == b'=' {
            0
        } else {
            digit(chunk[3])? as u32
        };
        if chunk[2] == b'=' && chunk[3] != b'=' {
            return Err("base64 填充格式错误".into());
        }
        let value = (a << 18) | (b << 12) | (c << 6) | d;
        out.push(((value >> 16) & 0xff) as u8);
        if chunk[2] != b'=' {
            out.push(((value >> 8) & 0xff) as u8);
        }
        if chunk[3] != b'=' {
            out.push((value & 0xff) as u8);
        }
    }
    Ok(out)
}

/// 目标是否在根目录**里面**。
///
/// 两道关：
/// 1. **含 `..` 的一律拒** —— `Path::starts_with` 是逐段比较、**不做规范化**，
///    于是 `cli-out/../secret.txt` 会被判成"在里面"；
/// 2. 逐段比较（Windows 大小写不敏感 ⇒ 两边都小写化，`lower()` 是既有工具）。
fn is_inside(root: &Path, target: &Path) -> bool {
    if target
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return false;
    }
    let root = lower(root);
    let target = lower(target);
    target != root && target.starts_with(&root)
}

/// 产物目录：`<数据目录>/cli-out`（没有就建）。
fn cli_out_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = current_data_dir(app)
        .ok_or_else(|| "拿不到数据目录，无法给本机 CLI 准备输出位置".to_string())?
        .join(CLI_OUT_DIR_NAME);
    std::fs::create_dir_all(&dir).map_err(|err| format!("建 CLI 产物目录失败：{err}"))?;
    Ok(dir)
}

/// 给前端一个可以写产物、也允许被读回的目录（绝对路径）。
#[tauri::command]
pub(crate) fn cli_out_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(cli_out_root(&app)?.to_string_lossy().to_string())
}

/// 把 CLI 写出来的文件读回 base64（前端要把它变成素材字节）。
#[tauri::command]
pub(crate) fn cli_read_out(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let root = cli_out_root(&app)?;
    let target = PathBuf::from(&path);
    if !is_inside(&root, &target) {
        return Err("只能读本机 CLI 产物目录里的文件".to_string());
    }
    let bytes = std::fs::read(&target).map_err(|err| {
        format!("读不到本机 CLI 的产物（{err}）：确认参数模板里给了 `{{out}}`，且命令真的把文件写出来了")
    })?;
    Ok(base64_encode(&bytes))
}

const CLI_TEXT_OUT_MAX_BYTES: usize = 2 * 1024 * 1024;

/// 把一个小文本文件写进 CLI 产物目录（当前用于 SRT）。
///
/// 只接受单文件名：不允许路径、控制字符、首尾空白，且扩展名必须是 `.srt`。
/// 这条命令只服务字幕落盘，不是通用文件写入原语。
fn valid_cli_out_name(name: &str) -> bool {
    let path = Path::new(name);
    let is_srt = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("srt"));
    !name.is_empty()
        && name.chars().count() <= 180
        && name.trim() == name
        && !name
            .chars()
            .any(|ch| ch.is_control() || ch == '/' || ch == '\\' || ch == ':')
        && !name.contains("..")
        && path.file_name().and_then(|file| file.to_str()) == Some(name)
        && is_srt
}

#[tauri::command]
pub(crate) fn cli_write_out(app: tauri::AppHandle, name: String, bytes: Vec<u8>) -> Result<String, String> {
    if !valid_cli_out_name(&name) {
        return Err(
            "字幕文件名不合法：只写文件名、扩展名必须是 .srt，不能包含路径或控制字符".to_string(),
        );
    }
    if bytes.is_empty() {
        return Err("字幕内容为空，没有可写入的文件".to_string());
    }
    if bytes.len() > CLI_TEXT_OUT_MAX_BYTES {
        return Err("字幕文件超过 2MB，拒绝写入本机 CLI 产物目录".to_string());
    }
    let root = cli_out_root(&app)?;
    let target = root.join(&name);
    if !is_inside(&root, &target) {
        return Err("只能写本机 CLI 产物目录里的文件".to_string());
    }
    std::fs::write(&target, bytes).map_err(|err| format!("写 CLI 文本文件失败：{err}"))?;
    Ok(target.to_string_lossy().to_string())
}

fn cli_media_file_name(hash: &str, mime: &str) -> Option<String> {
    let valid_hash = (8..=128).contains(&hash.len())
        && hash.chars().all(|ch| ch.is_ascii_hexdigit());
    if !valid_hash {
        return None;
    }
    let mime = mime.split(';').next()?.trim().to_ascii_lowercase();
    let ext = match mime.as_str() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "video/quicktime" => "mov",
        "audio/mpeg" => "mp3",
        "audio/wav" => "wav",
        "audio/ogg" => "ogg",
        "audio/mp4" => "m4a",
        "audio/aac" => "aac",
        "audio/flac" => "flac",
        _ => return None,
    };
    Some(format!("{hash}.{ext}"))
}

fn cli_in_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = current_data_dir(app)
        .ok_or_else(|| "拿不到数据目录，无法给本机 CLI 准备输入位置".to_string())?
        .join(CLI_IN_DIR_NAME);
    std::fs::create_dir_all(&dir).map_err(|err| format!("建 CLI 输入目录失败：{err}"))?;
    Ok(dir)
}

/// 把共享库里的素材导入 `<数据目录>/cli-in`，供本机 CLI 以普通文件路径读取。
///
/// 前端只给 hash 与 MIME，URL、文件名和落盘范围都由壳决定；这样既不把大视频塞进 IPC，
/// 也不把“任意文件写入”暴露给页面。
#[tauri::command]
pub(crate) async fn cli_import_asset(
    app: tauri::AppHandle,
    hash: String,
    mime: String,
) -> Result<String, String> {
    let name = cli_media_file_name(&hash, &mime)
        .ok_or_else(|| "CLI 输入素材的 hash 或 MIME 不合法".to_string())?;
    let root = cli_in_root(&app)?;
    let target = root.join(name);
    if !is_inside(&root, &target) {
        return Err("只能写本机 CLI 输入目录里的文件".to_string());
    }
    let port = app.state::<SharedStoreRuntime>().port;
    let url = format!("http://127.0.0.1:{port}/asset/{hash}");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(
            CLI_MEDIA_IMPORT_TIMEOUT_MS,
        ))
        .build()
        .map_err(|err| format!("创建本机素材读取客户端失败：{err}"))?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|err| format!("从共享素材库读取 {hash} 失败：{err}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("共享素材库没有返回 {hash}（HTTP {status}）"));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|err| format!("读取共享素材 {hash} 的字节失败：{err}"))?;
    if bytes.is_empty() {
        return Err(format!("共享素材 {hash} 是空文件"));
    }
    std::fs::write(&target, &bytes)
        .map_err(|err| format!("把素材 {hash} 写入 CLI 输入目录失败：{err}"))?;
    Ok(target.to_string_lossy().to_string())
}

// ── RunningHub CLI 的登录：写它自己的配置文件 ──
//
// 用户 2026-10-08 第 3 条：「runininghub 的 cli 是在 github 上找的，看看 github 上
// 能不能把目前实现不了一键自动安装的 cli 给做好」。
//
// 官方 CLI（`HM-RunningHub/RH_CLI`）的登录命令是 `rh auth set-key <KEY>`，而那是个
// **位置参数** —— 应用里不能调它（本机约定：**密钥只走 stdin，不进 argv**：
// argv 会进进程列表、也会被别的工具记进历史）。但那套 CLI 自己认配置文件里的 `api_key`
// （`rh_cli/config.py` 的 `resolve_api_key`：argv → 环境变量 `RUNNINGHUB_API_KEY` →
// `%APPDATA%\rh\config.toml`）⇒ **壳直接把那一行写好**，效果与用户手敲那条命令一样，
// 而且是持久的：用户自己终端里的 `rh` 也立刻是登录态。
//
// 安全边界：路径**由壳自己拼**（`%APPDATA%\rh\config.toml`），前端只能给"那把 Key"，
// 借这个命令动不了任何别的文件 —— 与 `cli_read_out` 收死目录是同一条思路。

/// RunningHub CLI 的配置文件路径（与它的 `config_dir()` 同一套规则）。
fn rh_config_path() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    let base = std::env::var("APPDATA")
        .map_err(|_| "拿不到 %APPDATA%，写不了 RunningHub 的配置".to_string())?;
    #[cfg(not(target_os = "windows"))]
    let base = std::env::var("XDG_CONFIG_HOME")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .or_else(|| std::env::var("HOME").ok().map(|h| format!("{h}/.config")))
        .ok_or_else(|| "拿不到配置目录，写不了 RunningHub 的配置".to_string())?;
    Ok(PathBuf::from(base).join("rh").join("config.toml"))
}

/// 把 `api_key` 那一行写进配置文本，**其余行原样保留**。
///
/// 为什么是"读回来再写"而不是直接覆盖：官方 CLI 的 `write_config` 也是这么做的 ——
/// 它那份配置里还可能有 `output_dir` 这类别的键，覆盖会把用户已有的设置冲掉。
fn upsert_api_key(existing: &str, api_key: &str) -> String {
    let mut lines: Vec<String> = existing
        .lines()
        /* 旧的 `api_key` 行整行丢掉（等价于"改"，不是"追加第二条"） */
        .filter(|line| line.split('=').next().unwrap_or("").trim() != "api_key")
        .map(|line| line.to_string())
        .collect();
    /* 值与官方 CLI 同一套转义（TOML 基本字符串：反斜杠与双引号要转义） */
    let escaped = api_key.replace('\\', "\\\\").replace('"', "\\\"");
    lines.push(format!("api_key = \"{escaped}\""));
    let mut out = lines.join("\n");
    out.push('\n');
    out
}

/// 写 RunningHub CLI 的 API Key（登录）。返回配置文件路径，供界面如实告知。
#[tauri::command]
pub(crate) fn rh_set_api_key(api_key: String) -> Result<String, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("Key 是空的，没有可写的内容".to_string());
    }
    let path = rh_config_path()?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|err| format!("建配置目录失败：{err}"))?;
    }
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    std::fs::write(&path, upsert_api_key(&existing, key))
        .map_err(|err| format!("写 RunningHub 配置失败：{err}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod cli_out_tests {
    use super::*;

    #[test]
    fn cli_media_file_name_requires_safe_hash_and_known_mime() {
        assert_eq!(
            cli_media_file_name("0123456789abcdef", "image/png;charset=binary"),
            Some("0123456789abcdef.png".to_string())
        );
        assert_eq!(
            cli_media_file_name("0123456789abcdef", "video/quicktime"),
            Some("0123456789abcdef.mov".to_string())
        );
        assert_eq!(cli_media_file_name("../escape", "image/png"), None);
        assert_eq!(cli_media_file_name("0123456789abcdef", "text/html"), None);
    }

    #[test]
    fn base64_matches_rfc4648_vectors() {
        // RFC 4648 §10 的官方向量：三种余数长度都覆盖到
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        // 高位字节（>127）：PNG / JPEG 的头就是这种，编码表用错会在这里露馅
        assert_eq!(base64_encode(&[0x89, 0x50, 0x4e, 0x47]), "iVBORw==");
    }

    #[test]
    fn base64_decode_round_trips_binary_vectors() {
        for bytes in [
            b"".as_slice(),
            b"f".as_slice(),
            b"fo".as_slice(),
            b"foo".as_slice(),
            b"foobar".as_slice(),
            &[0x89, 0x50, 0x4e, 0x47],
        ] {
            assert_eq!(base64_decode(&base64_encode(bytes)).unwrap(), bytes);
        }
        assert!(base64_decode("iVBOR===").is_err());
        assert!(base64_decode("iV!ORw==").is_err());
    }

    #[test]
    fn multipart_body_preserves_text_fields_and_file_bytes() {
        let (content_type, body) = crate::network_fetch::multipart_body(vec![
            crate::network_fetch::FetchMultipartPart {
                name: "model".into(),
                value: Some("gpt-image-2".into()),
                data_base64: None,
                file_name: None,
                content_type: None,
            },
            crate::network_fetch::FetchMultipartPart {
                name: "image".into(),
                value: None,
                data_base64: Some(base64_encode(&[0x89, 0x50, 0x4e, 0x47])),
                file_name: Some("reference.png".into()),
                content_type: Some("image/png".into()),
            },
        ])
        .unwrap();
        assert!(content_type.starts_with("multipart/form-data; boundary="));
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("name=\"model\""));
        assert!(text.contains("gpt-image-2"));
        assert!(text.contains("filename=\"reference.png\""));
        assert!(text.contains("Content-Type: image/png"));
        assert!(body
            .windows(4)
            .any(|window| window == [0x89, 0x50, 0x4e, 0x47]));
    }

    #[test]
    fn only_files_inside_the_out_dir_are_readable() {
        let root = Path::new(r"C:\data\cli-out");
        assert!(is_inside(root, Path::new(r"C:\data\cli-out\a.png")));
        assert!(is_inside(root, Path::new(r"C:\DATA\CLI-OUT\b.mp4")));
        // 目录本身不是文件
        assert!(!is_inside(root, Path::new(r"C:\data\cli-out")));
        // `..` 一律拒：starts_with 不做规范化，不挡这条就能读到隔壁
        assert!(!is_inside(
            root,
            Path::new(r"C:\data\cli-out\..\secret.txt")
        ));
        assert!(!is_inside(
            root,
            Path::new(r"C:\data\cli-out\sub\..\..\secret.txt")
        ));
        // 前缀相同但不是同一层（`cli-out2` 不是 `cli-out` 的子目录）
        assert!(!is_inside(root, Path::new(r"C:\data\cli-out2\a.png")));
        // 完全无关的盘
        assert!(!is_inside(root, Path::new(r"D:\other\a.png")));
    }

    #[test]
    fn cli_text_out_name_rejects_paths_and_parent_segments() {
        assert!(valid_cli_out_name("字幕.srt"));
        assert!(valid_cli_out_name("subtitle-01.srt"));
        assert!(valid_cli_out_name("subtitle-01.SRT"));
        assert!(!valid_cli_out_name("../secret.srt"));
        assert!(!valid_cli_out_name("sub/secret.srt"));
        assert!(!valid_cli_out_name(r"sub\secret.srt"));
        assert!(!valid_cli_out_name("C:secret.srt"));
        assert!(!valid_cli_out_name(" subtitle.srt"));
        assert!(!valid_cli_out_name("subtitle.txt"));
        assert!(!valid_cli_out_name("subtitle.srt\n"));
        assert!(!valid_cli_out_name(""));
        assert!(!valid_cli_out_name(&format!("{}.srt", "a".repeat(177))));
    }

    /**
     * RunningHub 的 Key 落盘规则（用户 2026-10-08 第 3 条）。
     *
     * 三条判据，都是"写坏一次就很难查"的那种：
     *   ① 新文件直接写出这一行；
     *   ② **已有的别的键要留着**（官方 CLI 的配置里还可能有 `output_dir`，
     *      覆盖写会把它冲掉 —— 那正是"读回来再写"的理由）；
     *   ③ 旧的 `api_key` **不追加第二条**，且值里的反斜杠 / 双引号照 TOML 转义。
     */
    #[test]
    fn api_key_line_is_upserted_not_appended() {
        assert_eq!(upsert_api_key("", "abc"), "api_key = \"abc\"\n");

        let kept = upsert_api_key("output_dir = \"D:/rh\"\n", "abc");
        assert_eq!(kept, "output_dir = \"D:/rh\"\napi_key = \"abc\"\n");

        let replaced = upsert_api_key("api_key = \"old\"\noutput_dir = \"D:/rh\"\n", "new");
        assert_eq!(replaced, "output_dir = \"D:/rh\"\napi_key = \"new\"\n");
        assert_eq!(replaced.matches("api_key").count(), 1);

        let escaped = upsert_api_key("", r#"a\b"c"#);
        assert_eq!(escaped, "api_key = \"a\\\\b\\\"c\"\n");
    }
}


#[cfg(test)]
mod bundled_program_tests {
    use super::*;

    #[test]
    fn only_ffmpeg_maps_to_the_bundled_resource() {
        assert_eq!(
            bundled_program_relative("ffmpeg"),
            Some(PathBuf::from("resources").join("ffmpeg.exe"))
        );
        assert_eq!(
            bundled_program_relative("FFMPEG"),
            Some(PathBuf::from("resources").join("ffmpeg.exe"))
        );
        assert_eq!(bundled_program_relative("ffprobe"), None);
        assert_eq!(bundled_program_relative("notepad"), None);
    }

    #[test]
    fn debug_resource_candidate_lives_under_src_tauri() {
        let relative = bundled_program_relative("ffmpeg").unwrap();
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative);
        assert!(path.ends_with(Path::new("src-tauri").join("resources").join("ffmpeg.exe")));
    }
}
