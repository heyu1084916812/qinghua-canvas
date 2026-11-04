#Requires -Version 5.1
<#
Release artifact self-check (READ-ONLY).

Re-runs the pre-release checks from #908 against a release folder, so a rebuilt
installer can be verified with one command:

  powershell -NoProfile -File .workbuddy/tools/check-release-artifacts.ps1
  powershell -NoProfile -File .workbuddy/tools/check-release-artifacts.ps1 -Version 0.1.15
  powershell -NoProfile -File .workbuddy/tools/check-release-artifacts.ps1 -Version 0.1.15 -ExpectSha256 ABCD...

Checks (never runs the installer, never touches the registry):
  1  artifacts present: <asset> / <asset>.sig / latest.json
  2  exe size > 0 and sha256 (compared to -ExpectSha256 when given)
  3  latest.json parses; version == expected; pub_date is ISO-8601
  4  url ends with /releases/download/v<ver>/<asset>, <asset> equals the file
     on disk byte-for-byte (case-sensitive), same repo as the updater endpoint
  5  latest.json signature is BYTE-IDENTICAL to the .sig file, and decodes to a
     minisign blob (untrusted comment / 74B sig block / trusted comment / global sig)
  6  key id inside the signature == key id of tauri.conf.json updater pubkey
  7  exe version resource: ProductVersion/FileVersion == expected version,
     ProductName == tauri.conf.json productName

Exit codes: 0 = every check PASS / 1 = at least one FAIL.

