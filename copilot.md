# Integrating CopilotKit with Model Context Protocol in Next.js 14 App Router

**CopilotKit has native MCP support built into the framework.** You can use the first-class integration for rapid setup, or implement a custom action adapter pattern for advanced control over your existing MCP HTTP endpoint with HMAC authentication.

## 1. CopilotKit Current Packages and Setup

### Latest Stable Versions (October 2025)

```bash
npm install @copilotkit/react-core@1.10.3 @copilotkit/react-ui@1.10.5 @copilotkit/runtime@1.10.4
```

**Core Packages:**
- `@copilotkit/react-core` - Core hooks and provider
- `@copilotkit/react-ui` - Pre-built chat components
- `@copilotkit/runtime` - Server-side runtime for self-hosted setups

**MCP SDK Package:**
```bash
npm install @modelcontextprotocol/sdk
```

### Minimal Working Example (Next.js 14 App Router)

**app/layout.tsx:**
```typescript
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <CopilotKit runtimeUrl="/api/copilotkit">
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}
```

**app/page.tsx:**
```typescript
"use client";
import { CopilotChat } from "@copilotkit/react-ui";

export default function Page() {
  return (
    <div className="h-screen">
      <CopilotChat 
        instructions="You are a helpful assistant with access to tools."
        labels={{ title: "AI Assistant" }}
      />
    </div>
  );
}
```

## 2. Two Integration Approaches

### Approach A: Native MCP Support (Recommended for Simple Use Cases)

CopilotKit provides **first-class MCP integration** via the `setMcpServers` method. This is the simplest approach for connecting to standard MCP servers.

```typescript
"use client";
import { useCopilotChat } from '@copilotkit/react-core';
import { useEffect } from 'react';

function McpServerManager() {
  const { setMcpServers } = useCopilotChat();
  
  useEffect(() => {
    setMcpServers([
      {
        endpoint: 'https://your-mcp-server.com/sse',
      }
    ]);
  }, [setMcpServers]);
  
  return null;
}
```

**Quick Setup:**
```bash
npx copilotkit@latest init -m MCP
```

This approach connects directly from the frontend to MCP servers and is ideal for:
- Standard MCP servers without custom authentication
- Quick prototyping and demos
- Using managed MCP services (Composio, Zapier)

### Approach B: Custom Action Adapter (Recommended for Your Use Case)

For your existing MCP HTTP endpoint with HMAC authentication and signed URLs, use the **action adapter pattern** which gives you full control over authentication, tool discovery, and execution.

This approach creates a backend proxy that:
1. Fetches tools from your MCP server dynamically
2. Converts MCP tool schemas to CopilotKit actions
3. Handles HMAC authentication
4. Executes tool calls and streams results

## 3. Dynamic Action Registration with MCP Tools

### Step 1: Create MCP Client Helper

```typescript
// lib/mcp-client.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import crypto from 'crypto';

export interface MCPClientConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

export class AuthenticatedMCPClient {
  private client: Client | null = null;
  private config: MCPClientConfig;

  constructor(config: MCPClientConfig) {
    this.config = config;
  }

  private createHmacSignature(payload: string, timestamp: number): string {
    const message = `${timestamp}.${payload}`;
    return crypto
      .createHmac('sha256', this.config.apiSecret)
      .update(message)
      .digest('hex');
  }

  async connect() {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ action: 'connect' });
    const signature = this.createHmacSignature(payload, timestamp);

    const transport = new StreamableHTTPClientTransport(
      new URL(this.config.url),
      {
        requestInit: {
          headers: {
            'X-API-Key': this.config.apiKey,
            'X-Timestamp': timestamp.toString(),
            'X-Signature': signature,
            'Content-Type': 'application/json'
          }
        }
      }
    );

    this.client = new Client({
      name: 'copilotkit-mcp-client',
      version: '1.0.0'
    });

    await this.client.connect(transport);
    return this.client;
  }

  async listTools() {
    if (!this.client) throw new Error('Client not connected');
    return await this.client.listTools();
  }

  async callTool(name: string, args: any) {
    if (!this.client) throw new Error('Client not connected');
    return await this.client.callTool({ name, arguments: args });
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }
}
```

### Step 2: Convert MCP Tools to CopilotKit Actions

