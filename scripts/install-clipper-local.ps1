param(
  [ValidateSet('Auto', 'Chrome', 'Edge')]
  [string]$Browser = 'Auto',
  [switch]$PrepareOnly
)

$ErrorActionPreference = 'Stop'

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$source = Join-Path $projectRoot 'browser-extension\qinghua-clipper'
$manifestPath = Join-Path $source 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Extension source is incomplete: $source"
}

$documents = [Environment]::GetFolderPath('MyDocuments')
if (-not $documents) {
  throw 'The Windows Documents folder could not be resolved.'
}
$managedRoot = Join-Path $documents 'QinghuaClipper'
$target = [IO.Path]::GetFullPath((Join-Path $managedRoot 'extension'))
$managedPrefix = [IO.Path]::GetFullPath($managedRoot).TrimEnd('\') + '\'
if (-not $target.StartsWith($managedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to write outside the managed directory: $target"
}

if (Test-Path -LiteralPath $target) {
  Remove-Item -LiteralPath $target -Recurse -Force
}
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item -Path (Join-Path $source '*') -Destination $target -Recurse -Force

$copiedManifest = Join-Path $target 'manifest.json'
if (-not (Test-Path -LiteralPath $copiedManifest -PathType Leaf)) {
  throw "manifest.json is missing after copy: $target"
}
foreach ($required in @('background.js', 'drop-target.js', 'popup.html')) {
  if (-not (Test-Path -LiteralPath (Join-Path $target $required) -PathType Leaf)) {
    throw "$required is missing after copy: $target"
  }
}

$manifest = Get-Content -Raw -Encoding utf8 $copiedManifest | ConvertFrom-Json
Set-Clipboard -Value $target

$browserCandidates = @{
  Chrome = @(
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
  )
  Edge = @(
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
  )
}

$selectedBrowser = $null
$selectedName = $null
$requested = if ($Browser -eq 'Auto') { @('Chrome', 'Edge') } else { @($Browser) }
foreach ($name in $requested) {
  $found = $browserCandidates[$name] | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if ($found) {
    $selectedBrowser = $found
    $selectedName = $name
    break
  }
}

Write-Host ''
Write-Host "Qinghua Clipper $($manifest.version) copied to:" -ForegroundColor Green
Write-Host "  $target"
Write-Host 'The stable extension path is now on the clipboard.'
Write-Host ''

if ($PrepareOnly) {
  Write-Host 'PrepareOnly: browser and Explorer were not opened.'
  exit 0
}

if (-not $selectedBrowser) {
  Write-Warning 'Chrome or Edge was not found. Open the browser extensions page manually.'
} else {
  $extensionsUrl = if ($selectedName -eq 'Edge') {
    'edge://extensions/'
  } else {
    'chrome://extensions/'
  }
  Start-Process -FilePath $selectedBrowser -ArgumentList $extensionsUrl
}

$explorerArgs = '/select,"{0}"' -f $copiedManifest
Start-Process -FilePath 'explorer.exe' -ArgumentList $explorerArgs

Write-Host 'Final browser-confirmed step:'
Write-Host '  1. Enable Developer mode on the extensions page.'
Write-Host '  2. Click Load unpacked.'
Write-Host '  3. Press Ctrl+L in the folder picker, paste the clipboard path, and select it.'
Write-Host '  4. Open Qinghua My Assets -> Qinghua Plugin and paste the local endpoint and pairing token.'
Write-Host ''
Write-Host 'Chrome / Edge will remember this directory; no reinstall is needed on later launches.'
