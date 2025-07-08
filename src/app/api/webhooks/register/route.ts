import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getGoogleClient } from '@/lib/google'
import { google } from 'googleapis'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const userId = session.user.id!
    const { service } = await req.json()

    switch (service) {
      case 'gmail':
        await registerGmailWebhook(userId)
        break
      case 'calendar':
        await registerCalendarWebhook(userId)
        break
      case 'hubspot':
        await registerHubSpotWebhook(userId)
        break
      default:
        return NextResponse.json({ error: 'Unknown service' }, { status: 400 })
    }

    return NextResponse.json({ success: true, service })
  } catch (error) {
    console.error('Webhook registration error:', error)
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 })
  }
}

// Gmail Push Notifications Setup
async function registerGmailWebhook(userId: string) {
  const auth = await getGoogleClient(userId)
  const gmail = google.gmail({ version: 'v1', auth })

  // Create or verify Pub/Sub topic
  const topicName = `projects/${process.env.GOOGLE_CLOUD_PROJECT_ID}/topics/gmail-push`
  
  try {
    // Watch the user's inbox
    const watchResponse = await gmail.users.watch({
      userId: 'me',
      requestBody: {
        topicName,
        labelIds: ['INBOX', 'SENT'],
        labelFilterAction: 'include'
      }
    })

    console.log('watchResponse', watchResponse)
    // Store watch information
    await prisma.webhookSubscription.upsert({
      where: {
        userId_service: {
          userId,
          service: 'gmail'
        }
      },
      update: {
        webhookUrl: `${process.env.NEXTAUTH_URL}/api/webhooks/gmail`,
        expiresAt: new Date(Number(watchResponse.data.expiration)),
        metadata: {
          historyId: watchResponse.data.historyId
        }
      },
      create: {
        userId,
        service: 'gmail',
        webhookUrl: `${process.env.NEXTAUTH_URL}/api/webhooks/gmail`,
        expiresAt: new Date(Number(watchResponse.data.expiration)),
        metadata: {
          historyId: watchResponse.data.historyId
        }
      }
    })

    console.log('Gmail webhook registered:', watchResponse.data)
  } catch (error) {
    console.error('Gmail webhook registration error:', error)
    throw error
  }
}

// Google Calendar Push Notifications Setup
async function registerCalendarWebhook(userId: string) {
  const auth = await getGoogleClient(userId)
  const calendar = google.calendar({ version: 'v3', auth })

  try {
    // Generate a unique channel ID
    const channelId = `calendar-${userId}-${Date.now()}`
    const webhookUrl = `${process.env.NEXTAUTH_URL}/api/webhooks/calendar`

    // List all calendars
    const calendarList = await calendar.calendarList.list()
    const primaryCalendar = calendarList.data.items?.find(cal => cal.primary) || calendarList.data.items?.[0]

    if (!primaryCalendar) {
      throw new Error('No calendar found')
    }

    // Set up watch on the primary calendar
    const watchResponse = await calendar.events.watch({
      calendarId: primaryCalendar.id!,
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: webhookUrl,
        token: generateSecureToken(),
        expiration: (Date.now() + 7 * 24 * 60 * 60 * 1000).toString() // 7 days from now
      }
    })

    // Store watch information
    await prisma.webhookSubscription.upsert({
      where: {
        userId_service: {
          userId,
          service: 'calendar'
        }
      },
      update: {
        webhookUrl,
        expiresAt: new Date(parseInt(watchResponse.data.expiration!)),
        metadata: {
          channelId: watchResponse.data.id,
          resourceId: watchResponse.data.resourceId,
          calendarId: primaryCalendar.id,
          token: watchResponse.data.token
        }
      },
      create: {
        userId,
        service: 'calendar',
        webhookUrl,
        expiresAt: new Date(parseInt(watchResponse.data.expiration!)),
        metadata: {
          channelId: watchResponse.data.id,
          resourceId: watchResponse.data.resourceId,
          calendarId: primaryCalendar.id,
          token: watchResponse.data.token
        }
      }
    })

    console.log('Calendar webhook registered:', watchResponse.data)
  } catch (error) {
    console.error('Calendar webhook registration error:', error)
    throw error
  }
}

// HubSpot Webhook Setup
// async function registerHubSpotWebhook(userId: string) {
//     // Get HubSpot credentials for the user
//     const user = await prisma.user.findUnique({
//       where: { id: userId },
//       select: {
//         hubspotAccessToken: true,
//         hubspotPortalId: true
//       }
//     })
  
//     if (!user?.hubspotAccessToken) {
//       throw new Error('HubSpot not connected')
//     }
  
//     const webhookUrl = `${process.env.NEXTAUTH_URL}/api/webhooks/hubspot`
//     const appId = process.env.HUBSPOT_APP_ID
  
//     try {
//       // Get existing webhook subscriptions
//       const response = await fetch(`https://api.hubapi.com/webhooks/v3/${appId}/subscriptions`, {
//         method: 'GET',
//         headers: {
//           'Authorization': `Bearer ${user.hubspotAccessToken}`,
//           'Content-Type': 'application/json'
//         }
//       })
  
//       console.log('HubSpot subscriptions response:', response)
  
//       if (!response.ok) {
//         throw new Error(`HubSpot API error: ${response.statusText}`)
//       }
  
//       const subscriptions = await response.json()
//       console.log('Existing subscriptions:', subscriptions)
  
//       // Check if a contact.creation subscription already exists
//       const existingSubscription = subscriptions.results?.find((sub: any) => 
//         sub.eventType === 'contact.creation' && sub.active
//       )
  