```typescript
// lib/mcp-adapter.ts
import { AuthenticatedMCPClient } from './mcp-client';

export interface CopilotKitAction {
  name: string;
  description: string;
  parameters: ActionParameter[];
  handler: (args: any) => Promise<any>;
}

export interface ActionParameter {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  attributes?: ActionParameter[];
  items?: any;
}

export class MCPActionAdapter {
  private mcpClient: AuthenticatedMCPClient;
  private actionCache: Map<string, CopilotKitAction[]> = new Map();
  private cacheTTL = 60000; // 1 minute

  constructor(mcpClient: AuthenticatedMCPClient) {
    this.mcpClient = mcpClient;
  }

  async getActions(): Promise<CopilotKitAction[]> {
    const cacheKey = 'actions';
    const cached = this.actionCache.get(cacheKey);
    
    if (cached) {
      return cached;
    }

    await this.mcpClient.connect();
    const toolsResponse = await this.mcpClient.listTools();
    
    const actions = toolsResponse.tools.map(tool => 
      this.convertToolToAction(tool)
    );

    this.actionCache.set(cacheKey, actions);
    setTimeout(() => this.actionCache.delete(cacheKey), this.cacheTTL);

    return actions;
  }

  private convertToolToAction(mcpTool: any): CopilotKitAction {
    return {
      name: mcpTool.name,
      description: mcpTool.description || `Execute ${mcpTool.name}`,
      parameters: this.convertSchema(mcpTool.inputSchema),
      handler: async (args) => {
        const result = await this.mcpClient.callTool(mcpTool.name, args);
        
        // Extract text content from MCP result
        if (result.content && result.content[0]) {
          return result.content[0].text || JSON.stringify(result.content[0]);
        }
        return JSON.stringify(result);
      }
    };
  }

  private convertSchema(schema: any): ActionParameter[] {
    if (!schema?.properties) return [];

    return Object.entries(schema.properties).map(([name, prop]: [string, any]) => {
      const param: ActionParameter = {
        name,
        type: this.mapType(prop.type, prop.items),
        description: prop.description,
        required: schema.required?.includes(name) || false
      };

      // Handle nested objects
      if (prop.type === 'object' && prop.properties) {
        param.attributes = this.convertSchema(prop);
      }

      // Handle arrays
      if (prop.type === 'array' && prop.items) {
        param.items = {
          type: prop.items.type,
          properties: prop.items.properties,
          enum: prop.items.enum
        };
      }

      return param;
    });
  }

  private mapType(jsonSchemaType: string, items?: any): string {
    const typeMap: Record<string, string> = {
      'string': 'string',
      'number': 'number',
      'integer': 'number',
      'boolean': 'boolean',
      'object': 'object'
    };

    if (jsonSchemaType === 'array') {
      if (items?.type === 'object') return 'object[]';
      if (items?.type === 'string') return 'string[]';
      if (items?.type === 'number') return 'number[]';
      return 'object[]';
    }

    return typeMap[jsonSchemaType] || 'string';
  }

  clearCache() {
    this.actionCache.clear();
  }
}
```

### Step 3: Create Server Route for Dynamic Actions

**app/api/copilotkit/route.ts:**
```typescript
import { 
  CopilotRuntime, 
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint 
} from "@copilotkit/runtime";
import OpenAI from "openai";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AuthenticatedMCPClient } from "@/lib/mcp-client";
import { MCPActionAdapter } from "@/lib/mcp-adapter";

// Important: Use Node.js runtime, not Edge
export const runtime = 'nodejs';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const POST = async (req: NextRequest) => {
  // 1. Authentication
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. Get user context from headers
  const workspaceId = req.headers.get("X-Workspace-ID") || session.user.workspaceId;

  // 3. Fetch signed MCP URL from your helper endpoint
  const signedUrlResponse = await fetch(
    `${process.env.NEXT_PUBLIC_APP_URL}/api/mcp/servers?workspaceId=${workspaceId}`,
    {
      headers: {
        'Authorization': `Bearer ${session.accessToken}`
      }
    }
  );

  if (!signedUrlResponse.ok) {
    return new Response("Failed to get MCP server URL", { status: 500 });
  }

  const { url, apiKey, apiSecret } = await signedUrlResponse.json();

  // 4. Create MCP client and adapter
  const mcpClient = new AuthenticatedMCPClient({
    url,
    apiKey,
    apiSecret
  });

  const mcpAdapter = new MCPActionAdapter(mcpClient);

  // 5. Configure runtime with async actions
  const serviceAdapter = new OpenAIAdapter({ openai });
  
  const runtime = new CopilotRuntime({
    actions: async () => {
      try {
        // Dynamically fetch and convert MCP tools to actions
        const actions = await mcpAdapter.getActions();
        return actions;
      } catch (error) {
        console.error('Failed to fetch MCP actions:', error);
        return []; // Return empty array on error
      } finally {
        await mcpClient.close();
      }
    }
  });

  // 6. Handle the request with streaming
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
```

