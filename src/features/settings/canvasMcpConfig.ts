export interface CanvasMcpConfigShape {
  mcpServers?: Record<string, { command?: unknown; args?: unknown }>
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

/** Codex reads stdio servers from config.toml; other harnesses use the JSON shape. */
export function codexMcpConfigText(config: unknown): string {
  const shape = config as CanvasMcpConfigShape | null
  const entry = shape?.mcpServers
    ? Object.entries(shape.mcpServers).find(([, server]) => typeof server.command === 'string')
    : undefined
  if (!entry) return ''
  const [name, server] = entry
  const args = Array.isArray(server.args)
    ? server.args.filter((item): item is string => typeof item === 'string')
    : []
  return [
    `[mcp_servers.${name}]`,
    `command = ${tomlString(String(server.command))}`,
    `args = [${args.map(tomlString).join(', ')}]`,
  ].join('\n')
}
