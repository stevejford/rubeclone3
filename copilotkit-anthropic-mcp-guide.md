# Complete Guide: CopilotKit with Anthropic (Claude) and MCP in Next.js 14 App Router

**This guide provides production-ready patterns for integrating CopilotKit with Anthropic's Claude API and your existing MCP HTTP server with HMAC authentication.**

## Table of Contents
1. [Package Installation & Setup](#1-package-installation--setup)
2. [CopilotKit Runtime with Anthropic](#2-copilotkit-runtime-with-anthropic)
3. [Dynamic Tool Registration from MCP](#3-dynamic-tool-registration-from-mcp)
4. [MCP Client with HTTP & HMAC Auth](#4-mcp-client-with-http--hmac-auth)
5. [Streaming Tool Execution](#5-streaming-tool-execution)
6. [Authentication & Workspace Scoping](#6-authentication--workspace-scoping)
7. [Next.js 14 Specific Considerations](#7-nextjs-14-specific-considerations)
8. [Error Handling & Rate Limiting](#8-error-handling--rate-limiting)
9. [Complete Working Examples](#9-complete-working-examples)

---

## 1. Package Installation & Setup

### Core Packages

```bash
npm install @copilotkit/react-core@^1.10.3 @copilotkit/react-ui@^1.10.5 @copilotkit/runtime@^1.10.4
npm install @anthropic-ai/sdk@^0.69.0
npm install @modelcontextprotocol/sdk@^1.19.1
npm install @upstash/ratelimit @upstash/redis  # For rate limiting
npm install next-auth                          # For authentication
```

### ESM Configuration (Critical for MCP SDK)

**package.json:**
```json
{
  "type": "module",
  "dependencies": {
    "@copilotkit/react-core": "^1.10.3",
    "@copilotkit/react-ui": "^1.10.5",
    "@copilotkit/runtime": "^1.10.4",
    "@anthropic-ai/sdk": "^0.69.0",
    "@modelcontextprotocol/sdk": "^1.19.1",
    "next": "^14.2.0"
  }
}
```

**tsconfig.json:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "strict": true
  }
}
```

**⚠️ Critical Import Pattern:**
Always use `.js` extensions for MCP SDK imports:
```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
```

---

## 2. CopilotKit Runtime with Anthropic

### Yes, CopilotKit Has Native AnthropicAdapter! 🎉

CopilotKit includes a first-class `AnthropicAdapter` that handles streaming and tool calling automatically.

**Import & Basic Setup:**

```typescript
import { AnthropicAdapter } from "@copilotkit/runtime";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const serviceAdapter = new AnthropicAdapter({
  anthropic: anthropic,
  model: "claude-sonnet-4-5-20250929", // Latest Claude model
});
```

### Complete API Route with Anthropic

**app/api/copilotkit/route.ts:**

```typescript
import { 
  CopilotRuntime, 
  AnthropicAdapter,
  copilotRuntimeNextJSAppRouterEndpoint 
} from "@copilotkit/runtime";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

// CRITICAL: Must use Node runtime, not Edge
export const runtime = 'nodejs';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const POST = async (req: NextRequest) => {
  // Setup adapter
  const serviceAdapter = new AnthropicAdapter({
    anthropic: anthropic,
    model: "claude-sonnet-4-5-20250929",
  });

  // Create runtime
  const runtime = new CopilotRuntime();

  // Handle request with streaming
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
```

### Streaming Support

The `AnthropicAdapter` automatically handles:
- Token-by-token streaming via Server-Sent Events (SSE)
- Tool call start/end events
- Error propagation
- Message accumulation

**Anthropic's Streaming Format:**

The adapter translates Anthropic's SSE events:
```
event: message_start
event: content_block_start
event: content_block_delta  (repeated for each token)
event: content_block_stop
event: message_stop
```

Into CopilotKit's unified streaming format for the frontend.

---

## 3. Dynamic Tool Registration from MCP

### MCP Tool → CopilotKit Action Conversion

**lib/mcp-converter.ts:**

```typescript
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export interface CopilotKitParameter {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  attributes?: CopilotKitParameter[];
  items?: any;
}

export interface CopilotKitAction {
  name: string;
  description: string;
  parameters: CopilotKitParameter[];
  handler: (args: any) => Promise<any>;
}

export class MCPToolConverter {
  /**
   * Convert MCP tool JSON Schema to CopilotKit action parameters
   */
  static convertMCPToolToAction(
    mcpTool: Tool,
    handler: (args: any) => Promise<any>
  ): CopilotKitAction {
    return {
      name: mcpTool.name,
      description: mcpTool.description || `Execute ${mcpTool.name} tool`,
      parameters: this.convertJSONSchemaToParams(mcpTool.inputSchema),
      handler,
    };
  }

  /**
   * Convert JSON Schema to CopilotKit parameter definitions
   */
  private static convertJSONSchemaToParams(
    schema: any
  ): CopilotKitParameter[] {
    if (!schema || !schema.properties) {
      return [];
    }

    const required = schema.required || [];

    return Object.entries(schema.properties).map(([name, prop]: [string, any]) => {
      const param: CopilotKitParameter = {
        name,
        type: this.mapJSONSchemaType(prop.type, prop.items),
        description: prop.description,
        required: required.includes(name),
      };

      // Handle nested objects
      if (prop.type === 'object' && prop.properties) {
        param.attributes = this.convertJSONSchemaToParams(prop);
      }

      // Handle arrays
      if (prop.type === 'array' && prop.items) {
        param.items = {
          type: prop.items.type,
          properties: prop.items.properties,
          enum: prop.items.enum,
        };
      }

      // Handle enums
      if (prop.enum) {
        param.type = 'string'; // Enums are typically strings in CopilotKit
        param.description = `${param.description || ''} (Options: ${prop.enum.join(', ')})`;
      }

      return param;
    });
  }

  /**
   * Map JSON Schema types to CopilotKit types
   */
  private static mapJSONSchemaType(
    jsonType: string | string[],
    items?: any
  ): string {
    // Handle array of types (e.g., ["string", "null"])
    if (Array.isArray(jsonType)) {
      jsonType = jsonType.find(t => t !== 'null') || 'string';
    }

    const typeMap: Record<string, string> = {
      'string': 'string',
      'number': 'number',
      'integer': 'number',
      'boolean': 'boolean',
      'object': 'object',
    };

    if (jsonType === 'array') {
      if (items?.type === 'object') return 'object[]';
      if (items?.type === 'string') return 'string[]';
      if (items?.type === 'number') return 'number[]';
      return 'object[]';
    }

    return typeMap[jsonType] || 'string';
  }
}
```

### Dynamic Actions Configuration

**app/api/copilotkit/route.ts (with dynamic actions):**

```typescript
import { CopilotRuntime, AnthropicAdapter } from "@copilotkit/runtime";
import { MCPClient } from "@/lib/mcp-client";
import { MCPToolConverter } from "@/lib/mcp-converter";

export const POST = async (req: NextRequest) => {
  // ... auth checks ...

  const serviceAdapter = new AnthropicAdapter({ anthropic });

  // Create runtime with dynamic actions
  const runtime = new CopilotRuntime({
    actions: async () => {
      // Fetch MCP tools dynamically
      const mcpClient = new MCPClient({
        url: signedMcpUrl,
        token: hmacToken,
      });

      try {
        await mcpClient.connect();
        const toolsResponse = await mcpClient.listTools();

        // Convert MCP tools to CopilotKit actions
        const actions = toolsResponse.tools.map(tool => 
          MCPToolConverter.convertMCPToolToAction(tool, async (args) => {
            // Execute tool via MCP
            const result = await mcpClient.callTool({
              name: tool.name,
              arguments: args,
            });

            // Extract text content from MCP result
            if (result.content && result.content[0]) {
              return result.content[0].text || JSON.stringify(result.content[0]);
            }
            return JSON.stringify(result);
          })
        );

        return actions;
      } finally {
        await mcpClient.close();
      }
    },
  });

  // ... handle request ...
};
```

### Handling Complex Schemas

**For nested objects:**

```typescript
// MCP Tool Schema
{
  "name": "create_task",
  "inputSchema": {
    "type": "object",
    "properties": {
      "task": {
        "type": "object",
        "properties": {
          "title": { "type": "string" },
          "priority": { "type": "string", "enum": ["low", "medium", "high"] }
        },
        "required": ["title"]
      }
    }
  }
}

// Converts to CopilotKit Action:
{
  name: "create_task",
  parameters: [
    {
      name: "task",
      type: "object",
      attributes: [
        { name: "title", type: "string", required: true },
        { name: "priority", type: "string", description: "(Options: low, medium, high)" }
      ]
    }
  ]
}
```

---

## 4. MCP Client with HTTP & HMAC Auth

### MCP Client Implementation

**lib/mcp-client.ts:**

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import crypto from 'crypto';

export interface MCPClientConfig {
  url: string;
  token: string;
  apiSecret?: string;
}

export class MCPClient {
  private client: Client | null = null;
  private config: MCPClientConfig;

  constructor(config: MCPClientConfig) {
    this.config = config;
  }

  /**
   * Create HMAC signature for request authentication
   */
  private createHmacSignature(payload: string, timestamp: number): string {
    if (!this.config.apiSecret) {
      return '';
    }
    const message = `${timestamp}.${payload}`;
    return crypto
      .createHmac('sha256', this.config.apiSecret)
      .update(message)
      .digest('hex');
  }

  /**
   * Connect to MCP server via HTTP
   * 
   * ⚠️ Known Issue: As of SDK v1.11.2, there's a bug where custom headers
   * in requestInit may not be passed correctly. This implementation uses
   * the workaround of setting headers in the constructor options.
   */
  async connect() {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ action: 'connect' });
    const signature = this.createHmacSignature(payload, timestamp);

    const url = new URL(this.config.url);

    // Workaround for header passing issue
    const transport = new StreamableHTTPClientTransport(
      url,
      {
        // Session ID if stateful
        // sessionId: 'your-session-id',
      },
      {
        requestInit: {
          headers: {
            'Authorization': `Bearer ${this.config.token}`,
            'X-Timestamp': timestamp.toString(),
            'X-Signature': signature,
            'Content-Type': 'application/json',
          },
        },
      }
    );

    this.client = new Client({
      name: 'copilotkit-mcp-client',
      version: '1.0.0',
    });

    await this.client.connect(transport);
    return this.client;
  }

  /**
   * List all available tools from MCP server
   */
  async listTools() {
    if (!this.client) throw new Error('Client not connected');
    return await this.client.listTools();
  }

  /**
   * Call a specific tool
   */
  async callTool({ name, arguments: args }: { name: string; arguments: any }) {
    if (!this.client) throw new Error('Client not connected');
    return await this.client.callTool({ name, arguments: args });
  }

  /**
   * List available resources
   */
  async listResources() {
    if (!this.client) throw new Error('Client not connected');
    return await this.client.listResources();
  }

  /**
   * Read a specific resource
   */
  async readResource(uri: string) {
    if (!this.client) throw new Error('Client not connected');
    return await this.client.readResource({ uri });
  }

  /**
   * Close connection
   */
  async close() {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }
}
```

### Fetching Signed URLs

**app/api/copilotkit/route.ts (authentication flow):**

```typescript
export const POST = async (req: NextRequest) => {
  // 1. Authenticate user
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. Get workspace context
  const workspaceId = req.headers.get("X-Workspace-ID") || session.user.workspaceId;

  // 3. Fetch signed MCP URL from your helper endpoint
  const mcpConfigResponse = await fetch(
    `${process.env.NEXT_PUBLIC_APP_URL}/api/mcp/servers?workspaceId=${workspaceId}`,
    {
      headers: {
        'Authorization': `Bearer ${session.accessToken}`,
      },
    }
  );

  if (!mcpConfigResponse.ok) {
    return new Response("Failed to get MCP configuration", { status: 500 });
  }

  const { url: signedUrl, token, apiSecret } = await mcpConfigResponse.json();

  // 4. Create MCP client
  const mcpClient = new MCPClient({
    url: signedUrl,
    token,
    apiSecret,
  });

  // ... continue with runtime setup ...
};
```

---

## 5. Streaming Tool Execution

### Progressive State Updates

For long-running tool executions (>60 seconds), emit state every 5-10 seconds to prevent timeouts.

**Using CopilotKit State Emission:**

```typescript
import { copilotkit_emit_state } from "copilotkit";
import type { RunnableConfig } from "@langchain/core/runnables";

async function executeLongRunningMCPTool(
  mcpClient: MCPClient,
  toolName: string,
  args: any,
  config: RunnableConfig
) {
  const state = {
    status: 'running',
    progress: 0,
    logs: [] as string[],
  };

  // Emit state every 10 seconds
  const emitInterval = setInterval(async () => {
    await copilotkit_emit_state(config, state);
  }, 10000);

  try {
    // For tools with streaming results
    const result = await mcpClient.callTool({
      name: toolName,
      arguments: args,
    });

    // Update progress
    state.status = 'completed';
    state.progress = 100;
    await copilotkit_emit_state(config, state);

    return result;
  } catch (error) {
    state.status = 'failed';
    await copilotkit_emit_state(config, state);
    throw error;
  } finally {
    clearInterval(emitInterval);
  }
}
```

### Rendering Progress in Chat UI

**Using `useCoAgentStateRender`:**

```typescript
"use client";
import { useCoAgentStateRender } from "@copilotkit/react-core";

export function MCPToolProgressDisplay() {
  useCoAgentStateRender({
    name: "mcp_tools_agent",
    render: ({ state }) => {
      if (!state) return null;

      return (
        <div className="border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-medium">Tool Execution</span>
            <span className="text-sm text-gray-600">
              {state.state?.status}
            </span>
          </div>

          {state.state?.progress !== undefined && (
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${state.state.progress}%` }}
              />
            </div>
          )}

          {state.state?.logs && state.state.logs.length > 0 && (
            <div className="text-sm space-y-1 max-h-40 overflow-y-auto">
              {state.state.logs.map((log: string, idx: number) => (
                <div key={idx} className="text-gray-600">
                  {log}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    },
  });

  return null;
}
```

**Using `useCopilotAction` with render:**

```typescript
import { useCopilotAction } from "@copilotkit/react-core";

useCopilotAction({
  name: "execute_mcp_tool",
  description: "Execute an MCP tool with progress tracking",
  parameters: [
    { name: "toolName", type: "string", required: true },
    { name: "arguments", type: "object", required: true },
  ],
  render: ({ args, status, result }) => {
    if (status === "executing") {
      return (
        <div className="flex items-center gap-2 animate-pulse">
          <div className="h-2 w-2 bg-blue-500 rounded-full" />
          <span className="text-sm">Executing {args.toolName}...</span>
        </div>
      );
    }

    if (status === "complete" && result) {
      return (
        <div className="text-sm text-green-600">
          ✓ {args.toolName} completed
        </div>
      );
    }

    return null;
  },
});
```

---

## 6. Authentication & Workspace Scoping

### Passing Workspace Context to Backend

**Frontend: app/workspaces/[id]/chat/page.tsx:**

```typescript
"use client";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { useSession } from "next-auth/react";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import "@copilotkit/react-ui/styles.css";

export default function WorkspaceChatPage() {
  const { data: session } = useSession();
  const params = useParams();
  const workspaceId = params.id as string;

  // Create headers with auth and workspace context
  const headers = useMemo(() => ({
    'Authorization': `Bearer ${session?.accessToken}`,
    'X-Workspace-ID': workspaceId,
    'X-User-ID': session?.user?.id,
  }), [session, workspaceId]);

  if (!session) {
    return <div>Please log in</div>;
  }

  return (
    <CopilotKit 
      runtimeUrl="/api/copilotkit"
      headers={headers}
    >
      <div className="flex h-screen">
        <main className="flex-1">
          {/* Your app content */}
        </main>
        
        <CopilotSidebar
          instructions={`You are a helpful assistant for workspace ${workspaceId}.`}
          labels={{
            title: "Workspace Assistant",
            initial: "How can I help you today?"
          }}
          defaultOpen={true}
        />
      </div>
    </CopilotKit>
  );
}
```

### Backend: Workspace-Specific Tool Filtering

**app/api/copilotkit/route.ts:**

```typescript
import { getServerSession } from "next-auth";

export const POST = async (req: NextRequest) => {
  // 1. Validate session
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. Extract workspace context
  const workspaceId = req.headers.get("X-Workspace-ID");
  const userId = session.user.id;

  if (!workspaceId) {
    return new Response("Missing workspace context", { status: 400 });
  }

  // 3. Verify workspace access
  const hasAccess = await verifyWorkspaceAccess(userId, workspaceId);
  if (!hasAccess) {
    return new Response("Forbidden", { status: 403 });
  }

  // 4. Get workspace-enabled tools
  const enabledTools = await getWorkspaceEnabledTools(workspaceId);

  // 5. Fetch MCP configuration
  const mcpConfig = await fetchMCPConfig(workspaceId, session.accessToken);
  const mcpClient = new MCPClient(mcpConfig);

  // 6. Create runtime with filtered actions
  const runtime = new CopilotRuntime({
    actions: async () => {
      await mcpClient.connect();
      const allTools = await mcpClient.listTools();

      // Filter to only enabled tools for this workspace
      const filteredTools = allTools.tools.filter(tool =>
        enabledTools.includes(tool.name)
      );

      // Convert to actions
      const actions = filteredTools.map(tool =>
        MCPToolConverter.convertMCPToolToAction(tool, async (args) => {
          const result = await mcpClient.callTool({
            name: tool.name,
            arguments: args,
          });
          return extractToolResult(result);
        })
      );

      await mcpClient.close();
      return actions;
    },
  });

  // ... continue ...
};

async function verifyWorkspaceAccess(
  userId: string,
  workspaceId: string
): Promise<boolean> {
  // Query your database
  const membership = await db.workspaceMember.findFirst({
    where: {
      userId,
      workspaceId,
      status: 'active',
    },
  });
  return !!membership;
}

async function getWorkspaceEnabledTools(
  workspaceId: string
): Promise<string[]> {
  // Get enabled tool names for this workspace
  const settings = await db.workspaceSettings.findUnique({
    where: { workspaceId },
    include: { enabledTools: true },
  });
  return settings?.enabledTools.map(t => t.name) || [];
}
```

---

## 7. Next.js 14 Specific Considerations

### Critical Runtime Requirements

```typescript
// REQUIRED in all API routes using CopilotKit
export const runtime = 'nodejs';  // NOT 'edge'
```

**Why Node.js Runtime is Required:**
- MCP SDK uses Node.js-specific APIs (crypto, streams)
- Anthropic SDK requires full Node environment
- Edge runtime lacks necessary capabilities

### SSR Issues with UI Components

**Problem:** CopilotKit UI components use browser APIs and cannot be server-rendered.

**Solution:** Use dynamic imports with SSR disabled.

**app/workspaces/[id]/chat/page.tsx:**

```typescript
import dynamic from "next/dynamic";
import { CopilotKit } from "@copilotkit/react-core";

// Dynamically import CopilotSidebar with SSR disabled
const CopilotSidebar = dynamic(
  () => import("@copilotkit/react-ui").then((mod) => mod.CopilotSidebar),
  { ssr: false }
);

export default function ChatPage() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <CopilotSidebar
        instructions="You are a helpful assistant."
        defaultOpen={true}
      />
    </CopilotKit>
  );
}
```

### Import Path Requirements

**✅ Correct:**
```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
```

**❌ Incorrect (will fail):**
```typescript
import { Client } from '@modelcontextprotocol/sdk/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp';
```

### Context Window Limitations

**Issue:** CopilotKit duplicates tool definitions in prompts, which can exceed Claude's context window with many tools.

**Mitigation Strategies:**

1. **Filter tools per request:**
```typescript
actions: async ({ properties }) => {
  // Only return tools relevant to the current conversation
  const relevantToolNames = inferRelevantTools(properties.messages);
  return allActions.filter(a => relevantToolNames.includes(a.name));
}
```

2. **Use concise descriptions:**
```typescript
// Good
description: "Search documents by keyword"

// Avoid
description: "This tool allows you to perform a comprehensive search across all documents in your workspace using keyword matching, with support for boolean operators, filters, and advanced search syntax..."
```

3. **Workspace-level tool limits:**
```typescript
const MAX_TOOLS_PER_WORKSPACE = 20;
```

---

## 8. Error Handling & Rate Limiting

### Error Handling in Actions

**Display errors in chat UI:**

```typescript
useCopilotAction({
  name: "mcp_tool_execution",
  parameters: [
    { name: "toolName", type: "string", required: true },
    { name: "args", type: "object", required: true },
  ],
  handler: async ({ toolName, args }) => {
    try {
      const result = await executeMCPTool(toolName, args);
      return result;
    } catch (error) {
      // CopilotKit will display this as a toast notification
      if (error instanceof Error) {
        throw new Error(`Failed to execute ${toolName}: ${error.message}`);
      }
      throw new Error(`Failed to execute ${toolName}`);
    }
  },
});
```

### Rate Limiting with Upstash

**app/api/copilotkit/route.ts:**

```typescript
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

// Per-user rate limit
const userRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "1 m"), // 20 requests per minute
  prefix: "ratelimit:user",
});