NOTE: this file is intentionally ASCII-only. Windows PowerShell 5.1 reads a
BOM-less UTF-8 script as ANSI, so non-ASCII *literals* here would print as
garbage; every human-readable string is compared against a value read from the
repo (package.json / tauri.conf.json) instead of being hard-coded.
#>
[CmdletBinding()]
param(
  [string]$Version = '',
  [string]$Dir = '',
  [string]$ExpectSha256 = ''
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$confPath = Join-Path $Repo 'src-tauri/tauri.conf.json'
$conf = Get-Content -LiteralPath $confPath -Raw -Encoding UTF8 | ConvertFrom-Json

if (-not $Version) {
  $Version = (Get-Content -LiteralPath (Join-Path $Repo 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
}
$Out = if ($Dir) { $Dir } else { Join-Path $Repo "release/$Version" }

$asset = "qinghua_${Version}_x64-setup.exe"
$exe = Join-Path $Out $asset
$sigPath = "$exe.sig"
$jsonPath = Join-Path $Out 'latest.json'

$script:Results = New-Object System.Collections.ArrayList
function Check([string]$Name, [bool]$Ok, [string]$Detail = '') {
  [void]$script:Results.Add([pscustomobject]@{ Name = $Name; Ok = $Ok; Detail = $Detail })
  $tag = if ($Ok) { 'PASS' } else { 'FAIL' }
  $suffix = if ($Detail) { " - $Detail" } else { '' }
  Write-Host ("[{0}] {1}{2}" -f $tag, $Name, $suffix)
}

Write-Host "== release artifact check =="
Write-Host "version : $Version"
Write-Host "folder  : $Out"
Write-Host ''

# ---------- 1. artifacts present ----------
$hasExe = Test-Path -LiteralPath $exe
$hasSig = Test-Path -LiteralPath $sigPath
$hasJson = Test-Path -LiteralPath $jsonPath
Check 'artifact: installer present' $hasExe $asset
Check 'artifact: signature present' $hasSig "$asset.sig"
Check 'artifact: latest.json present' $hasJson 'latest.json'

if (-not ($hasExe -and $hasSig -and $hasJson)) {
  Write-Host ''
  Write-Host 'RESULT: FAIL (missing artifacts - nothing else can be verified)' -ForegroundColor Red
  exit 1
}

# ---------- 2. exe size + sha256 ----------
$exeSize = (Get-Item -LiteralPath $exe).Length
Check 'exe: size > 0' ($exeSize -gt 0) "$exeSize B"
$sha = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
Check 'exe: sha256 computed' ($sha.Length -eq 64) $sha
if ($ExpectSha256) {
  Check 'exe: sha256 == expected' ($sha -ieq $ExpectSha256) "expected $ExpectSha256"
}

# ---------- 2b. artifact is not stale (built at/after HEAD) ----------
# The commonest release accident is shipping an installer built BEFORE the last
# source commit ("package is stale"). Timestamps are the cheapest guard.
$head = ''
$headEpoch = 0
try {
  $head = ([string](git -C $Repo rev-parse HEAD 2>$null)).Trim()
  $headEpoch = [int64](([string](git -C $Repo log -1 --format=%ct HEAD 2>$null)).Trim())
} catch {
  $head = ''
}
if ($head -and $headEpoch -gt 0) {
  $exeTime = (Get-Item -LiteralPath $exe).LastWriteTimeUtc
  $headTime = [DateTimeOffset]::FromUnixTimeSeconds($headEpoch).UtcDateTime
  Check ("artifact: built at/after HEAD ({0})" -f $head.Substring(0, 7)) `
    ($exeTime -ge $headTime) `
    ("exe={0:yyyy-MM-dd HH:mm:ss}Z head={1:yyyy-MM-dd HH:mm:ss}Z" -f $exeTime, $headTime)
} else {
  Write-Host '[SKIP] artifact: built at/after HEAD (git unavailable)'
}

# ---------- 3. latest.json ----------
$manifest = $null
try {
  $manifest = Get-Content -LiteralPath $jsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
  Check 'latest.json: parses' $true ''
} catch {
  Check 'latest.json: parses' $false $_.Exception.Message
}

$platform = 'windows-x86_64'
$entry = if ($manifest) { $manifest.platforms.$platform } else { $null }
Check 'latest.json: has platform entry' ([bool]$entry) $platform
Check 'latest.json: version matches' ($manifest -and $manifest.version -eq $Version) "version=$($manifest.version)"

$pubDateOk = $false
if ($manifest -and $manifest.pub_date) {
  $parsed = [datetime]::MinValue
  $pubDateOk = [datetime]::TryParse(
    [string]$manifest.pub_date,
    [System.Globalization.CultureInfo]::InvariantCulture,
    [System.Globalization.DateTimeStyles]::RoundtripKind,
    [ref]$parsed
  )
}
Check 'latest.json: pub_date is ISO-8601' $pubDateOk ([string]$manifest.pub_date)

# ---------- 4. url ----------
$url = if ($entry) { [string]$entry.url } else { '' }
$expectedSuffix = "/releases/download/v$Version/$asset"
Check 'url: ends with /releases/download/v<ver>/<asset>' `
  ($url.EndsWith($expectedSuffix, [StringComparison]::Ordinal)) $url
$urlAsset = if ($url) { ($url -split '/')[-1] } else { '' }
Check 'url: asset name identical to file on disk (case-sensitive)' `
  ($urlAsset -ceq $asset) "url=$urlAsset disk=$asset"

$endpoint = @($conf.plugins.updater.endpoints)[0]
$repoMatch = [regex]::Match([string]$endpoint, 'github\.com/([^/]+/[^/]+?)/releases/')
if ($repoMatch.Success) {
  $repoSlug = $repoMatch.Groups[1].Value
  Check 'url: same repo as updater endpoint' `
    ($url -like "https://github.com/$repoSlug/*") "repo=$repoSlug"
} else {
  Check 'url: updater endpoint exposes a github repo' $false ([string]$endpoint)
}

# ---------- 5. signature bytes ----------
$sigFileText = (Get-Content -LiteralPath $sigPath -Raw -Encoding UTF8).Trim()
$manifestSig = if ($entry) { [string]$entry.signature } else { '' }
Check 'signature: manifest == .sig (character-exact)' `
  ($sigFileText -ceq $manifestSig) "sig=$($sigFileText.Length) ch / manifest=$($manifestSig.Length) ch"

$sigBytes = $null
$manifestBytes = $null
$decodedOk = $true
try {
  $sigBytes = [Convert]::FromBase64String($sigFileText)
  $manifestBytes = [Convert]::FromBase64String($manifestSig)
} catch {
  $decodedOk = $false
}
Check 'signature: both sides decode from base64' $decodedOk ''
Check 'signature: decoded bytes identical' `
  ($decodedOk -and [Convert]::ToBase64String($sigBytes) -ceq [Convert]::ToBase64String($manifestBytes)) `
  $(if ($sigBytes) { "$($sigBytes.Length) B" } else { '' })

# ---------- 5b. signature structure ----------
$lines = @()
if ($decodedOk) {
  $innerText = [System.Text.Encoding]::UTF8.GetString($sigBytes)
  # the decoded blob ends with a newline -> Trim() first, otherwise we get a 5th empty line
  $lines = @($innerText.Trim() -split "`n" | ForEach-Object { $_.TrimEnd("`r") })
}
Check 'signature: minisign has 4 lines' ($lines.Count -eq 4) "lines=$($lines.Count)"
Check 'signature: line1 is untrusted comment' `
  ($lines.Count -ge 1 -and $lines[0].StartsWith('untrusted comment: signature from')) $lines[0]

$sigBlock = $null
if ($lines.Count -eq 4) {
  try { $sigBlock = [Convert]::FromBase64String($lines[1]) } catch { $sigBlock = $null }
}
Check 'signature: sig block is 74 bytes (alg+keyid+64B sig)' `
  ([bool]$sigBlock -and $sigBlock.Length -eq 74) $(if ($sigBlock) { "$($sigBlock.Length) B" } else { '' })

$trustedComment = if ($lines.Count -eq 4) { $lines[2] } else { '' }
Check 'signature: trusted comment carries the version' `
  ($trustedComment -like "*version:$Version*") $trustedComment

$globalSig = $null
if ($lines.Count -eq 4) {
  try { $globalSig = [Convert]::FromBase64String($lines[3]) } catch { $globalSig = $null }
}
Check 'signature: global signature is 64 bytes' `
  ([bool]$globalSig -and $globalSig.Length -eq 64) $(if ($globalSig) { "$($globalSig.Length) B" } else { '' })

# ---------- 6. key id matches updater pubkey ----------
$sigKeyId = if ($sigBlock) { -join ($sigBlock[2..9] | ForEach-Object { $_.ToString('x2') }) } else { '' }
$pubKeyId = ''
try {
  $pubRaw = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$conf.plugins.updater.pubkey))
  $pubLines = @($pubRaw -split "`n" | ForEach-Object { $_.TrimEnd("`r") } | Where-Object { $_ -ne '' })
  $pubBlock = [Convert]::FromBase64String($pubLines[1].Trim())
  $pubKeyId = -join ($pubBlock[2..9] | ForEach-Object { $_.ToString('x2') })
} catch {
  $pubKeyId = ''
}
Check 'signature: key id == updater pubkey key id' `
  ($sigKeyId -ne '' -and $sigKeyId -eq $pubKeyId) "sig=$sigKeyId pub=$pubKeyId"

# ---------- 7. exe version resource ----------
$vi = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($exe)
Check 'exe: ProductVersion == expected' `
  ([string]$vi.ProductVersion -eq $Version) "ProductVersion=$($vi.ProductVersion)"
Check 'exe: FileVersion == expected' `
  ([string]$vi.FileVersion -eq $Version) "FileVersion=$($vi.FileVersion)"
Check 'exe: ProductName == tauri.conf productName' `
  ([string]$vi.ProductName -eq [string]$conf.productName) "ProductName=$($vi.ProductName)"

# ---------- summary ----------
$failed = @($script:Results | Where-Object { -not $_.Ok })
Write-Host ''
Write-Host ("RESULT: {0}/{1} PASS" -f ($script:Results.Count - $failed.Count), $script:Results.Count)
if ($failed.Count -gt 0) {
  Write-Host 'Failed checks:' -ForegroundColor Red
  foreach ($f in $failed) { Write-Host ("  - {0} ({1})" -f $f.Name, $f.Detail) -ForegroundColor Red }
  exit 1
}
Write-Host ("release/$Version looks internally consistent.") -ForegroundColor Green
Write-Host 'Reminder: this only proves the LOCAL artifacts agree with each other.'
Write-Host 'Online acceptance still needs: node scripts/check-published-release.mjs (after push).'
exit 0
