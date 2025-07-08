// app/api/cron/webhooks/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cleanupExpiredWebhooks, renewExpiringWebhooks, verifyWebhookHealth } from '@/lib/webhooks/utils'

export async function GET(req: NextRequest) {
  // Verify this is being called by your cron service
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    console.log('Starting webhook maintenance job...')

    // 1. Clean up expired webhooks
    await cleanupExpiredWebhooks()

    // 2. Get all users with active webhooks
    const users = await prisma.user.findMany({
      where: {
        WebhookSubscription: {
          some: {}
        }
      },
      select: {
        id: true,
        email: true
      }
    })

    // 3. Renew expiring webhooks for each user
    const renewalPromises = users.map(user => 
      renewExpiringWebhooks(user.id).catch(error => {
        console.error(`Failed to renew webhooks for user ${user.email}:`, error)
      })
    )

    await Promise.all(renewalPromises)

    // 4. Verify webhook endpoints are healthy
    const services = ['gmail', 'calendar', 'hubspot']
    const healthChecks = await Promise.all(
      services.map(async service => ({
        service,
        healthy: await verifyWebhookHealth(service)
      }))
    )

    // 5. Log results
    const unhealthyServices = healthChecks.filter(check => !check.healthy)
    if (unhealthyServices.length > 0) {
      console.error('Unhealthy webhook services:', unhealthyServices)
    }

    return NextResponse.json({
      success: true,
      usersProcessed: users.length,
      healthChecks
    })

  } catch (error) {
    console.error('Webhook maintenance job error:', error)
    return NextResponse.json({ 
      error: 'Maintenance job failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

// Optional: POST endpoint to manually trigger maintenance for a specific user
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { userId } = await req.json()

    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 })
    }

    // Renew webhooks for specific user
    await renewExpiringWebhooks(userId)

    // Get current webhook status
    const subscriptions = await prisma.webhookSubscription.findMany({
      where: { userId }
    })

    return NextResponse.json({
      success: true,
      subscriptions
    })

  } catch (error) {
    console.error('Manual webhook renewal error:', error)
    return NextResponse.json({ 
      error: 'Renewal failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}