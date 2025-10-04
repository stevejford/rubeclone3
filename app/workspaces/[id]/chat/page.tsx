"use client"

import dynamic from 'next/dynamic'
import { useSession } from 'next-auth/react'
import { useParams } from 'next/navigation'
import { CopilotKit } from '@copilotkit/react-core'
import '@copilotkit/react-ui/styles.css'

const CopilotSidebar = dynamic(() => import('@copilotkit/react-ui').then(m => m.CopilotSidebar), { ssr: false })

export default function WorkspaceChatPage() {
  const { data: session } = useSession()
  const params = useParams()
  const workspaceId = params?.id as string

  if (!session) {
    return <div className="p-6">Please log in to access this workspace chat.</div>
  }

  const headers = {
    'X-Workspace-ID': workspaceId,
    'X-User-ID': session.user.id,
  } as Record<string, string>

  const publicKey = process.env.NEXT_PUBLIC_COPILOTKIT_PUBLIC_API_KEY

  return (
    <CopilotKit runtimeUrl="/api/copilotkit" headers={headers} publicApiKey={publicKey}>
      <div className="flex h-[calc(100vh-64px)]">
        <main className="flex-1 p-6">
          <h1 className="text-2xl font-semibold">Workspace Chat</h1>
          <p className="text-sm text-gray-600">Workspace: {workspaceId}</p>
        </main>
        <CopilotSidebar
          instructions={`You are a helpful assistant for workspace ${workspaceId}. Use only the tools that are enabled for this workspace via MCP. Explain tool choices, confirm destructive actions, and stream progress for long operations.`}
          labels={{ title: 'Workspace Assistant', initial: 'How can I help you?' }}
          defaultOpen
        />
      </div>
    </CopilotKit>
  )
}