//       if (existingSubscription) {
//         // Store the existing webhook information
//         await prisma.webhookSubscription.upsert({
//           where: {
//             userId_service: {
//               userId,
//               service: 'hubspot'
//             }
//           },
//           update: {
//             webhookUrl,
//             expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
//             metadata: {
//               subscriptionId: existingSubscription.id,
//               eventType: existingSubscription.eventType,
//               portalId: user.hubspotPortalId,
//               targetUrl: existingSubscription.targetUrl,
//               createdAt: existingSubscription.createdAt
//             }
//           },
//           create: {
//             userId,
//             service: 'hubspot',
//             webhookUrl,
//             expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
//             metadata: {
//               subscriptionId: existingSubscription.id,
//               eventType: existingSubscription.eventType,
//               portalId: user.hubspotPortalId,
//               targetUrl: existingSubscription.targetUrl,
//               createdAt: existingSubscription.createdAt
//             }
//           }
//         })
  
//         console.log('HubSpot webhook found and registered:', existingSubscription)
//         return { 
//           success: true, 
//           message: 'Existing webhook subscription found and registered',
//           subscription: existingSubscription 
//         }
//       } else {
//         // No existing subscription found
//         console.log('No existing contact.creation webhook found')
//         throw new Error('No existing contact.creation webhook subscription found. Please create one manually in your HubSpot developer portal.')
//       }
  
//     } catch (error) {
//       console.error('HubSpot webhook registration error:', error)
//       throw error
//     }
// }

async function registerHubSpotWebhook(userId: string) {
    // Get HubSpot credentials for the user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        hubspotAccessToken: true,
        hubspotPortalId: true
      }
    })
  
    if (!user?.hubspotAccessToken) {
      throw new Error('HubSpot not connected')
    }
  
    const webhookUrl = `${process.env.NEXTAUTH_URL}/api/webhooks/hubspot`
  
    try {
      // Since we can't programmatically create or check webhooks via API for private apps,
      // we'll store the webhook configuration and provide instructions to the user
      
      // Store webhook configuration (assuming it will be set up manually)
      const webhookSubscription = await prisma.webhookSubscription.upsert({
        where: {
          userId_service: {
            userId,
            service: 'hubspot'
          }
        },
        update: {
          webhookUrl,
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
          metadata: {
            portalId: user.hubspotPortalId,
            status: 'manual_setup_required',
            instructionsProvided: true,
            expectedEventTypes: ['contact.creation', 'contact.propertyChange']
          }
        },
        create: {
          userId,
          service: 'hubspot',
          webhookUrl,
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
          metadata: {
            portalId: user.hubspotPortalId,
            status: 'manual_setup_required',
            instructionsProvided: true,
            expectedEventTypes: ['contact.creation', 'contact.propertyChange']
          }
        }
      })
  
      console.log('HubSpot webhook configuration saved:', webhookSubscription)
      
      return { 
        success: true, 
        requiresManualSetup: true,
        message: 'HubSpot webhook configuration saved. Manual setup required in HubSpot Developer Portal.',
        instructions: {
          webhookUrl,
          appId: process.env.HUBSPOT_APP_ID,
          steps: [
            'Go to HubSpot Developer Portal',
            'Navigate to your Private App settings',
            'Go to Webhooks section',
            'Add webhook subscription for contact.creation events',
            `Set target URL to: ${webhookUrl}`,
            'Save the configuration'
          ]
        }
      }
  
    } catch (error) {
      console.error('HubSpot webhook configuration error:', error)
      throw error
    }
  }

// Helper function to generate secure tokens
function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

// GET endpoint to check webhook status
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const userId = session.user.id!
    const { searchParams } = new URL(req.url)
    const service = searchParams.get('service')

    if (service) {
      // Get specific webhook subscription
      const subscription = await prisma.webhookSubscription.findUnique({
        where: {
          userId_service: {
            userId,
            service
          }
        }
      })

      return NextResponse.json({ subscription })
    } else {
      // Get all webhook subscriptions for user
      const subscriptions = await prisma.webhookSubscription.findMany({
        where: { userId }
      })

      return NextResponse.json({ subscriptions })
    }
  } catch (error) {
    console.error('Error fetching webhook status:', error)
    return NextResponse.json({ error: 'Failed to fetch status' }, { status: 500 })
  }
}

// DELETE endpoint to unregister webhooks
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const userId = session.user.id!
    const { service } = await req.json()

    // Get the subscription to unregister
    const subscription = await prisma.webhookSubscription.findUnique({
      where: {
        userId_service: {
          userId,
          service
        }
      }
    })

    if (!subscription) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }

    switch (service) {
      case 'calendar':
        await unregisterCalendarWebhook(userId, subscription.metadata as any)
        break
      case 'hubspot':
        await unregisterHubSpotWebhook(userId, subscription.metadata as any)
        break
      // Gmail watches expire automatically, no need to manually stop
    }

    // Mark as inactive
    await prisma.webhookSubscription.delete({
      where: {
        userId_service: {
          userId,
          service
        }
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error unregistering webhook:', error)
    return NextResponse.json({ error: 'Failed to unregister' }, { status: 500 })
  }
}

async function unregisterCalendarWebhook(userId: string, metadata: any) {
  const auth = await getGoogleClient(userId)
  const calendar = google.calendar({ version: 'v3', auth })

  await calendar.channels.stop({
    requestBody: {
      id: metadata.channelId,
      resourceId: metadata.resourceId
    }
  })
}

async function unregisterHubSpotWebhook(userId: string, metadata: any) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { hubspotAccessToken: true }
  })

  if (!user?.hubspotAccessToken) {
    throw new Error('HubSpot not connected')
  }

  const appId = process.env.HUBSPOT_APP_ID

  await fetch(`https://api.hubapi.com/webhooks/v3/${appId}/subscriptions/${metadata.subscriptionId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${user.hubspotAccessToken}`
    }
  })
}