## 4. Streaming Action Execution Results

### Server-Side Streaming with SSE

CopilotKit automatically handles streaming via Server-Sent Events (SSE). The runtime streams:
- LLM response tokens
- Tool call start/end events
- Intermediate state updates

**For long-running MCP tool calls, emit state regularly:**

```typescript
// In your action handler or MCP integration
import { copilotkit_emit_state } from "copilotkit";

async function longRunningToolExecution(args: any, config: RunnableConfig) {
  const state = {
    status: 'processing',
    progress: 0,
    logs: []
  };

  for (let i = 0; i < totalSteps; i++) {
    // Perform work
    await performStep(i);
    
    // Update and emit state every 5-10 seconds
    state.progress = (i / totalSteps) * 100;
    state.logs.push(`Completed step ${i + 1}`);
    
    await copilotkit_emit_state(config, state);
  }

  return { completed: true };
}
```

### Frontend: Display Streaming Results

**With useCoAgentStateRender:**
```typescript
"use client";
import { useCoAgentStateRender } from "@copilotkit/react-core";

export function AgentStateDisplay() {
  useCoAgentStateRender({
    name: "mcp_agent",
    render: (state) => {
      if (!state) return null;
      
      return (
        <div className="space-y-2">
          {state.state?.logs?.map((log: string, idx: number) => (
            <div key={idx} className="text-sm text-gray-600">
              {log}
            </div>
          ))}
          {state.state?.progress && (
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full"
                style={{ width: `${state.state.progress}%` }}
              />
            </div>
          )}
        </div>
      );
    }
  });

  return null;
}
```

**With custom action rendering:**
```typescript
import { useCopilotAction } from "@copilotkit/react-core";

useCopilotAction({
  name: "mcp_tool_execution",
  description: "Execute MCP tool with streaming results",
  parameters: [
    { name: "toolName", type: "string", required: true },
    { name: "arguments", type: "object", required: true }
  ],
  render: ({ args, status }) => {
    if (status === "executing") {
      return (
        <div className="animate-pulse">
          Executing {args.toolName}...
        </div>
      );
    }
    return null;
  }
});
```

## 5. Authentication Between Frontend and Backend

### Pattern 1: Next-Auth with Custom Headers

**Frontend (app/page.tsx):**
```typescript
"use client";
import { CopilotKit } from "@copilotkit/react-core";
import { useSession } from "next-auth/react";
import { useMemo } from "react";

export default function Page() {
  const { data: session } = useSession();
  
  const headers = useMemo(() => ({
    'Authorization': `Bearer ${session?.accessToken}`,
    'X-User-ID': session?.user?.id,
    'X-Workspace-ID': session?.user?.workspaceId,
  }), [session]);

  if (!session) {
    return <div>Please log in</div>;
  }

  return (
    <CopilotKit 
      runtimeUrl="/api/copilotkit"
      headers={headers}
    >
      <CopilotChat />
    </CopilotKit>
  );
}
```

**Backend validation (already shown in route.ts above):**
```typescript
const session = await getServerSession(authOptions);
if (!session?.user) {
  return new Response("Unauthorized", { status: 401 });
}
```

### Pattern 2: Cookie-Based Session

```typescript
// app/api/copilotkit/route.ts
import { cookies } from "next/headers";

export const POST = async (req: NextRequest) => {
  const cookieStore = cookies();
  const sessionCookie = cookieStore.get("session");
  
  if (!sessionCookie) {
    return new Response("Unauthorized", { status: 401 });
  }

  const session = await validateSession(sessionCookie.value);
  
  if (!session) {
    return new Response("Invalid session", { status: 401 });
  }

  // Continue with authenticated request...
};
```

### Pattern 3: Per-User/Workspace Tool Filtering

