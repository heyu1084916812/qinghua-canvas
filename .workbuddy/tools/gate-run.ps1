#Requires -Version 5.1
<#
单刀质量门禁一键脚本（不进 src，不修改源码）

用法：
  # B 档（不碰 UI）
  powershell -NoProfile -File .workbuddy/tools/gate-run.ps1 -Commit b178656 -Name tool-ledger

  # A 档（碰 UI）：额外跑 G769 明/暗 + G865，截图归档
  powershell -NoProfile -File .workbuddy/tools/gate-run.ps1 -Commit <hash> -Name <slug> -Ui

  # 只做冻结预检（不跑测试）
  powershell -NoProfile -File .workbuddy/tools/gate-run.ps1 -Commit <hash> -Name <slug> -PreflightOnly

约定：
  * 证据目录 .playwright-verify/<短hash>-<名字>/
  * 隔离 store 端口从 28792 起找空闲；禁用 18765/18767/18768；不杀用户安装版与 debug 实例
  * 每步前后比对 HEAD + 文件 hash + mtime + git status；不一致即判「污染」(exit 2)，当轮数字作废
  * 退出码：0 全绿 / 1 有红 / 2 污染 / 3 预检拒绝
#>
[CmdletBinding()]
param(
  [string]$Commit = '',
  [string]$Name = 'run',
  [switch]$Ui,
  [string[]]$SmokeGroups = @('g769', 'g865'),
  [string[]]$Targeted = @(),
  [int]$BaselinePassed = 4165,
  [int]$BaselineSkipped = 1,
  [int]$BaselineTotal = 4166,
  [int]$StorePort = 28792,
  [string]$SmokeBase = 'http://127.0.0.1:1420',
  [switch]$PreflightOnly,
  [string]$HeadCheck = '',
  [switch]$SkipStatic,
  [switch]$KeepStore,
  [switch]$AllowDirty
)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if ($HeadCheck) {
  $HashTag = $HeadCheck.Substring(0, [Math]::Min(7, $HeadCheck.Length))
  $Name = 'headcheck'
} else {
  $HashTag = $Commit.Substring(0, [Math]::Min(7, $Commit.Length))
}
if (-not $HeadCheck -and -not $Commit) {
  Write-Host '缺少 -Commit（或用 -HeadCheck <hash>）'
  exit 3
}
if ($Name -eq 'run' -and -not $HeadCheck) {
  Write-Host '缺少 -Name（或改用 -HeadCheck <hash> 模式）'
  exit 3
}
$Evidence = Join-Path $Repo ".playwright-verify/$HashTag-$Name"
New-Item -ItemType Directory -Force -Path $Evidence | Out-Null

$script:Results = New-Object System.Collections.ArrayList
# `-SmokeGroups a,b,c` 在 -File 调用下会是一整串，这里统一拆开
$SmokeGroups = @($SmokeGroups -split ',' | Where-Object { $_ -ne '' } | ForEach-Object { $_.Trim() })
function Add-Result([string]$Step, [bool]$Ok, [string]$Detail) {
  [void]$script:Results.Add([pscustomobject]@{ Step = $Step; Ok = $Ok; Detail = $Detail })
  $tag = if ($Ok) { 'PASS' } else { 'FAIL' }
  Write-Host ("[{0}] {1} — {2}" -f $tag, $Step, $Detail)
}

function Get-GitStatusLines {
  $lines = @(git -C $Repo status --porcelain=v1)
  # 已知未跟踪白名单：两个垃圾文件 + 门禁工具自身
  $keep = @()
  foreach ($line in $lines) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line -match '^\?\? (\$null|2026-01-01''\)|\.workbuddy/tools/)') { continue }
    $keep += $line
  }
  return $keep
}

function Get-TreeSnapshot {
  $head = (git -C $Repo rev-parse HEAD).Trim()
  $status = (Get-GitStatusLines) -join "`n"
  $files = @{}
  foreach ($line in (Get-GitStatusLines)) {
    $path = $line.Substring(3).Trim()
    if ($path -like '* -> *') { $path = ($path -split ' -> ')[-1] }
    $path = $path.Trim('"')
    $full = Join-Path $Repo $path
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { continue }
    $hash = (git -C $Repo hash-object -- $path).Trim()
    $mtime = (Get-Item -LiteralPath $full).LastWriteTimeUtc.Ticks
    $files[$path] = "$hash@$mtime"
  }
  return [pscustomobject]@{ Head = $head; Status = $status; Files = $files }
}

