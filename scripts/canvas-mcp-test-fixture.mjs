import { createServer } from 'node:http'

export const CANVAS_MCP_TEST_TOKEN = 'canvas-mcp-test-token'

export async function startCanvasMcpGateway() {
  let actionCalls = 0
  const server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${CANVAS_MCP_TEST_TOKEN}`) {
      response.writeHead(401).end()
      return
    }
    if (request.method === 'GET' && request.url === '/capabilities') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          ok: true,
          result: {
            tools: [
              {
                name: 'readGraph',
                description: 'Read the current canvas graph',
                inputSchema: { type: 'object', properties: {} },
              },
            ],
            denied: ['deleteNodes'],
          },
        }),
      )
      return
    }
    if (request.method === 'POST' && request.url === '/action') {
      let body = ''
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        const parsed = JSON.parse(body)
        actionCalls += 1
        response.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            ok: true,
            result: {
              tool: parsed.name,
              idempotencyKey: parsed.idempotencyKey,
              nodes: 2,
            },
          }),
        )
      })
      return
    }
    response.writeHead(404).end()
  })

  const port = await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
  return {
    url: `http://127.0.0.1:${port}`,
    token: CANVAS_MCP_TEST_TOKEN,
    actionCalls: () => actionCalls,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  }
}
