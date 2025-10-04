import { aiConfig } from './env'

// Validate toolkit names: alphanumeric, underscore, hyphen; max 50 chars
export function isValidToolkit(toolkit: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(toolkit) && toolkit.length > 0 && toolkit.length <= 50
}

// Generate a stable Composio user identifier per workspace isolation model
// Personal workspaces → user_<id>
// Team/org workspaces → org_<workspaceId>
export function generateComposioUserId(
  userId: string | number,
  workspaceId: string | number,
  isPersonal: boolean
): string {
  if (isPersonal) return `user_${userId}`
  return `org_${workspaceId}`
}

// Simple feature toggle helper for Composio
export function isComposioEnabled(): boolean {
  const cfg = aiConfig().composio
  return !!(cfg && cfg.enabled && cfg.apiKey)
}

// Minimal map of common API key field names for toolkits
export function getFallbackApiKeyFields(toolkit: string): string[] {
  const map: Record<string, string[]> = {
    firecrawl: ['api_key'],
    serpapi: ['api_key'],
    perplexityai: ['api_key'],
    openai: ['api_key'],
    anthropic: ['api_key'],
  }
  const key = toolkit.toLowerCase()
  return map[key] || ['api_key']
}