```typescript
// Restrict actions based on user permissions
const runtime = new CopilotRuntime({
  actions: async () => {
    const userPermissions = await getUserPermissions(session.user.id);
    const allActions = await mcpAdapter.getActions();
    
    // Filter actions based on user role and workspace
    return allActions.filter(action => {
      const hasPermission = userPermissions.includes(action.requiredPermission);
      const belongsToWorkspace = action.workspaceId === workspaceId;
      return hasPermission && belongsToWorkspace;
    });
  }
});
```

## 6. MCP Client Integration from Node.js

### HTTP Transport with HMAC Authentication

**Connecting to your /api/mcp/stream endpoint:**

```typescript
// lib/mcp-client-manager.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import crypto from 'crypto';

export async function createMCPClientWithSignedUrl(
  signedUrl: string,
  hmacToken: string
) {
  const timestamp = Math.floor(Date.now() / 1000);
  
  // Parse signed URL to extract any query parameters
  const url = new URL(signedUrl);
  
  const transport = new StreamableHTTPClientTransport(
    url,
    {
      requestInit: {
        headers: {
          'Authorization': `Bearer ${hmacToken}`,
          'X-Timestamp': timestamp.toString(),
          'Content-Type': 'application/json'
        }
      }
    }
  );

  const client = new Client({
    name: 'copilotkit-mcp-client',
    version: '1.0.0'
  });

  await client.connect(transport);
  return client;
}

// Usage in API route
export async function POST(req: NextRequest) {
  // Get signed URL from your helper endpoint
  const { url: signedUrl, token: hmacToken } = await fetchSignedMCPUrl(workspaceId);
  
  // Create client
  const mcpClient = await createMCPClientWithSignedUrl(signedUrl, hmacToken);
  
  // Use client
  const tools = await mcpClient.listTools();
  const result = await mcpClient.callTool({ name: 'tool-name', arguments: {} });
  
  // Clean up
  await mcpClient.close();
}
```

### ESM Configuration for Next.js

**package.json:**
```json
{
  "type": "module",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.19.1",
    "@copilotkit/react-core": "^1.10.3",
    "@copilotkit/react-ui": "^1.10.5",
    "@copilotkit/runtime": "^1.10.4"
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
    "skipLibCheck": true
  }
}
```

**Important:** Always use `.js` extensions in imports for ESM compatibility:
```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
```

## 7. Error Handling and Rate Limiting

### Error Surfacing in Chat UI

CopilotKit displays errors via toast notifications. Implement proper error handling in action handlers:

```typescript
useCopilotAction({
  name: "mcp_tool",
  parameters: [{ name: "toolName", type: "string" }],
  handler: async ({ toolName }) => {
    try {
      const result = await executeMCPTool(toolName);
      return result;
    } catch (error) {
      if (error instanceof Error) {
        // Error will be displayed in chat UI as toast
        throw new Error(`Tool execution failed: ${error.message}`);
      }
      throw error;
    }
  }
});
```

### Rate Limiting with Upstash

```typescript
// app/api/copilotkit/route.ts
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(20, "1 m"), // 20 requests per minute
});

export const POST = async (req: NextRequest) => {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Apply rate limit per user
  const { success, limit, remaining, reset } = await ratelimit.limit(userId);

  if (!success) {
    return new Response(
      JSON.stringify({ 
        error: "Rate limit exceeded",
        limit,
        remaining,
        reset 
      }),
      { 
        status: 429,
        headers: {
          'X-RateLimit-Limit': limit.toString(),
          'X-RateLimit-Remaining': remaining.toString(),
          'X-RateLimit-Reset': reset.toString(),
        }
      }
    );
  }

  // Continue with request...
};
```

### Timeout Handling

**Critical:** For MCP tool calls longer than 2 minutes, emit state regularly to prevent timeout:

```typescript
async function executeLongRunningMCPTool(
  mcpClient: Client,
  toolName: string,
  args: any,
  config: RunnableConfig
) {
  const state = { status: 'running', progress: 0 };
  
  // Create interval to emit state every 10 seconds
  const emitInterval = setInterval(async () => {
    await copilotkit_emit_state(config, state);
  }, 10000);

  try {
    const result = await mcpClient.callTool({ name: toolName, arguments: args });
    state.status = 'completed';
    await copilotkit_emit_state(config, state);
    return result;
  } finally {
    clearInterval(emitInterval);
  }
}
```

## 8. Agent Prompting and Context

### System Prompt Configuration

