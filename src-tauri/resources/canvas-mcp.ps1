param(
  [switch]$Dev,
  [switch]$ReleaseGate
)

$ErrorActionPreference = 'Stop'

$envUrl = $env:QINGHUA_CANVAS_URL
$envToken = $env:QINGHUA_CANVAS_TOKEN
if ($envUrl -and $envToken) {
  $gatewayUrl = $envUrl.TrimEnd('/')
  $gatewayToken = $envToken
} else {
  $appData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { [Environment]::GetFolderPath('LocalApplicationData') }
  $configName = if ($ReleaseGate) { 'canvas-gateway.release-gate.json' } elseif ($Dev) { 'canvas-gateway.dev.json' } else { 'canvas-gateway.json' }
  $configPath = Join-Path $appData "com.qinghua.canvas\$configName"
  if (-not (Test-Path -LiteralPath $configPath)) {
    throw "Canvas gateway config not found: $configPath"
  }
  $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  if (-not $config.url -or -not $config.token) {
    throw "Canvas gateway config is missing url/token: $configPath"
  }
  $gatewayUrl = ([string]$config.url).TrimEnd('/')
  $gatewayToken = [string]$config.token
}

$headers = @{ Authorization = "Bearer $gatewayToken" }

function Write-Rpc($id, $result) {
  $payload = [ordered]@{
    jsonrpc = '2.0'
    id = $id
    result = $result
  }
  [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress -Depth 64))
  [Console]::Out.Flush()
}

function Write-RpcError($id, $code, $message) {
  $payload = [ordered]@{
    jsonrpc = '2.0'
    id = $id
    error = [ordered]@{ code = $code; message = [string]$message }
  }
  [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress -Depth 32))
  [Console]::Out.Flush()
}

function Invoke-GatewayGet($path) {
  Invoke-RestMethod -Uri "$gatewayUrl$path" -Headers $headers -Method Get -TimeoutSec 35
}

function Invoke-GatewayAction($name, $arguments, $idempotencyKey) {
  $body = [ordered]@{
    name = [string]$name
    arguments = $arguments
    idempotencyKey = [string]$idempotencyKey
  } | ConvertTo-Json -Compress -Depth 64
  Invoke-RestMethod -Uri "$gatewayUrl/action" -Headers $headers -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 35
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $request = $null
  try {
    $request = $line | ConvertFrom-Json
    if ($request.jsonrpc -ne '2.0' -or $null -eq $request.id) { continue }

    switch ([string]$request.method) {
      'initialize' {
        Write-Rpc $request.id ([ordered]@{
          protocolVersion = '2024-11-05'
          capabilities = @{ tools = @{} }
          serverInfo = @{ name = 'qinghua-canvas'; version = '0.1.17' }
        })
      }
      'ping' {
        Write-Rpc $request.id @{}
      }
      'tools/list' {
        $capabilities = Invoke-GatewayGet '/capabilities'
        Write-Rpc $request.id @{
          tools = @($capabilities.result.tools)
        }
      }
      'tools/call' {
        $name = [string]$request.params.name
        if ([string]::IsNullOrWhiteSpace($name)) { throw 'tools/call is missing a tool name' }
        $arguments = if ($null -eq $request.params.arguments) { @{} } else { $request.params.arguments }
        $metaKey = $request.params._meta.idempotencyKey
        $idempotencyKey = if ($metaKey) { [string]$metaKey } else { "mcp:$($request.id)" }
        $response = Invoke-GatewayAction $name $arguments $idempotencyKey
        Write-Rpc $request.id ([ordered]@{
          content = @(@{
            type = 'text'
            text = ($response | ConvertTo-Json -Depth 64)
          })
          isError = ($response.ok -eq $false)
        })
      }
      default {
        Write-RpcError $request.id -32601 "Unknown method: $($request.method)"
      }
    }
  } catch {
    $id = if ($null -ne $request) { $request.id } else { $null }
    Write-RpcError $id -32000 $_.Exception.Message
  }
}
