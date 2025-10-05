"use client"

import dynamic from 'next/dynamic'
import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useParams } from 'next/navigation'
import { CopilotKit, useCopilotAction } from '@copilotkit/react-core'
import '@copilotkit/react-ui/styles.css'

const CopilotSidebar = dynamic(() => import('@copilotkit/react-ui').then(m => m.CopilotSidebar), { ssr: false })

function ChatInner({ workspaceId }: { workspaceId: string }) {
  // Frontend tool: Connect a Composio toolkit via OAuth popup (legacy hook). Must be inside <CopilotKit/>.
  useCopilotAction({
    name: 'connectToolkit',
    description: 'Connect a Composio toolkit (e.g., google_maps) for this workspace by opening an OAuth window.',
    parameters: [
      { name: 'toolkit', type: 'string', description: 'Toolkit slug, e.g., google_maps', required: true },
    ],
    handler: async ({ toolkit }: { toolkit: string }) => {
      const res = await fetch('/api/composio/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Use 'marketplace' source so the OAuth callback follows the popup postMessage+close pattern
        body: JSON.stringify({ workspaceId, toolkit, source: 'marketplace' }),
      })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(`Connect failed: ${res.status} ${t}`)
      }
      const data = await res.json()
      const url = (data as any)?.redirectUrl as string | undefined
      if (url) {
        // IMPORTANT: do NOT use noopener/noreferrer here, we need window.opener for postMessage + auto-close
        window.open(url, '_blank', 'width=600,height=750,scrollbars=yes,resizable=yes')
        return `Opened OAuth for ${toolkit}. If you don’t see a window, allow popups and try again.`
      }
      return `Connect response did not include a redirectUrl for ${toolkit}.`
    },
  })

  // Frontend tool: Open Google Maps directions without requiring OAuth (legacy hook)
  useCopilotAction({
    name: 'mapsDirections',
    description: 'Open Google Maps directions in a new tab.',
    parameters: [
      { name: 'origin', type: 'string', description: 'Origin, e.g., Ballarat, VIC', required: true },
      { name: 'destination', type: 'string', description: 'Destination, e.g., Geelong, VIC', required: true },
      { name: 'travelmode', type: 'string', description: 'driving|walking|bicycling|transit', required: false },
    ],
    handler: async (args: { origin: string; destination: string; travelmode: string | undefined }) => {
      const { origin, destination } = args
      const mode = (args.travelmode || 'driving').toLowerCase()
      const params = new URLSearchParams({
        api: '1',
        origin,
        destination,
        travelmode: ['driving','walking','bicycling','transit'].includes(mode) ? mode : 'driving',
      })
      const url = `https://www.google.com/maps/dir/?${params.toString()}`
      window.open(url, '_blank', 'noopener,noreferrer')
      return `Opened directions: ${origin} -> ${destination} (${params.get('travelmode')}).`
    },
  })

  // Listen for marketplace-style popup completion messages
  useEffect(() => {
    const expectedOrigin = window.location.origin
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== expectedOrigin) return
      const data = event.data as any
      if (data?.type === 'composio-auth-success') {
        console.log('✅ Composio OAuth completed for', data.toolkit)
        // Optionally: refresh UI or notify user
      }
      if (data?.type === 'composio-auth-error') {
        console.warn('❌ Composio OAuth error:', data?.message || data?.error)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return null
}

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

  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      headers={headers}
      showDevConsole={true}
    >
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
        {/* Mount frontend tools inside CopilotKit provider */}
        <ChatInner workspaceId={workspaceId} />
      </div>
    </CopilotKit>
  )
}
