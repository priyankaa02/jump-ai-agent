// lib/webhooks/utils.ts
import { prisma } from '@/lib/prisma'

export interface WebhookStatus {
  service: string
  active: boolean
  expiresAt?: Date | null
  lastUpdate?: Date
}

/**
 * Check the status of all webhooks for a user
 */
export async function checkWebhookStatus(userId: string): Promise<WebhookStatus[]> {
  const subscriptions = await prisma.webhookSubscription.findMany({
    where: { userId }
  })

  const services = ['gmail', 'calendar', 'hubspot']
  const statuses: WebhookStatus[] = []

  for (const service of services) {
    const subscription = subscriptions.find(sub => sub.service === service)
    
    statuses.push({
      service,
      active: subscription ? !isExpired(subscription.expiresAt) : false,
      expiresAt: subscription?.expiresAt,
      lastUpdate: subscription?.updatedAt
    })
  }

  return statuses
}

/**
 * Check if a webhook subscription is expired
 */
export function isExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) return false
  return new Date() > expiresAt
}

/**
 * Renew expiring webhooks
 */
export async function renewExpiringWebhooks(userId: string): Promise<void> {
  const subscriptions = await prisma.webhookSubscription.findMany({
    where: { userId }
  })

  for (const subscription of subscriptions) {
    // Renew if expires within 24 hours
    if (subscription.expiresAt && 
        subscription.expiresAt.getTime() - Date.now() < 24 * 60 * 60 * 1000) {
      
      try {
        console.log(`Renewing ${subscription.service} webhook for user ${userId}`)
        
        await fetch(`${process.env.NEXTAUTH_URL}/api/webhooks/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            service: subscription.service
          })
        })
      } catch (error) {
        console.error(`Failed to renew ${subscription.service} webhook:`, error)
      }
    }
  }
}

/**
 * Clean up expired webhooks
 */
export async function cleanupExpiredWebhooks(): Promise<void> {
  const expiredSubscriptions = await prisma.webhookSubscription.findMany({
    where: {
      expiresAt: {
        lt: new Date()
      }
    }
  })

  for (const subscription of expiredSubscriptions) {
    console.log(`Cleaning up expired ${subscription.service} webhook for user ${subscription.userId}`)
    
    await prisma.webhookSubscription.delete({
      where: { id: subscription.id }
    })
  }
}

/**
 * Format webhook events for display
 */
export function formatWebhookEvent(service: string, data: any): string {
  switch (service) {
    case 'gmail':
      return `New email activity detected`
    
    case 'calendar':
      return `Calendar updated: ${data.changedEvents || 0} events changed`
    
    case 'hubspot':
      return `HubSpot ${data.eventType || 'update'} for ${data.objectId || 'object'}`
    
    default:
      return `Update from ${service}`
  }
}

/**
 * Batch process webhook events
 */
export async function batchProcessWebhookEvents(
  events: Array<{ service: string; userId: string; data: any }>
): Promise<void> {
  const eventsByUser = events.reduce((acc, event) => {
    if (!acc[event.userId]) {
      acc[event.userId] = []
    }
    acc[event.userId].push(event)
    return acc
  }, {} as Record<string, typeof events>)

  for (const [userId, userEvents] of Object.entries(eventsByUser)) {
    try {
      const summary = userEvents
        .map(e => formatWebhookEvent(e.service, e.data))
        .join('\n')

      await prisma.task.create({
        data: {
          userId,
          description: `Process webhook updates:\n${summary}`,
          status: 'pending',
          context: {
            events: userEvents
          }
        }
      })
    } catch (error) {
      console.error(`Error processing events for user ${userId}:`, error)
    }
  }
}

/**
 * Verify webhook health
 */
export async function verifyWebhookHealth(service: string): Promise<boolean> {
  try {
    const response = await fetch(`${process.env.NEXTAUTH_URL}/api/webhooks/${service}`, {
      method: 'GET'
    })
    
    return response.ok
  } catch (error) {
    console.error(`Health check failed for ${service} webhook:`, error)
    return false
  }
}