function Compare-Snapshot($Before, $After) {
  $diffs = @()
  if ($Before.Head -ne $After.Head) { $diffs += "HEAD $($Before.Head) -> $($After.Head)" }
  if ($Before.Status -ne $After.Status) { $diffs += 'git status 变化' }
  foreach ($k in $Before.Files.Keys) {
    if (-not $After.Files.ContainsKey($k)) { $diffs += "消失: $k" }
    elseif ($After.Files[$k] -ne $Before.Files[$k]) { $diffs += "内容/时间变化: $k" }
  }
  foreach ($k in $After.Files.Keys) {
    if (-not $Before.Files.ContainsKey($k)) { $diffs += "新增改动: $k" }
  }
  return $diffs
}

function Write-Summary([string]$Verdict, [int]$Code) {
  $lines = @(
    "# 门禁报告 $HashTag-$Name",
    '',
    "- 时间：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    "- 冻结 commit：$Commit",
    "- 级别：$(if ($Ui) { 'A（UI）' } else { 'B（非 UI）' })",
    "- 证据目录：$Evidence",
    "- 结论：$Verdict",
    '',
    '| 步骤 | 结果 | 说明 |',
    '|---|---|---|'
  )
  foreach ($r in $script:Results) {
    $lines += "| $($r.Step) | $(if ($r.Ok) { 'PASS' } else { 'FAIL' }) | $($r.Detail -replace '\|', '/') |"
  }
  $lines += ''
  $lines += "退出码：$Code"
  Set-Content -LiteralPath (Join-Path $Evidence 'SUMMARY.md') -Value ($lines -join "`n") -Encoding UTF8
}

function Finish([int]$Code) {
  $verdict = switch ($Code) {
    0 { '全绿，可提交' }
    1 { '阻断：有红项' }
    2 { '作废：树在跑的过程中被改动（污染）' }
    3 { '预检拒绝：不满足冻结前置条件' }
    default { '未知' }
  }
  Write-Summary $verdict $Code
  Write-Host ''
  Write-Host "证据目录：$Evidence"
  Write-Host "结论：$verdict"
  exit $Code
}

# ---------- HeadCheck 模式：只证明「某个提交能不能编译」 ----------
if ($HeadCheck) {
  Write-Host "== HeadCheck $HeadCheck =="
  $resolved = (git -C $Repo rev-parse --verify "$HeadCheck^{commit}" 2>$null)
  if (-not $resolved) {
    Add-Result 'HeadCheck:resolve' $false "找不到提交 $HeadCheck"
    Finish 3
  }
  $resolved = $resolved.Trim()
  $wt = Join-Path $Repo ".gate-headcheck-$HashTag"
  if (Test-Path -LiteralPath $wt) {
    Add-Result 'HeadCheck:worktree' $false "目录已存在：$wt（先清理）"
    Finish 3
  }
  git -C $Repo worktree add $wt $resolved *> (Join-Path $Evidence 'worktree-add.log')
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $wt)) {
    Add-Result 'HeadCheck:worktree' $false "git worktree add 失败（见 worktree-add.log）"
    Finish 3
  }
  $addLog = Get-Content -LiteralPath (Join-Path $Evidence 'worktree-add.log') -Raw
  Add-Result 'HeadCheck:worktree' $true ("检出 $($resolved.Substring(0,7)) 到 .gate-headcheck-$HashTag")

  $junction = Join-Path $wt 'node_modules'
  cmd /c mklink /J "$junction" (Join-Path $Repo 'node_modules') *> (Join-Path $Evidence 'junction.log')
  $junctionOk = Test-Path -LiteralPath (Join-Path $junction 'vite')
  Add-Result 'HeadCheck:node_modules' $junctionOk "junction=.gate-headcheck-$HashTag/node_modules"

  Push-Location $wt
  try {
    npx tsc --noEmit *> (Join-Path $Evidence 'tsc.log')
    $code = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  $tscLog = Join-Path $Evidence 'tsc.log'
  $tscText = if (Test-Path -LiteralPath $tscLog) { Get-Content -LiteralPath $tscLog -Raw } else { '' }
  $firstError = (($tscText -split "`n") | Where-Object { $_ -match 'error TS' } | Select-Object -First 3) -join ' | '
  Add-Result 'HeadCheck:tsc' ($code -eq 0) ("hash=$HashTag exit=$code" + $(if ($firstError) { "；首批错误：$firstError" } else { '' }))

  # 立即清理（先拆联接再删 worktree）
  cmd /c rmdir "$junction" *> $null
  git -C $Repo worktree remove $wt --force *> (Join-Path $Evidence 'worktree-remove.log')
  if (Test-Path -LiteralPath $wt) {
    try { [System.IO.Directory]::Delete($wt, $true) } catch { }
  }
  $cleaned = -not (Test-Path -LiteralPath $wt)
  Add-Result 'HeadCheck:cleanup' $cleaned ("worktree 已移除=$cleaned")

  if (-not $cleaned) { Finish 2 }
  if ($code -eq 0) { Finish 0 } else { Finish 1 }
}