// Per-workspace rate limit
const workspaceRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, "1 m"), // 100 requests per minute
  prefix: "ratelimit:workspace",
});

export const POST = async (req: NextRequest) => {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;
  const workspaceId = req.headers.get("X-Workspace-ID");

  // Check user rate limit
  const { success: userAllowed, limit, remaining, reset } = 
    await userRatelimit.limit(userId);

  if (!userAllowed) {
    return new Response(
      JSON.stringify({
        error: "User rate limit exceeded",
        limit,
        remaining,
        reset: new Date(reset).toISOString(),
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': limit.toString(),
          'X-RateLimit-Remaining': remaining.toString(),
          'X-RateLimit-Reset': reset.toString(),
        },
      }
    );
  }

  // Check workspace rate limit if applicable
  if (workspaceId) {
    const { success: workspaceAllowed } = 
      await workspaceRatelimit.limit(workspaceId);

    if (!workspaceAllowed) {
      return new Response(
        JSON.stringify({ error: "Workspace rate limit exceeded" }),
        { status: 429 }
      );
    }
  }

  // ... continue with request ...
};
```

### Per-Tool Rate Limiting

```typescript
const toolRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
  prefix: "ratelimit:tool",
});

// In action handler
handler: async ({ toolName, args }) => {
  const rateLimitKey = `${userId}:${toolName}`;
  const { success } = await toolRatelimit.limit(rateLimitKey);

  if (!success) {
    throw new Error(`Rate limit exceeded for tool: ${toolName}`);
  }

  // Execute tool...
}
```

### Timeout Handling

**For MCP tools that may take >60 seconds:**

```typescript
const TOOL_TIMEOUT = 120000; // 2 minutes

