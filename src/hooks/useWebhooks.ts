// import { useState, useEffect, useCallback } from 'react'
// import { toast } from 'react-hot-toast'

// export interface WebhookSubscription {
//   id: string
//   service: string
//   webhookUrl: string
//   expiresAt?: Date | null
//   metadata?: any
//   createdAt: Date
//   updatedAt: Date
// }

// export interface WebhookStatus {
//   service: string
//   active: boolean
//   expiresAt?: Date | null
//   lastUpdate?: Date
// }

// export function useWebhooks() {
//   const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([])
//   const [statuses, setStatuses] = useState<WebhookStatus[]>([])
//   const [loading, setLoading] = useState(false)
//   const [registering, setRegistering] = useState<string | null>(null)

//   // Fetch webhook subscriptions
//   const fetchSubscriptions = useCallback(async () => {
//     setLoading(true)
//     try {
//       const response = await fetch('/api/webhooks/register')
//       if (!response.ok) throw new Error('Failed to fetch subscriptions')
      
//       const data = await response.json()
//       setSubscriptions(data.subscriptions || [])
      
//       // Calculate statuses
//       const services = ['gmail', 'calendar', 'hubspot']
//       const statusList = services.map(service => {
//         const sub = data.subscriptions?.find((s: WebhookSubscription) => s.service === service)
//         return {
//           service,
//           active: sub ? !isExpired(sub.expiresAt) : false,
//           expiresAt: sub?.expiresAt,
//           lastUpdate: sub?.updatedAt
//         }
//       })
//       setStatuses(statusList)
//     } catch (error) {
//       console.error('Error fetching webhook subscriptions:', error)
//       toast.error('Failed to load webhook status')
//     } finally {
//       setLoading(false)
//     }
//   }, [])

//   // Register a webhook
//   const registerWebhook = useCallback(async (service: string) => {
//     setRegistering(service)
//     try {
//       const response = await fetch('/api/webhooks/register', {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json'
//         },
//         body: JSON.stringify({ service })
//       })

//       if (!response.ok) {
//         const error = await response.json()
//         throw new Error(error.error || 'Registration failed')
//       }

//       toast.success(`${service} webhook registered successfully`)
//       await fetchSubscriptions() // Refresh the list
//     } catch (error) {
//       console.error(`Error registering ${service} webhook:`, error)
//       toast.error(`Failed to register ${service} webhook`)
//     } finally {
//       setRegistering(null)
//     }
//   }, [fetchSubscriptions])

//   // Unregister a webhook
//   const unregisterWebhook = useCallback(async (service: string) => {
//     try {
//       const response = await fetch('/api/webhooks/register', {
//         method: 'DELETE',
//         headers: {
//           'Content-Type': 'application/json'
//         },
//         body: JSON.stringify({ service })
//       })

//       if (!response.ok) {
//         const error = await response.json()
//         throw new Error(error.error || 'Unregistration failed')
//       }

//       toast.success(`${service} webhook unregistered`)
//       await fetchSubscriptions() // Refresh the list
//     } catch (error) {
//       console.error(`Error unregistering ${service} webhook:`, error)
//       toast.error(`Failed to unregister ${service} webhook`)
//     }
//   }, [fetchSubscriptions])

//   // Toggle webhook registration
//   const toggleWebhook = useCallback(async (service: string) => {
//     const status = statuses.find(s => s.service === service)
//     if (status?.active) {
//       await unregisterWebhook(service)
//     } else {
//       await registerWebhook(service)
//     }
//   }, [statuses, registerWebhook, unregisterWebhook])

//   // Check if a date is expired
//   function isExpired(expiresAt: Date | null | undefined): boolean {
//     if (!expiresAt) return false
//     return new Date() > new Date(expiresAt)
//   }

//   // Check if a webhook is expiring soon (within 24 hours)
//   function isExpiringSoon(expiresAt: Date | null | undefined): boolean {
//     if (!expiresAt) return false
//     const expiry = new Date(expiresAt)
//     const now = new Date()
//     const hoursUntilExpiry = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60)
//     return hoursUntilExpiry > 0 && hoursUntilExpiry < 24
//   }

//   // Initial fetch
//   useEffect(() => {
//     fetchSubscriptions()
//   }, [fetchSubscriptions])

//   // Refresh periodically to check for expiring webhooks
//   useEffect(() => {
//     const interval = setInterval(() => {
//       fetchSubscriptions()
//     }, 5 * 60 * 1000) // Check every 5 minutes

//     return () => clearInterval(interval)
//   }, [fetchSubscriptions])

//   return {
//     subscriptions,
//     statuses,
//     loading,
//     registering,
//     registerWebhook,
//     unregisterWebhook,
//     toggleWebhook,
//     refresh: fetchSubscriptions,
//     isExpired,
//     isExpiringSoon
//   }
// }

// // Hook for listening to webhook updates via WebSocket or SSE
// export function useWebhookUpdates(onUpdate?: (data: any) => void) {
//   useEffect(() => {
//     // This is a placeholder for WebSocket/SSE implementation
//     // You would implement your real-time connection here
    
//     // Example with Server-Sent Events:
//     /*
//     const eventSource = new EventSource('/api/webhooks/stream')
    
//     eventSource.onmessage = (event) => {
//       const data = JSON.parse(event.data)
//       onUpdate?.(data)
//     }
    
