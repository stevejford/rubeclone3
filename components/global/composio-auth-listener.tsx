"use client"

import { useEffect } from 'react'
import { toast } from 'sonner'

export function ComposioAuthListener() {
  useEffect(() => {
    const expectedOrigin = window.location.origin
    const handler = (event: MessageEvent) => {
      if (event.origin !== expectedOrigin) return
      const data = event.data as any
      if (data?.type === 'composio-auth-success') {
        toast.success(`Connected ${data.toolkit || 'app'} successfully`)
        // Soft refresh: let pages revalidate their SWR/fetchers naturally; optionally emit a custom event
        window.dispatchEvent(new CustomEvent('composio-auth-updated', { detail: data }))
      } else if (data?.type === 'composio-auth-error') {
        toast.error(data.message || data.error || 'Authentication failed')
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  return null
}