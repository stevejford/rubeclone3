import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

export interface MCPClientConfig {
  url: string
  token: string
}

export class MCPClient {
  private client: Client | null = null
  constructor(private config: MCPClientConfig) {}

  async connect() {
    const url = new URL(this.config.url)
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
        },
      },
    })

    this.client = new Client({ name: 'copilotkit-mcp-client', version: '1.0.0' })
    await this.client.connect(transport as any)
    return this.client
  }

  async listTools() {
    if (!this.client) throw new Error('MCP client not connected')
    return await this.client.listTools()
  }

  async callTool(opts: { name: string; arguments: any }) {
    if (!this.client) throw new Error('MCP client not connected')
    return await this.client.callTool(opts)
  }

  async close() {
    if (this.client) {
      await this.client.close()
      this.client = null
    }
  }
}