# ---------- 预检 ----------
Write-Host "== 预检 =="
$head = (git -C $Repo rev-parse HEAD).Trim()
Write-Host "HEAD=$head  期望=$Commit"
if (-not $head.StartsWith($Commit)) {
  Add-Result 'Preflight:HEAD' $false "HEAD=$head 与冻结 commit=$Commit 不符"
  Finish 3
}
$dirty = Get-GitStatusLines
if ($dirty.Count -gt 0 -and -not $AllowDirty) {
  Add-Result 'Preflight:clean' $false ("工作区不干净：" + ($dirty -join ' / '))
  Finish 3
}
Add-Result 'Preflight' $true "HEAD=$head；未跟踪仅白名单"

$snapshot0 = Get-TreeSnapshot
$snapshot0 | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $Evidence 'snapshot-before.json') -Encoding UTF8

if ($PreflightOnly) {
  Write-Host '预检通过（PreflightOnly，未执行测试）'
  Finish 0
}

function Invoke-GateStep([string]$Step, [string]$LogName, [scriptblock]$Body) {
  $before = Get-TreeSnapshot
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $log = Join-Path $Evidence $LogName
  & $Body $log
  $code = $LASTEXITCODE
  $sw.Stop()
  $after = Get-TreeSnapshot
  $diffs = Compare-Snapshot $before $after
  if ($diffs.Count -gt 0) {
    Add-Result $Step $false ('污染：' + ($diffs -join '; '))
    return @{ Code = 2; Contaminated = $true }
  }
  return @{ Code = $code; Contaminated = $false; Seconds = [Math]::Round($sw.Elapsed.TotalSeconds, 1) }
}

