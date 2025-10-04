import { randomUUID } from 'crypto'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export function newRequestId() {
  return randomUUID()
}

export function log(level: LogLevel, msg: string, meta: Record<string, any> = {}) {
  const entry = {
    level,
    msg,
    time: new Date().toISOString(),
    ...meta,
  }
  // eslint-disable-next-line no-console
  const line = JSON.stringify(entry)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  debug: (msg: string, meta?: Record<string, any>) => log('debug', msg, meta),
  info: (msg: string, meta?: Record<string, any>) => log('info', msg, meta),
  warn: (msg: string, meta?: Record<string, any>) => log('warn', msg, meta),
  error: (msg: string, meta?: Record<string, any>) => log('error', msg, meta),
}
