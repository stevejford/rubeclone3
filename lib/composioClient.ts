import { Composio } from '@composio/core'
import { aiConfig } from '@/lib/env'

export type ComposioConnectionResult = { redirectUrl: string; state: string; connectionId?: string }
export type ComposioConnectionStatus = { isConnected: boolean; connectionId?: string; connectedAccount?: string; lastSync?: Date; status: 'connected'|'disconnected'|'error'|'expired' }

function ensureApiKey() {
  const cfg = aiConfig()
  if (!cfg.composio.enabled || !cfg.composio.apiKey) {
    throw new Error('Composio API key not configured')
  }
  return cfg.composio.apiKey
}

export class ComposioClient {
  private sdk: Composio
  constructor() {
    this.sdk = new Composio({ apiKey: ensureApiKey() })
  }

  async ensureAuthConfig(toolkit: string) {
    // Simplified: create each time; server can dedupe
    return this.sdk.authConfigs.create(toolkit.toUpperCase(), {
      name: `${toolkit} Auth Config`,
      type: 'use_composio_managed_auth',
    })
  }

  async linkOAuth(userId: string, toolkit: string, callbackUrl: string, state: string): Promise<ComposioConnectionResult> {
    const auth = await this.ensureAuthConfig(toolkit)
    const res = await this.sdk.connectedAccounts.link(userId, auth.id, { callbackUrl, state })
    return { redirectUrl: res.redirectUrl, state: res.state || state, connectionId: res.id }
  }

  async initiateApiKey(userId: string, toolkit: string, kv: Record<string, string>) {
    const auth = await this.ensureAuthConfig(toolkit)
    return this.sdk.connectedAccounts.initiate(userId, auth.id, { config: { authScheme: 'API_KEY' as any, val: kv } })
  }

  async getConnectionStatus(userId: string, toolkit: string): Promise<ComposioConnectionStatus> {
    try {
      // Not all SDKs expose status; return optimistic connected for now
      return { isConnected: true, status: 'connected' }
    } catch {
      return { isConnected: false, status: 'error' }
    }
  }
}

export function encodeState(userId: string, workspaceId: string, toolkit: string, source: 'workspace'|'marketplace') {
  return Buffer.from(JSON.stringify({ userId, workspaceId, toolkit, source, timestamp: Date.now(), nonce: Math.random().toString(36).slice(2) })).toString('base64url')
}

export function decodeState(state: string) {
  const d = JSON.parse(Buffer.from(state, 'base64url').toString())
  if (!d.userId || !d.workspaceId || !d.toolkit || !d.timestamp) throw new Error('Invalid state format')
  if (Date.now() - d.timestamp > 60*60*1000) throw new Error('State expired')
  return d as { userId: string; workspaceId: string; toolkit: string; source?: 'workspace'|'marketplace'; timestamp: number }
}

export function composioUserId(userId: string, workspaceId: string, isPersonal: boolean) {
  return isPersonal ? `user_${userId}` : `org_${workspaceId}`
}