# ---------- B 档静态步骤（-SkipStatic 可跳过，只跑 UI 组） ----------
if ($SkipStatic) {
  Add-Result '静态步骤' $true '跳过（-SkipStatic）：tsc / 定向 / 全量单测 / build / diff --check'
} else {
# ---------- B1 tsc ----------
$r = Invoke-GateStep 'tsc' 'tsc.log' { param($log) npx tsc --noEmit *> $log }
if ($r.Contaminated) { Finish 2 }
$tscSize = (Get-Item (Join-Path $Evidence 'tsc.log')).Length
Add-Result 'tsc' ($r.Code -eq 0 -and $tscSize -eq 0) "exit=$($r.Code)，日志 $tscSize 字节，$($r.Seconds)s"
if ($r.Code -ne 0) { Finish 1 }

# ---------- B2 定向单测 ----------
if ($Targeted.Count -gt 0) {
  $r = Invoke-GateStep '定向单测' 'targeted.log' { param($log) npx vitest run @Targeted *> $log }
  if ($r.Contaminated) { Finish 2 }
  $txt = Get-Content -LiteralPath (Join-Path $Evidence 'targeted.log') -Raw
  $m = [regex]::Match($txt, 'Tests\s+(\d+) passed')
  $passed = if ($m.Success) { [int]$m.Groups[1].Value } else { 0 }
  Add-Result '定向单测' ($r.Code -eq 0 -and $passed -gt 0) "exit=$($r.Code)，passed=$passed，$($r.Seconds)s"
  if ($r.Code -ne 0) { Finish 1 }
} else {
  Add-Result '定向单测' $true '未指定 -Targeted，跳过'
}

# ---------- B3 全量单测（带覆盖率，阈值由 vite.config.ts 把关） ----------
$r = Invoke-GateStep 'npm run test:coverage' 'npm-test.log' { param($log) npm run test:coverage *> $log }
if ($r.Contaminated) { Finish 2 }
$txt = Get-Content -LiteralPath (Join-Path $Evidence 'npm-test.log') -Raw
$filesM = [regex]::Match($txt, 'Test Files\s+(\d+) passed\s*\|\s*(\d+) skipped\s*\((\d+)\)')
$testsM = [regex]::Match($txt, 'Tests\s+(\d+) passed\s*\|\s*(\d+) skipped\s*\((\d+)\)')
$filesPassed = if ($filesM.Success) { [int]$filesM.Groups[1].Value } else { -1 }
$filesSkipped = if ($filesM.Success) { [int]$filesM.Groups[2].Value } else { -1 }
$filesTotal = if ($filesM.Success) { [int]$filesM.Groups[3].Value } else { -1 }
$passed = if ($testsM.Success) { [int]$testsM.Groups[1].Value } else { -1 }
$skipped = if ($testsM.Success) { [int]$testsM.Groups[2].Value } else { -1 }
$total = if ($testsM.Success) { [int]$testsM.Groups[3].Value } else { -1 }
$monotonic = $passed -ge $BaselinePassed
$baseNote = "基线 $BaselinePassed/$BaselineSkipped/$BaselineTotal；实际 $passed/$skipped/$total；文件 $filesPassed passed/$filesSkipped skipped/$filesTotal；$(if ($monotonic) { '只增不减 OK' } else { '低于基线！' })"
Add-Result 'npm test (coverage)' ($r.Code -eq 0 -and $monotonic) "exit=$($r.Code)，$baseNote，$($r.Seconds)s"
$covM = [regex]::Matches($txt, '(Statements|Branches|Functions|Lines)\s*:\s*([\d.]+)%')
$covNote = ($covM | ForEach-Object { "$($_.Groups[1].Value) $($_.Groups[2].Value)%" }) -join '；'
Add-Result 'coverage' ($covM.Count -eq 4) $covNote
if ($r.Code -ne 0 -or -not $monotonic) { Finish 1 }

# ---------- B4 build ----------
$r = Invoke-GateStep 'build' 'build.log' { param($log) npm run build *> $log }
if ($r.Contaminated) { Finish 2 }
$txt = Get-Content -LiteralPath (Join-Path $Evidence 'build.log') -Raw
$b = [regex]::Match($txt, 'built in ([\d.]+)s')
$warn = @()
if ($txt -match 'INEFFECTIVE_DYNAMIC_IMPORT') { $warn += 'INEFFECTIVE_DYNAMIC_IMPORT' }
if ($txt -match 'larger than 500 kB') { $warn += 'chunk>500kB' }
$warnText = if ($warn.Count) { $warn -join '+' } else { '无' }
Add-Result 'build' ($r.Code -eq 0) "exit=$($r.Code)，vite $(if ($b.Success) { $b.Groups[1].Value + 's' } else { '?' })，警告：$warnText，总计 $($r.Seconds)s"
if ($r.Code -ne 0) { Finish 1 }

# ---------- B5 git diff --check ----------
$r = Invoke-GateStep 'diff --check' 'diff-check.log' { param($log) git diff --check *> $log }
if ($r.Contaminated) { Finish 2 }
$size = (Get-Item (Join-Path $Evidence 'diff-check.log')).Length
Add-Result 'diff --check' ($r.Code -eq 0 -and $size -eq 0) "exit=$($r.Code)，输出 $size 字节"
if ($r.Code -ne 0 -or $size -ne 0) { Finish 1 }
}