//     eventSource.onerror = (error) => {
//       console.error('SSE error:', error)
//     }
    
//     return () => {
//       eventSource.close()
//     }
//     */

//     // Example with WebSocket:
//     /*
//     const ws = new WebSocket(process.env.NEXT_PUBLIC_WS_URL!)
    
//     ws.onmessage = (event) => {
//       const data = JSON.parse(event.data)
//       if (data.type === 'webhook:update') {
//         onUpdate?.(data)
//       }
//     }
    
//     return () => {
//       ws.close()
//     }
//     */
//   }, [onUpdate])
// }

// hooks/useWebhooks.ts
'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'react-hot-toast'

export interface WebhookSubscription {
  id: string
  service: string
  webhookUrl: string
  expiresAt?: Date | null
  metadata?: any
  createdAt: Date
  updatedAt: Date
}

export interface WebhookStatus {
  service: string
  active: boolean
  expiresAt?: Date | null
  lastUpdate?: Date
}

export function useWebhooks() {
  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([])
  const [statuses, setStatuses] = useState<WebhookStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [registering, setRegistering] = useState<string | null>(null)

  // Fetch webhook subscriptions
  const fetchSubscriptions = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/webhooks/register')
      if (!response.ok) throw new Error('Failed to fetch subscriptions')
      
      const data = await response.json()
      setSubscriptions(data.subscriptions || [])
      
      // Calculate statuses
      const services = ['gmail', 'calendar', 'hubspot']
      const statusList = services.map(service => {
        const sub = data.subscriptions?.find((s: WebhookSubscription) => s.service === service)
        return {
          service,
          active: sub ? !isExpired(sub.expiresAt) : false,
          expiresAt: sub?.expiresAt,
          lastUpdate: sub?.updatedAt
        }
      })
      setStatuses(statusList)
    } catch (error) {
      console.error('Error fetching webhook subscriptions:', error)
      toast.error('Failed to load webhook status')
    } finally {
      setLoading(false)
    }
  }, [])

  // Register a webhook
  const registerWebhook = useCallback(async (service: string) => {
    setRegistering(service)
    try {
      const response = await fetch('/api/webhooks/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ service })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Registration failed')
      }

      toast.success(`${service} webhook registered successfully`)
      await fetchSubscriptions() // Refresh the list
    } catch (error) {
      console.error(`Error registering ${service} webhook:`, error)
      toast.error(`Failed to register ${service} webhook`)
    } finally {
      setRegistering(null)
    }
  }, [fetchSubscriptions])

  // Unregister a webhook
  const unregisterWebhook = useCallback(async (service: string) => {
    try {
      const response = await fetch('/api/webhooks/register', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ service })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Unregistration failed')
      }

      toast.success(`${service} webhook unregistered`)
      await fetchSubscriptions() // Refresh the list
    } catch (error) {
      console.error(`Error unregistering ${service} webhook:`, error)
      toast.error(`Failed to unregister ${service} webhook`)
    }
  }, [fetchSubscriptions])

  // Toggle webhook registration
  const toggleWebhook = useCallback(async (service: string) => {
    const status = statuses.find(s => s.service === service)
    if (status?.active) {
      await unregisterWebhook(service)
    } else {
      await registerWebhook(service)
    }
  }, [statuses, registerWebhook, unregisterWebhook])

  // Check if a date is expired
  function isExpired(expiresAt: Date | null | undefined): boolean {
    if (!expiresAt) return false
    return new Date() > new Date(expiresAt)
  }

  // Check if a webhook is expiring soon (within 24 hours)
  function isExpiringSoon(expiresAt: Date | null | undefined): boolean {
    if (!expiresAt) return false
    const expiry = new Date(expiresAt)
    const now = new Date()
    const hoursUntilExpiry = (expiry.getTime() - now.getTime()) / (1000 * 60 * 60)
    return hoursUntilExpiry > 0 && hoursUntilExpiry < 24
  }

  // Initial fetch
  useEffect(() => {
    fetchSubscriptions()
  }, [fetchSubscriptions])

  // Refresh periodically to check for expiring webhooks
  useEffect(() => {
    const interval = setInterval(() => {
      fetchSubscriptions()
    }, 5 * 60 * 1000) // Check every 5 minutes

    return () => clearInterval(interval)
  }, [fetchSubscriptions])

  return {
    subscriptions,
    statuses,
    loading,
    registering,
    registerWebhook,
    unregisterWebhook,
    toggleWebhook,
    refresh: fetchSubscriptions,
    isExpired,
    isExpiringSoon
  }
}

// Hook for listening to webhook updates via WebSocket or SSE
export function useWebhookUpdates(onUpdate?: (data: any) => void) {
  useEffect(() => {
    // This is a placeholder for WebSocket/SSE implementation
    // You would implement your real-time connection here
    
    // Example with Server-Sent Events:
    /*
    const eventSource = new EventSource('/api/webhooks/stream')
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data)
      onUpdate?.(data)
    }
    
    eventSource.onerror = (error) => {
      console.error('SSE error:', error)
    }
    
    return () => {
      eventSource.close()
    }
    */

    // Example with WebSocket:
    /*
    const ws = new WebSocket(process.env.NEXT_PUBLIC_WS_URL!)
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.type === 'webhook:update') {
        onUpdate?.(data)
      }
    }
    
    return () => {
      ws.close()
    }
    */
  }, [onUpdate])
}