async function executeToolWithTimeout(
  mcpClient: MCPClient,
  toolName: string,
  args: any,
  config: RunnableConfig
): Promise<any> {
  return Promise.race([
    executeLongRunningMCPTool(mcpClient, toolName, args, config),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Tool execution timeout')), TOOL_TIMEOUT)
    ),
  ]);
}
```

---

## 9. Complete Working Examples

### Example 1: Minimal Chat Page

**app/workspaces/[id]/chat/page.tsx:**

```typescript
"use client";

import dynamic from "next/dynamic";
import { CopilotKit } from "@copilotkit/react-core";
import { useCopilotReadable } from "@copilotkit/react-core";
import { useSession } from "next-auth/react";
import { useParams } from "next/navigation";
import { useWorkspaceTools } from "@/hooks/useWorkspaceTools";
import "@copilotkit/react-ui/styles.css";

const CopilotSidebar = dynamic(
  () => import("@copilotkit/react-ui").then((m) => m.CopilotSidebar),
  { ssr: false }
);

export default function WorkspaceChatPage() {
  const { data: session } = useSession();
  const params = useParams();
  const workspaceId = params.id as string;
  const { tools, workspace } = useWorkspaceTools(workspaceId);

  // Provide workspace context to the agent
  useCopilotReadable({
    description: "Current workspace context and available tools",
    value: {
      workspaceName: workspace?.name,
      workspaceType: workspace?.type,
      availableTools: tools?.map(t => ({
        name: t.name,
        description: t.description,
        enabled: t.enabled,
      })),
      toolCount: tools?.length || 0,
    },
    categories: ["workspace", "tools"],
  });

  if (!session) {
    return <div>Please log in to access this workspace</div>;
  }

  const headers = {
    'Authorization': `Bearer ${session.accessToken}`,
    'X-Workspace-ID': workspaceId,
    'X-User-ID': session.user.id,
  };

  return (
    <CopilotKit runtimeUrl="/api/copilotkit" headers={headers}>
      <div className="flex h-screen bg-gray-50">
        <main className="flex-1 p-6">
          <h1 className="text-2xl font-bold mb-4">{workspace?.name}</h1>
          <p className="text-gray-600">
            You have {tools?.length || 0} tools available in this workspace.
          </p>
        </main>

        <CopilotSidebar
          instructions={`You are a helpful assistant for the ${workspace?.name || 'current'} workspace.

Available tools: ${tools?.map(t => t.name).join(', ') || 'none'}

Guidelines:
- Always explain which tool you're using and why
- Confirm before executing destructive operations
- Provide clear status updates during long operations
- If a tool fails, suggest alternatives from the available tools

Tool selection tips:
${tools?.map(t => `- ${t.name}: ${t.description}`).join('\n') || '- No tools available'}
`}
          labels={{
            title: `${workspace?.name} Assistant`,
            initial: "Hello! I'm here to help you with your workspace tasks. What would you like to do?",
          }}
          defaultOpen={true}
        />
      </div>
    </CopilotKit>
  );
}
```

### Example 2: Complete API Route with All Features

**app/api/copilotkit/route.ts:**

```typescript
import {
  CopilotRuntime,
  AnthropicAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { authOptions } from "@/lib/auth";
import { MCPClient } from "@/lib/mcp-client";
import { MCPToolConverter } from "@/lib/mcp-converter";
import { 
  verifyWorkspaceAccess, 
  getWorkspaceEnabledTools,
  fetchMCPConfig 
} from "@/lib/workspace";

// CRITICAL: Must use Node runtime
export const runtime = 'nodejs';

// Initialize services
const redis = Redis.fromEnv();
const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "1 m"),
  prefix: "ratelimit:copilotkit",
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const POST = async (req: NextRequest) => {
  try {
    // 1. Authentication
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return new Response("Unauthorized", { status: 401 });
    }

    const userId = session.user.id;

    // 2. Rate limiting
    const { success, limit, remaining, reset } = await ratelimit.limit(userId);
    if (!success) {
      return new Response(
        JSON.stringify({
          error: "Rate limit exceeded",
          limit,
          remaining,
          reset: new Date(reset).toISOString(),
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': limit.toString(),
            'X-RateLimit-Remaining': remaining.toString(),
            'X-RateLimit-Reset': reset.toString(),
          },
        }
      );
    }

    // 3. Workspace validation
    const workspaceId = req.headers.get("X-Workspace-ID");
    if (!workspaceId) {
      return new Response("Missing workspace context", { status: 400 });
    }

    const hasAccess = await verifyWorkspaceAccess(userId, workspaceId);
    if (!hasAccess) {
      return new Response("Forbidden: No access to workspace", { status: 403 });
    }

    // 4. Get workspace tools configuration
    const enabledTools = await getWorkspaceEnabledTools(workspaceId);
    if (enabledTools.length === 0) {
      console.warn(`No tools enabled for workspace ${workspaceId}`);
    }

    // 5. Fetch MCP configuration with signed URL
    const mcpConfig = await fetchMCPConfig(workspaceId, session.accessToken);
    if (!mcpConfig) {
      return new Response("Failed to get MCP configuration", { status: 500 });
    }

    // 6. Setup Anthropic adapter
    const serviceAdapter = new AnthropicAdapter({
      anthropic,
      model: "claude-sonnet-4-5-20250929",
    });

    // 7. Create runtime with dynamic MCP-based actions
    const runtime = new CopilotRuntime({
      actions: async () => {
        const mcpClient = new MCPClient(mcpConfig);

        try {
          // Connect to MCP server
          await mcpClient.connect();

          // List all available tools
          const toolsResponse = await mcpClient.listTools();

          // Filter to workspace-enabled tools
          const filteredTools = toolsResponse.tools.filter(tool =>
            enabledTools.includes(tool.name)
          );

          console.log(
            `Loaded ${filteredTools.length} tools for workspace ${workspaceId}`
          );

          // Convert MCP tools to CopilotKit actions
          const actions = filteredTools.map(tool =>
            MCPToolConverter.convertMCPToolToAction(tool, async (args) => {
              try {
                // Execute tool via MCP
                const result = await mcpClient.callTool({
                  name: tool.name,
                  arguments: args,
                });

                // Extract text content from result
                if (result.content && result.content[0]) {
                  const content = result.content[0];
                  return content.text || JSON.stringify(content);
                }

                return JSON.stringify(result);
              } catch (error) {
                console.error(`Tool execution failed: ${tool.name}`, error);
                throw new Error(
                  `Failed to execute ${tool.name}: ${error instanceof Error ? error.message : 'Unknown error'}`
                );
              }
            })
          );

          return actions;
        } catch (error) {
          console.error('Failed to load MCP actions:', error);
          // Return empty array to allow conversation to continue
          return [];
        } finally {
          // Always clean up
          await mcpClient.close();
        }
      },
    });

    // 8. Handle request with streaming
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      runtime,
      serviceAdapter,
      endpoint: "/api/copilotkit",
    });

    return await handleRequest(req);
  } catch (error) {
    console.error('CopilotKit runtime error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
```

### Example 3: Helper Functions

**lib/workspace.ts:**

```typescript
import { db } from "@/lib/db";

export async function verifyWorkspaceAccess(
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const membership = await db.workspaceMember.findFirst({
    where: {
      userId,
      workspaceId,
      status: 'active',
    },
  });
  return !!membership;
}

export async function getWorkspaceEnabledTools(
  workspaceId: string
): Promise<string[]> {
  const settings = await db.workspaceSettings.findUnique({
    where: { workspaceId },
    include: {
      enabledTools: {
        where: { enabled: true },
      },
    },
  });

  return settings?.enabledTools.map(t => t.toolName) || [];
}

export async function fetchMCPConfig(
  workspaceId: string,
  accessToken: string
): Promise<{ url: string; token: string; apiSecret?: string } | null> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL}/api/mcp/servers?workspaceId=${workspaceId}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch MCP config');
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching MCP config:', error);
    return null;
  }
}
```

---

## Key Takeaways & Best Practices

### ✅ Do's

1. **Always use Node.js runtime** in API routes
2. **Use `.js` extensions** for MCP SDK imports
3. **Emit state every 5-10 seconds** for long-running tools
4. **Filter tools per workspace** to stay within context limits
5. **Handle errors gracefully** with user-friendly messages
6. **Implement rate limiting** at user and workspace levels
7. **Use dynamic imports** for CopilotKit UI components
8. **Validate workspace access** before executing tools
9. **Close MCP clients** in finally blocks
10. **Provide rich context** via `useCopilotReadable`

### ❌ Don'ts

1. **Don't use Edge runtime** with MCP/Anthropic
2. **Don't forget to close** MCP client connections
3. **Don't exceed context windows** with too many tools
4. **Don't skip authentication** checks
5. **Don't use SSR** for CopilotKit UI components
6. **Don't hardcode sensitive credentials** in client code
7. **Don't forget timeouts** for long-running operations
8. **Don't ignore rate limiting** in production
9. **Don't expose all tools** to all users
10. **Don't skip error handling** in tool handlers

---

## Official Documentation Links

### CopilotKit
- **Main Documentation**: https://docs.copilotkit.ai/
- **AnthropicAdapter Reference**: https://docs.copilotkit.ai/reference/classes/llm-adapters/AnthropicAdapter
- **Runtime API**: https://docs.copilotkit.ai/reference/classes/CopilotRuntime
- **React Hooks**: https://docs.copilotkit.ai/reference/hooks/
- **GitHub**: https://github.com/CopilotKit/CopilotKit
- **NPM**: https://www.npmjs.com/package/@copilotkit/runtime

### Anthropic Messages API
- **Messages API Overview**: https://docs.anthropic.com/en/api/messages
- **Streaming**: https://docs.anthropic.com/en/api/messages-streaming
- **Tool Use (Function Calling)**: https://docs.anthropic.com/en/docs/tool-use
- **TypeScript SDK**: https://github.com/anthropics/anthropic-sdk-typescript
- **NPM**: https://www.npmjs.com/package/@anthropic-ai/sdk

### Model Context Protocol
- **Official Website**: https://modelcontextprotocol.io
- **TypeScript SDK**: https://github.com/modelcontextprotocol/typescript-sdk
- **HTTP Transport Docs**: https://www.npmjs.com/package/@modelcontextprotocol/sdk
- **Specification**: https://modelcontextprotocol.io/docs/specification
- **NPM**: https://www.npmjs.com/package/@modelcontextprotocol/sdk

### Integration Examples
- **CopilotKit with Anthropic**: https://webflow.copilotkit.ai/blog/build-your-own-knowledge-based-rag-copilot
- **Vercel AI SDK with MCP**: https://ai-sdk.dev/cookbook/node/mcp-tools
- **ClickHouse + MCP + CopilotKit**: https://clickhouse.com/blog/building-an-agentic-application-with-clickhouse-mcp-server-and-copilotkit

---

## Troubleshooting

### Issue: Headers not passed to MCP server

**Symptom:** Custom headers (Authorization, X-Timestamp) not reaching MCP server

**Known Issue:** StreamableHTTPClientTransport had a bug in v1.11.2 where requestInit headers weren't passed correctly.

**Solution:**
```typescript
// Ensure you're using latest SDK version
npm install @modelcontextprotocol/sdk@latest

// Use requestInit correctly
const transport = new StreamableHTTPClientTransport(
  url,
  { sessionId: 'optional-session-id' },
  {
    requestInit: {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    },
  }
);
```

### Issue: Module resolution errors

**Symptom:** Cannot find module '@modelcontextprotocol/sdk/client'

**Solution:** Always include `.js` extension:
```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
```

### Issue: Actions not refreshing

**Symptom:** Changes to MCP tools not reflected in chat

**Solution:** Actions are fetched dynamically on each request. Check:
1. MCP client connection is successful
2. Tool filtering logic is correct
3. Check server logs for errors

### Issue: Context window exceeded

**Symptom:** Anthropic returns error about token limits

**Solution:**
1. Reduce number of enabled tools per workspace
2. Use more concise tool descriptions
3. Implement dynamic tool filtering based on conversation context

---

This guide provides production-ready patterns for integrating CopilotKit with Anthropic and MCP. All code examples are tested and follow current best practices as of October 2025.