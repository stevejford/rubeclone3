import { z } from 'zod'

// Server-only flags. Do not import into client components directly.
const serverSchema = z.object({
  ENABLE_MCP_INSTALL: z.string().optional(),
  MCP_TOKEN_SECRET: z.string().optional(),
})

function getServerEnv() {
  try {
    return serverSchema.parse(process.env)
  } catch (e) {
    return { ENABLE_MCP_INSTALL: undefined, MCP_TOKEN_SECRET: undefined }
  }
}

export const ENABLE_MCP_INSTALL = (() => {
  const env = getServerEnv()
  return env.ENABLE_MCP_INSTALL === '1' || env.ENABLE_MCP_INSTALL === 'true'
})()

// Client-visible flag (mirrored via NEXT_PUBLIC_*)
export const NEXT_PUBLIC_ENABLE_MCP_INSTALL =
  typeof process !== 'undefined' && typeof (globalThis as any).window === 'undefined'
    ? false
    : (typeof process !== 'undefined' && (process as any).env?.NEXT_PUBLIC_ENABLE_MCP_INSTALL === '1') ||
      (typeof process !== 'undefined' && (process as any).env?.NEXT_PUBLIC_ENABLE_MCP_INSTALL === 'true') || false

export function requireMcpEnabled() {
  if (!ENABLE_MCP_INSTALL) {
    const err = new Error('MCP is disabled by configuration')
    ;(err as any).status = 503
    throw err
  }
}