# ---------- A 档：UI ----------
if ($Ui) {
  try {
    $null = Invoke-WebRequest -Uri $SmokeBase -UseBasicParsing -TimeoutSec 8
  } catch {
    Add-Result 'UI:dev-server' $false "smoke 需要 $SmokeBase 可用（先起 vite dev），当前不可达"
    Finish 1
  }

  # 找空闲端口（≥ StorePort，跳过 187xx 红线）
  $port = 0
  for ($p = $StorePort; $p -lt ($StorePort + 40); $p++) {
    if ($p -in 18765, 18767, 18768) { continue }
    try {
      $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $p)
      $l.Start(); $l.Stop(); $port = $p; break
    } catch { }
  }
  if ($port -eq 0) { Add-Result 'UI:port' $false "在 $StorePort 起找不到空闲端口"; Finish 1 }

  $storeDir = Join-Path $Evidence 'store'
  New-Item -ItemType Directory -Force -Path $storeDir | Out-Null
  $storeExe = Join-Path $Repo 'shared-store\target\debug\qinghua-store.exe'
  if (-not (Test-Path -LiteralPath $storeExe)) { Add-Result 'UI:store-exe' $false "找不到 $storeExe"; Finish 1 }
  $store = Start-Process -FilePath $storeExe -ArgumentList '--data-dir', $storeDir, '--backend', 'v2', '--port', "$port" -WindowStyle Hidden -PassThru
  $store.Id | Set-Content -LiteralPath (Join-Path $Evidence 'store.pid')
  $health = $null
  for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Milliseconds 400
    try { $health = Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 3 } catch { $health = $null }
    if ($health -and $health.ok) { break }
  }
  $dirOk = $false
  if ($health -and $health.dataDir) {
    $dirOk = ([IO.Path]::GetFullPath($health.dataDir).TrimEnd('\') -ieq [IO.Path]::GetFullPath($storeDir).TrimEnd('\'))
  }
  Add-Result 'UI:store' ([bool]$health.ok -and $dirOk) "port=$port dataDir=$($health.dataDir)"
  if (-not ($health.ok -and $dirOk)) { if (-not $KeepStore) { Stop-Process -Id $store.Id -Force -ErrorAction SilentlyContinue }; Finish 1 }

  try {
    foreach ($group in $SmokeGroups) {
      foreach ($theme in @('light', 'dark')) {
        $label = "$group-$theme"
        # 截图基线按「路径 -> mtime:length」记录：smoke 用固定文件名覆盖，纯文件名差集永远为空
        $imgBefore = @{}
        Get-ChildItem (Join-Path $Repo '.playwright-verify') -Filter '*.png' -ErrorAction SilentlyContinue |
          ForEach-Object { $imgBefore[$_.FullName] = "$($_.LastWriteTimeUtc.Ticks):$($_.Length)" }
        $env:SMOKE_STORE_BASE = "http://127.0.0.1:$port"
        $env:SMOKE_BASE = $SmokeBase
        $env:SMOKE_ONLY = $group
        if ($theme -eq 'dark') { $env:SMOKE_DARK = '1' } else { Remove-Item Env:SMOKE_DARK -ErrorAction SilentlyContinue }
        $logPath = Join-Path $Evidence "$label.log"
        $r = Invoke-GateStep "smoke:$label" "$label.log" { param($log) node (Join-Path $Repo 'scripts/smoke.mjs') *> $log }
        Remove-Item Env:SMOKE_STORE_BASE, Env:SMOKE_BASE, Env:SMOKE_ONLY -ErrorAction SilentlyContinue
        Remove-Item Env:SMOKE_DARK -ErrorAction SilentlyContinue
        if ($r.Contaminated) { throw 'contaminated' }
        $txt = Get-Content -LiteralPath $logPath -Raw
        $sm = [regex]::Match($txt, '=====\s*(\d+) passed / (\d+) failed / (\d+) total =====')
        $sp = if ($sm.Success) { [int]$sm.Groups[1].Value } else { -1 }
        $sf = if ($sm.Success) { [int]$sm.Groups[2].Value } else { -1 }
        $st = if ($sm.Success) { [int]$sm.Groups[3].Value } else { -1 }
        $imgDir = Join-Path $Evidence $label
        if (Test-Path -LiteralPath $imgDir) { Remove-Item -LiteralPath $imgDir -Recurse -Force }
        New-Item -ItemType Directory -Force -Path $imgDir | Out-Null
        Get-ChildItem (Join-Path $Repo '.playwright-verify') -Filter '*.png' -ErrorAction SilentlyContinue |
          Where-Object {
            $key = "$($_.LastWriteTimeUtc.Ticks):$($_.Length)"
            (-not $imgBefore.ContainsKey($_.FullName)) -or ($imgBefore[$_.FullName] -ne $key)
          } |
          Copy-Item -Destination $imgDir -Force
        $shots = @(Get-ChildItem $imgDir -Filter '*.png').Count
        Add-Result "smoke:$label" ($r.Code -eq 0 -and $sf -eq 0 -and $st -gt 0) "$sp/$sf/$st，截图 $shots 张，$($r.Seconds)s"
        if ($r.Code -ne 0 -or $sf -ne 0) { throw 'smoke-failed' }
      }
    }
  } catch {
    if ($_.Exception.Message -eq 'contaminated') {
      if (-not $KeepStore) { Stop-Process -Id $store.Id -Force -ErrorAction SilentlyContinue }
      Finish 2
    }
    if (-not $KeepStore) { Stop-Process -Id $store.Id -Force -ErrorAction SilentlyContinue }
    Add-Result 'UI:exception' $false ("未预期异常：" + $_.Exception.Message + ' @ line ' + $_.InvocationInfo.ScriptLineNumber)
    Finish 1
  }
  if (-not $KeepStore) { Stop-Process -Id $store.Id -Force -ErrorAction SilentlyContinue }
  Add-Result 'UI:cleanup' $true "隔离 store (pid $($store.Id)) 已停止"
}

# ---------- 收尾：整体污染复检 ----------
$snapshotEnd = Get-TreeSnapshot
$diffs = Compare-Snapshot $snapshot0 $snapshotEnd
if ($diffs.Count -gt 0) {
  Add-Result '污染复检' $false ('全程树发生变化：' + ($diffs -join '; '))
  Finish 2
}
Add-Result '污染复检' $true '全程 HEAD/hash/mtime/status 一致'

$failed = @($script:Results | Where-Object { -not $_.Ok })
if ($failed.Count -gt 0) { Finish 1 }
Finish 0