```typescript
<CopilotChat 
  instructions={`You are an intelligent assistant with access to workspace tools via MCP.

Available tools: ${toolsList}
Current workspace: ${workspaceName}

Guidelines:
- Always explain which tool you're using and why
- Confirm before executing destructive operations
- Provide clear status updates during long operations
- If a tool fails, suggest alternatives

Tool selection tips:
- Use search_documents for finding information
- Use create_task for action items
- Use send_email only when explicitly requested
`}
/>
```

### Context Injection with useCopilotReadable

**Provide workspace summary and tool usage context:**

```typescript
"use client";
import { useCopilotReadable } from "@copilotkit/react-core";

export function WorkspaceContextProvider({ 
  workspace, 
  recentActions,
  availableTools 
}) {
  // Main workspace context
  useCopilotReadable({
    description: "Current workspace information and available tools",
    value: {
      workspaceName: workspace.name,
      workspaceType: workspace.type,
      memberCount: workspace.members.length,
      availableTools: availableTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        successRate: tool.stats.successRate,
        avgExecutionTime: tool.stats.avgExecutionMs
      }))
    },
    categories: ["workspace", "tools"]
  });

  // Recent activity context
  useCopilotReadable({
    description: "Recent tool executions and outcomes to inform better tool selection",
    value: recentActions.slice(-10).map(action => ({
      toolName: action.toolName,
      timestamp: action.timestamp,
      success: action.success,
      duration: action.durationMs
    })),
    categories: ["history"]
  });

  // User preferences
  useCopilotReadable({
    description: "User preferences for tool behavior",
    value: {
      confirmDestructive: workspace.settings.confirmDestructive,
      verboseLogging: workspace.settings.verboseLogging,
      preferredLanguage: workspace.settings.language
    },
    categories: ["preferences"]
  });

  return null;
}
```

### Hierarchical Context for Complex Data

```typescript
function DocumentList({ documents }) {
  documents.forEach(doc => {
    const docContextId = useCopilotReadable({
      description: `Document: ${doc.title}`,
      value: {
        title: doc.title,
        type: doc.type,
        lastModified: doc.lastModified
      }
    });

    // Nested context for document metadata
    useCopilotReadable({
      description: "Document access permissions",
      value: doc.permissions,
      parentId: docContextId
    });

    useCopilotReadable({
      description: "Document tags and categories",
      value: doc.tags,
      parentId: docContextId
    });
  });

  return null;
}
```

## 9. Limitations and Gotchas

### Critical Considerations

**1. Node.js Runtime Required**
- Cannot use Edge runtime
- Set explicitly: `export const runtime = 'nodejs';`

**2. SSR Incompatibility for UI Components**
```typescript
// REQUIRED: Dynamic import for CopilotSidebar
import dynamic from "next/dynamic";

const CopilotSidebar = dynamic(
  () => import("@copilotkit/react-ui").then((mod) => mod.CopilotSidebar),
  { ssr: false }
);
```

**3. Timeout Handling**
- Default timeout: ~60-120 seconds without state updates
- **Must emit state every 5-10 seconds** for long operations
- No built-in configuration for timeout extension

