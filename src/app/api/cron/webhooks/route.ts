import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cleanupExpiredWebhooks, renewExpiringWebhooks, verifyWebhookHealth } from '@/lib/webhooks/utils'

interface UserWithWebhooks {
  id: string
  email: string
}

interface HealthCheck {
  service: string
  healthy: boolean
}

interface PostRequestBody {
  userId: string
}

interface MaintenanceResponse {
  success: boolean
  usersProcessed: number
  healthChecks: HealthCheck[]
}

interface ManualRenewalResponse {
  success: boolean
  subscriptions: any[]
}

export async function GET(req: NextRequest): Promise<NextResponse<MaintenanceResponse | { error: string; details?: string }>> {
  // Verify this is being called by your cron service
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    console.log('Starting webhook maintenance job...')

    // 1. Clean up expired webhooks
    await cleanupExpiredWebhooks()

    // 2. Get all users with active webhooks - with explicit typing
    const users: UserWithWebhooks[] = await prisma.user.findMany({
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

    // 3. Renew expiring webhooks for each user - now properly typed
    const renewalPromises: Promise<void>[] = users.map((user: UserWithWebhooks) => 
      renewExpiringWebhooks(user.id).catch((error: unknown) => {
        console.error(`Failed to renew webhooks for user ${user.email}:`, error)
      })
    )

    await Promise.all(renewalPromises)

    // 4. Verify webhook endpoints are healthy
    const services: string[] = ['gmail', 'calendar', 'hubspot']
    const healthChecks: HealthCheck[] = await Promise.all(
      services.map(async (service: string): Promise<HealthCheck> => ({
        service,
        healthy: await verifyWebhookHealth(service)
      }))
    )

    // 5. Log results
    const unhealthyServices: HealthCheck[] = healthChecks.filter((check: HealthCheck) => !check.healthy)
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
export async function POST(req: NextRequest): Promise<NextResponse<ManualRenewalResponse | { error: string; details?: string }>> {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body: PostRequestBody = await req.json()
    const { userId } = body

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