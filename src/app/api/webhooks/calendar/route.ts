// app/api/webhooks/calendar/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { prisma } from '@/lib/prisma'
import { getGoogleClient } from '@/lib/google'

export async function POST(req: NextRequest) {
  try {
    // Get headers from the Google Calendar push notification
    const channelId = req.headers.get('x-goog-channel-id')
    const resourceId = req.headers.get('x-goog-resource-id')
    const resourceState = req.headers.get('x-goog-resource-state')
    const channelExpiration = req.headers.get('x-goog-channel-expiration')
    const messageNumber = req.headers.get('x-goog-message-number')
    const channelToken = req.headers.get('x-goog-channel-token')

    if (!channelId || !resourceId) {
      console.error('Missing required headers')
      return NextResponse.json({ error: 'Missing headers' }, { status: 400 })
    }

    // Find the webhook subscription
    const subscription = await prisma.webhookSubscription.findFirst({
      where: {
        service: 'calendar',
        metadata: {
          path: ['channelId'],
          equals: channelId
        }
      },
      include: {
        user: true
      }
    })

    if (!subscription) {
      console.error('Subscription not found for channel:', channelId)
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }

    // Verify the token if provided
    const metadata = subscription.metadata as any
    if (metadata.token && channelToken !== metadata.token) {
      console.error('Invalid token')
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    // Handle different resource states
    switch (resourceState) {
      case 'sync':
        // Initial sync notification - just acknowledge
        console.log('Calendar sync notification received')
        break
      case 'exists':
        // Calendar events have changed
        await processCalendarChanges(subscription.userId, metadata)
        break
      case 'not_exists':
        // Calendar was deleted
        await handleCalendarDeletion(subscription.userId, metadata)
        break
      default:
        console.log('Unknown resource state:', resourceState)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Calendar webhook error:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

async function processCalendarChanges(userId: string, metadata: any) {
  const auth = await getGoogleClient(userId)
  const calendar = google.calendar({ version: 'v3', auth })

  try {
    const calendarId = metadata.calendarId

    // Get the sync token from metadata to fetch incremental changes
    const syncToken = metadata.syncToken

    // Fix: Change type to string | undefined (remove null)
    let pageToken: string | undefined
    let allEvents: any[] = []

    do {
      // Fix: Add await keyword
      const eventsResponse = await calendar.events.list({
        calendarId,
        syncToken: syncToken || undefined,
        pageToken,
        maxResults: 250,
        singleEvents: true,
        orderBy: 'startTime'
      })

      if (eventsResponse.data.items) {
        allEvents = allEvents.concat(eventsResponse.data.items)
      }

      //@ts-ignore
      pageToken = eventsResponse.data.nextPageToken

      // Store the new sync token for next time
      if (eventsResponse.data.nextSyncToken) {
        await prisma.webhookSubscription.update({
          where: {
            userId_service: {
              userId,
              service: 'calendar'
            }
          },
          data: {
            metadata: {
              ...metadata,
              syncToken: eventsResponse.data.nextSyncToken
            }
          }
        })
      }
    } while (pageToken)

    // Process each event
    for (const event of allEvents) {
      await processCalendarEvent(userId, event, calendarId)
    }

    console.log(`Processed ${allEvents.length} calendar events for user ${userId}`)
  } catch (error) {
    console.error('Error processing calendar changes:', error)
    throw error
  }
}

async function processCalendarEvent(userId: string, event: any, calendarId: string) {
  try {
    // Handle deleted events
    if (event.status === 'cancelled') {
      await prisma.document.deleteMany({
        where: {
          userId,
          sourceId: event.id,
          source: 'calendar'
        }
      })
      console.log('Deleted calendar event:', event.id)
      return
    }

    // Extract event details
    const title = event.summary || 'Untitled Event'
    const description = event.description || ''
    const startTime = event.start?.dateTime || event.start?.date
    const endTime = event.end?.dateTime || event.end?.date
    const location = event.location || ''
    const attendees = event.attendees || []

    // Create content for the document
    const content = [
      description,
      location && `Location: ${location}`,
      `Start: ${startTime}`,
      `End: ${endTime}`,
      attendees.length > 0 && `Attendees: ${attendees.map((a: any) => a.email).join(', ')}`
    ].filter(Boolean).join('\n')

    // Check if document already exists
    const existingDocument = await prisma.document.findFirst({
      where: {
        userId,
        sourceId: event.id,
        source: 'calendar'
      }
    })

    if (existingDocument) {
      // Update existing document
      await prisma.document.update({
        where: {
          id: existingDocument.id
        },
        data: {
          title,
          content,
          metadata: {
            calendarId,
            eventId: event.id,
            startTime,
            endTime,
            location,
            attendees: attendees.map((a: any) => ({
              email: a.email,
              displayName: a.displayName,
              responseStatus: a.responseStatus
            })),
            htmlLink: event.htmlLink,
            created: event.created,
            updated: event.updated,
            recurringEventId: event.recurringEventId,
            originalStartTime: event.originalStartTime,
            eventType: event.eventType
          }
        }
      })
    } else {
      // Create new document
      await prisma.document.create({
        data: {
          userId,
          title,
          content,
          source: 'calendar',
          sourceId: event.id,
          metadata: {
            calendarId,
            eventId: event.id,
            startTime,
            endTime,
            location,
            attendees: attendees.map((a: any) => ({
              email: a.email,
              displayName: a.displayName,
              responseStatus: a.responseStatus
            })),
            htmlLink: event.htmlLink,
            created: event.created,
            updated: event.updated,
            recurringEventId: event.recurringEventId,
            originalStartTime: event.originalStartTime,
            eventType: event.eventType
          }
        }
      })
    }

    console.log('Processed calendar event:', { eventId: event.id, title })
  } catch (error) {
    console.error('Error processing calendar event:', error)
  }
}

async function handleCalendarDeletion(userId: string, metadata: any) {
  try {
    const calendarId = metadata.calendarId

    // Delete all events from this calendar
    await prisma.document.deleteMany({
      where: {
        userId,
        source: 'calendar',
        metadata: {
          path: ['calendarId'],
          equals: calendarId
        }
      }
    })

    // Delete the webhook subscription
    await prisma.webhookSubscription.delete({
      where: {
        userId_service: {
          userId,
          service: 'calendar'
        }
      }
    })

    console.log('Handled calendar deletion for user:', userId)
  } catch (error) {
    console.error('Error handling calendar deletion:', error)
  }
}

// Notify user of updates (implement based on your real-time system)
async function notifyUser(userId: string, service: string, data: any) {
  // This could be WebSocket, Server-Sent Events, or any real-time solution
  // For now, we'll just log it
  console.log('Notifying user:', { userId, service, data })
  
  // You could emit events via your WebSocket server here
  // Example: io.to(userId).emit('webhook:update', { service, data })
}

// GET endpoint to verify webhook setup (for Google verification)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const challenge = searchParams.get('hub.challenge')
  
  if (challenge) {
    return new NextResponse(challenge, { status: 200 })
  }
  
  return NextResponse.json({ status: 'ok' })
}

// HEAD endpoint for webhook verification
export async function HEAD(req: NextRequest) {
  // Google sometimes sends HEAD requests to verify the webhook endpoint
  return new NextResponse(null, { status: 200 })
}