**4. Context Window Limits**
- Tools are duplicated in prompt AND parameters (known issue #2219)
- Can exceed model context window with many MCP tools
- Consider filtering tools per request based on user query

**5. TypeScript Import Paths**
Use `.js` extensions for MCP SDK imports:
```typescript
// Correct
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// Incorrect (will fail)
import { Client } from '@modelcontextprotocol/sdk/client';
```

**6. Action Handler Async Behavior**
- Some self-hosted configurations don't properly await handler results (issue #2011)
- Always return values explicitly from handlers
- Test with both CopilotCloud and self-hosted

**7. Rate Limiting**
- No built-in rate limiting in framework
- Must implement custom rate limiting
- Consider per-user, per-workspace, and per-tool limits

**8. CommonJS Incompatibility**
- MCP SDK requires ESM
- Set `"type": "module"` in package.json
- Use `moduleResolution: "bundler"` in tsconfig.json

## Complete Working Example

### Project Structure
```
my-app/
├── app/
│   ├── api/
│   │   ├── copilotkit/
│   │   │   └── route.ts          # Main CopilotKit runtime
│   │   └── mcp/
│   │       └── servers/
│   │           └── route.ts      # Your existing MCP endpoint helper
│   ├── layout.tsx                 # Root layout with provider
│   └── page.tsx                   # Chat interface
├── lib/
│   ├── mcp-client.ts             # Authenticated MCP client
│   ├── mcp-adapter.ts            # Tool conversion adapter
│   └── auth.ts                   # Next-Auth configuration
└── package.json
```

### Complete Implementation

**1. package.json:**
```json
{
  "type": "module",
  "dependencies": {
    "@copilotkit/react-core": "^1.10.3",
    "@copilotkit/react-ui": "^1.10.5",
    "@copilotkit/runtime": "^1.10.4",
    "@modelcontextprotocol/sdk": "^1.19.1",
    "next": "^14.2.0",
    "next-auth": "^4.24.0",
    "openai": "^4.0.0",
    "@upstash/ratelimit": "^1.0.0",
    "@upstash/redis": "^1.0.0"
  }
}
```

**2. app/layout.tsx:**
```typescript
import { CopilotKit } from "@copilotkit/react-core";
import { SessionProvider } from "next-auth/react";
import "@copilotkit/react-ui/styles.css";
import "./globals.css";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <CopilotKit runtimeUrl="/api/copilotkit">
            {children}
          </CopilotKit>
        </SessionProvider>
      </body>
    </html>
  );
}
```

**3. app/page.tsx:**
```typescript
"use client";
import dynamic from "next/dynamic";
import { useCopilotReadable } from "@copilotkit/react-core";
import { useSession } from "next-auth/react";
import { useWorkspace } from "@/hooks/useWorkspace";

const CopilotSidebar = dynamic(
  () => import("@copilotkit/react-ui").then((m) => m.CopilotSidebar),
  { ssr: false }
);

export default function Page() {
  const { data: session } = useSession();
  const { workspace, tools } = useWorkspace();

  // Provide context to the agent
  useCopilotReadable({
    description: "Current workspace and available tools",
    value: {
      workspaceName: workspace?.name,
      toolCount: tools?.length,
      tools: tools?.map(t => ({ 
        name: t.name, 
        description: t.description 
      }))
    }
  });

  if (!session) {
    return <div>Please log in</div>;
  }

  return (
    <div className="flex h-screen">
      <main className="flex-1 p-8">
        <h1>Your Application</h1>
      </main>
      
      <CopilotSidebar
        instructions={`You are a helpful assistant with access to ${tools?.length || 0} workspace tools.
        
Guidelines:
- Explain your tool selection reasoning
- Provide progress updates for long operations
- Confirm destructive actions before executing

Current workspace: ${workspace?.name || 'default'}`}
        labels={{
          title: "Workspace Assistant",
          initial: "How can I help you with your workspace today?"
        }}
        defaultOpen={true}
      />
    </div>
  );
}
```

**4. app/api/copilotkit/route.ts (complete production example):**
```typescript
import { 
  CopilotRuntime, 
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint 
} from "@copilotkit/runtime";
import OpenAI from "openai";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { AuthenticatedMCPClient } from "@/lib/mcp-client";
import { MCPActionAdapter } from "@/lib/mcp-adapter";

export const runtime = 'nodejs';

const redis = Redis.fromEnv();
const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "1 m"),
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const POST = async (req: NextRequest) => {
  // 1. Authentication
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. Rate limiting
  const { success } = await ratelimit.limit(session.user.id);
  if (!success) {
    return new Response("Rate limit exceeded", { status: 429 });
  }

  // 3. Get workspace context
  const workspaceId = req.headers.get("X-Workspace-ID") || session.user.workspaceId;

  // Verify workspace access
  const hasAccess = await verifyWorkspaceAccess(session.user.id, workspaceId);
  if (!hasAccess) {
    return new Response("Forbidden", { status: 403 });
  }

  // 4. Fetch signed MCP server URL
  let mcpConfig;
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL}/api/mcp/servers?workspaceId=${workspaceId}`,
      {
        headers: {
          'Authorization': `Bearer ${session.accessToken}`
        }
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch MCP server configuration');
    }

    mcpConfig = await response.json();
  } catch (error) {
    console.error('MCP configuration error:', error);
    return new Response("Failed to configure MCP server", { status: 500 });
  }

  // 5. Setup MCP client and adapter
  const mcpClient = new AuthenticatedMCPClient({
    url: mcpConfig.url,
    apiKey: mcpConfig.apiKey,
    apiSecret: mcpConfig.apiSecret
  });

  const mcpAdapter = new MCPActionAdapter(mcpClient);

  // 6. Configure CopilotRuntime with dynamic actions
  const serviceAdapter = new OpenAIAdapter({ 
    openai,
    model: "gpt-4-turbo-preview"
  });

  const runtime = new CopilotRuntime({
    actions: async ({ properties }) => {
      try {
        // Dynamically fetch MCP tools and convert to actions
        const actions = await mcpAdapter.getActions();
        
        // Optional: Filter based on user permissions
        const userPermissions = await getUserPermissions(session.user.id);
        return actions.filter(action => 
          userPermissions.includes(`tool:${action.name}`)
        );
      } catch (error) {
        console.error('Failed to load MCP actions:', error);
        // Return empty array on error to prevent complete failure
        return [];
      } finally {
        // Clean up connection
        await mcpClient.close();
      }
    }
  });

  // 7. Handle request with streaming
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  try {
    return await handleRequest(req);
  } catch (error) {
    console.error('CopilotKit runtime error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

async function verifyWorkspaceAccess(userId: string, workspaceId: string): Promise<boolean> {
  // Implement your workspace access verification logic
  // Query database to check if user belongs to workspace
  return true; // Placeholder
}

async function getUserPermissions(userId: string): Promise<string[]> {
  // Implement your permission lookup logic
  // Return array of permission strings like ["tool:search_documents", "tool:create_task"]
  return ["tool:*"]; // Placeholder - grants all tools
}
```

**5. lib/mcp-client.ts and lib/mcp-adapter.ts:**
(Use the complete implementations shown in sections 3.1 and 3.2 above)

## Official Documentation Links

### CopilotKit
- **Main Documentation**: https://docs.copilotkit.ai/
- **MCP Integration Guide**: https://docs.copilotkit.ai/guides/model-context-protocol
- **Quickstart**: https://docs.copilotkit.ai/direct-to-llm/guides/quickstart
- **Component Reference**: https://docs.copilotkit.ai/reference/components/CopilotKit
- **Hooks Reference**: https://docs.copilotkit.ai/reference/hooks/
- **GitHub Repository**: https://github.com/CopilotKit/CopilotKit
- **NPM Packages**:
  - https://www.npmjs.com/package/@copilotkit/react-core
  - https://www.npmjs.com/package/@copilotkit/react-ui
  - https://www.npmjs.com/package/@copilotkit/runtime

### Model Context Protocol (MCP)
- **Official Website**: https://modelcontextprotocol.io
- **Specification**: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
- **TypeScript SDK**: https://github.com/modelcontextprotocol/typescript-sdk
- **NPM Package**: https://www.npmjs.com/package/@modelcontextprotocol/sdk
- **HTTP Transport Docs**: https://modelcontextprotocol.io/specification/draft/basic/transports#http-with-sse

### Next.js Integration Examples
- **CopilotKit MCP Demo**: https://github.com/CopilotKit/copilotkit-mcp-demo
- **Vercel AI SDK with MCP**: https://ai-sdk.dev/cookbook/node/mcp-tools
- **Next.js MCP Server Example**: https://github.com/run-llama/mcp-nextjs

## Key Takeaways

**Native MCP Support**: CopilotKit has first-class MCP integration via `setMcpServers`, but the custom action adapter pattern provides more control for your use case with HMAC authentication.

**Dynamic Action Registration**: Use the async actions configuration in CopilotRuntime to fetch and convert MCP tools at runtime. This refreshes on each request automatically.

**Streaming**: Handled automatically via SSE. For long MCP tool calls (>2 minutes), emit state every 5-10 seconds to prevent timeout.

**Authentication**: Pass user/workspace context via custom headers, validate in the API route, and use to fetch signed MCP URLs and filter available tools.

**MCP SDK**: Use `StreamableHTTPClientTransport` with custom headers for HMAC authentication. Requires ESM configuration.

**Error Handling**: Implement try-catch in action handlers, use rate limiting (Upstash), and display errors via CopilotKit's built-in toast notifications.

**Context Injection**: Use `useCopilotReadable` to provide workspace summary, tool list, and usage statistics to improve agent tool selection.

**Production Considerations**: Node.js runtime only, dynamic imports for UI components, proper error boundaries, rate limiting, and workspace-level tool filtering for security.