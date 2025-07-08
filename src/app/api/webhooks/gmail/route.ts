import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { prisma } from '@/lib/prisma'
import { getGoogleClient } from '@/lib/google'
import { handleGmailWebhook } from '@/lib/proactive-agent'

export async function POST(req: NextRequest) {
  try {
    // Verify the push notification is from Google
    const body = await req.json()
    
    // Decode the Pub/Sub message
    const message = JSON.parse(
      Buffer.from(body.message.data, 'base64').toString()
    )

    const { emailAddress, historyId } = message

    // Find the user by email
    const user = await prisma.user.findUnique({
      where: { email: emailAddress },
      include: {
        WebhookSubscription: {
          where: { service: 'hubspot' }
        }
      }
    })

    if (!user) {
      console.error('User not found for email:', emailAddress)
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Get the stored webhook subscription
    const subscription = await prisma.webhookSubscription.findUnique({
      where: {
        userId_service: {
          userId: user.id,
          service: 'gmail'
        }
      }
    })

    if (!subscription) {
      console.error('Subscription not found for user:', user.id)
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }

    // Process Gmail history
    await processGmailHistory(user, historyId, subscription.metadata as any)

    // Acknowledge the webhook
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Gmail webhook error:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

async function processGmailHistory(user: any, historyId: string, metadata: any) {
  const auth = await getGoogleClient(user.id)
  const gmail = google.gmail({ version: 'v1', auth })

  try {
    // Get the history changes since last known historyId
    const historyResponse = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: metadata.historyId,
      labelId: 'INBOX',
      historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved']
    })

    if (!historyResponse.data.history) {
      console.log('No history changes found')
      return
    }

    // Process each history record
    for (const record of historyResponse.data.history) {
      // Process new messages
      if (record.messagesAdded) {
        for (const added of record.messagesAdded) {
          await processNewMessage(gmail, user, added.message!.id!)
        }
      }

      // Process deleted messages
      if (record.messagesDeleted) {
        for (const deleted of record.messagesDeleted) {
          await processDeletedMessage(user.id, deleted.message!.id!)
        }
      }

      // Process label changes
      if (record.labelsAdded) {
        for (const labelAdded of record.labelsAdded) {
          await processLabelChange(user.id, labelAdded.message!.id!, labelAdded.labelIds!, 'added')
        }
      }

      if (record.labelsRemoved) {
        for (const labelRemoved of record.labelsRemoved) {
          await processLabelChange(user.id, labelRemoved.message!.id!, labelRemoved.labelIds!, 'removed')
        }
      }
    }

    // Update the stored historyId
    await prisma.webhookSubscription.update({
      where: {
        userId_service: {
          userId: user.id,
          service: 'gmail'
        }
      },
      data: {
        metadata: {
          ...metadata,
          historyId: historyId
        }
      }
    })

    // Trigger any real-time updates (e.g., via WebSocket)
    await notifyUser(user.id, 'gmail', {
      type: 'update',
      historyId
    })

  } catch (error) {
    console.error('Error processing Gmail history:', error)
    throw error
  }
}

function extractEmailBody(payload: any): string {
    let body = ''
  
    if (payload.body?.data) {
      body = Buffer.from(payload.body.data, 'base64').toString('utf-8')
    } else if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          body = Buffer.from(part.body.data, 'base64').toString('utf-8')
          break
        } else if (part.mimeType === 'text/html' && part.body?.data && !body) {
          // Fallback to HTML if no plain text
          body = Buffer.from(part.body.data, 'base64').toString('utf-8')
          // Simple HTML stripping
          body = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        } else if (part.parts) {
          // Recursive search in nested parts
          body = extractEmailBody(part) || body
        }
      }
    }
  
    return body
  }

async function processNewMessage(gmail: any, user: any, messageId: string) {
  try {
    // Fetch the full message
    const message = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full'
    })

    // Extract relevant information
    const headers = message.data.payload.headers
    const subject = headers.find((h: any) => h.name === 'Subject')?.value
    const from = headers.find((h: any) => h.name === 'From')?.value
    const to = headers.find((h: any) => h.name === 'To')?.value
    const date = headers.find((h: any) => h.name === 'Date')?.value

    // Extract sender email and name
    const fromMatch = from?.match(/^(.+?)\s*<(.+?)>$/) || from?.match(/^(.+)$/)
    const senderEmail = fromMatch ? (fromMatch[2] || fromMatch[1]).trim() : from
    const senderName = fromMatch && fromMatch[2] ? fromMatch[1].trim() : null

    // Check if document already exists
    const existingDocument = await prisma.document.findFirst({
      where: {
        userId: user.id,
        sourceId: messageId,
        source: 'gmail'
      }
    })

    if (existingDocument) {
      // Update existing document
      await prisma.document.update({
        where: {
          id: existingDocument.id
        },
        data: {
          title: subject || 'No Subject',
          content: message.data.snippet || '',
          metadata: {
            from,
            to,
            date,
            labels: message.data.labelIds,
            threadId: message.data.threadId,
            internalDate: message.data.internalDate,
            senderEmail,
            senderName
          }
        }
      })
    } else {
      // Create new document
      await prisma.document.create({
        data: {
          userId: user.id,
          title: subject || 'No Subject',
          content: message.data.snippet || '',
          source: 'gmail',
          sourceId: messageId,
          metadata: {
            from,
            to,
            date,
            labels: message.data.labelIds,
            threadId: message.data.threadId,
            internalDate: message.data.internalDate,
            senderEmail,
            senderName
          }
        }
      })
    }

    // Check if we should create a HubSpot contact
    if (senderEmail && user.hubspotAccessToken) {
      await checkAndCreateHubSpotContact(user, senderEmail, senderName, {
        emailSubject: subject,
        emailDate: date,
        messageId
      })
    }

    console.log('Processed new message:', { messageId, subject, from })
  } catch (error) {
    console.error('Error processing new message:', error)
  }
}

async function checkAndCreateHubSpotContact(
    user: any, 
    email: string, 
    name: string | null, 
    emailContext: any
  ) {
    try {
      // Skip if email is the user's own email
      if (email === user.email) {
        return
      }
  
      // Check if contact already exists in HubSpot
      const searchResponse = await fetch(
        `https://api.hubapi.com/crm/v3/objects/contacts/search`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${user.hubspotAccessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: 'email',
                    operator: 'EQ',
                    value: email
                  }
                ]
              }
            ],
            properties: ['email', 'firstname', 'lastname', 'createdate'],
            limit: 1
          })
        }
      )
  
      if (!searchResponse.ok) {
        throw new Error(`HubSpot search failed: ${searchResponse.statusText}`)
      }
  
      const searchResult = await searchResponse.json()
      
      if (searchResult.total > 0) {
        console.log('Contact already exists in HubSpot:', email)
        return
      }
  
      // Parse name if available
      const { firstName, lastName } = parseName(name)
  
      // Create new contact in HubSpot with only standard properties
      const contactData = {
        properties: {
          email: email,
          ...(firstName && { firstname: firstName }),
          ...(lastName && { lastname: lastName }),
          lifecyclestage: 'lead',
          hs_lead_status: 'NEW'
        }
      }
  
      const createResponse = await fetch(
        'https://api.hubapi.com/crm/v3/objects/contacts',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${user.hubspotAccessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(contactData)
        }
      )
  
      if (!createResponse.ok) {
        const errorData = await createResponse.json()
        throw new Error(`HubSpot contact creation failed: ${createResponse.statusText} - ${JSON.stringify(errorData)}`)
      }
  
      const newContact = await createResponse.json()
      console.log('Created new HubSpot contact:', newContact.id, email)
  
      // Create a document record for the new contact
      await prisma.document.create({
        data: {
          userId: user.id,
          title: `${firstName || ''} ${lastName || ''}`.trim() || email,
          content: formatContactContent({
            email,
            firstname: firstName,
            lastname: lastName,
            lifecyclestage: 'lead',
            hs_lead_status: 'NEW',
            email_source: 'gmail_integration'
          }),
          source: 'hubspot',
          sourceId: `contact-${newContact.id}`,
          metadata: {
            ...newContact.properties,
            objectType: 'contact',
            hubspotId: newContact.id,
            createdFrom: 'gmail_email',
            sourceEmail: emailContext,
            lastModified: new Date()
          }
        }
      })
  
      // Notify user about the new contact creation
      await notifyUser(user.id, 'hubspot', {
        type: 'contact_created',
        contactId: newContact.id,
        email: email,
        name: `${firstName || ''} ${lastName || ''}`.trim() || email,
        source: 'gmail_integration',
        emailContext
      })
  
      // Log activity
      await prisma.activityLog.create({
        data: {
          userId: user.id,
          action: 'contact_created',
          service: 'hubspot',
          details: {
            contactId: newContact.id,
            email: email,
            name: `${firstName || ''} ${lastName || ''}`.trim() || email,
            source: 'gmail_integration',
            triggeredBy: 'gmail_webhook'
          }
        }
      })
  
    } catch (error: any) {
      console.error('Error creating HubSpot contact:', error)
      
      // Log the error for debugging
      await prisma.activityLog.create({
        data: {
          userId: user.id,
          action: 'contact_creation_failed',
          service: 'hubspot',
          details: {
            email: email,
            error: error.message,
            source: 'gmail_integration'
          }
        }
      }).catch(console.error)
    }
  }
  
function parseName(fullName: string | null): { firstName: string | null, lastName: string | null } {
  if (!fullName) return { firstName: null, lastName: null }
  
  // Remove common email artifacts
  const cleanName = fullName.replace(/[<>]/g, '').trim()
  
  // Skip if it looks like an email address
  if (cleanName.includes('@')) return { firstName: null, lastName: null }
  
  const nameParts = cleanName.split(/\s+/)
  
  if (nameParts.length === 1) {
    return { firstName: nameParts[0], lastName: null }
  } else if (nameParts.length >= 2) {
    return { 
      firstName: nameParts[0], 
      lastName: nameParts.slice(1).join(' ') 
    }
  }
  
  return { firstName: null, lastName: null }
}

function formatContactContent(properties: any): string {
  const parts = []
  
  if (properties.email) parts.push(`Email: ${properties.email}`)
  if (properties.firstname) parts.push(`First Name: ${properties.firstname}`)
  if (properties.lastname) parts.push(`Last Name: ${properties.lastname}`)
  if (properties.lifecyclestage) parts.push(`Lifecycle Stage: ${properties.lifecyclestage}`)
  if (properties.hs_lead_status) parts.push(`Lead Status: ${properties.hs_lead_status}`)
  if (properties.email_source) parts.push(`Source: ${properties.email_source}`)
  
  return parts.join('\n')
}

async function processDeletedMessage(userId: string, messageId: string) {
  try {
    // Delete message from database
    await prisma.document.deleteMany({
      where: {
        sourceId: messageId,
        userId,
        source: 'gmail'
      }
    })

    console.log('Processed deleted message:', messageId)
  } catch (error) {
    console.error('Error processing deleted message:', error)
  }
}

async function processLabelChange(
  userId: string, 
  messageId: string, 
  labelIds: string[], 
  action: 'added' | 'removed'
) {
  try {
    const document = await prisma.document.findFirst({
      where: {
        sourceId: messageId,
        userId,
        source: 'gmail'
      }
    })

    if (!document) {
      console.log('Message not found in database:', messageId)
      return
    }

    const metadata = document.metadata as any || {}
    let updatedLabels = metadata.labels || []

    if (action === 'added') {
      updatedLabels = [...new Set([...updatedLabels, ...labelIds])]
    } else {
      updatedLabels = updatedLabels.filter((label: string) => !labelIds.includes(label))
    }

    await prisma.document.update({
      where: {
        id: document.id
      },
      data: {
        metadata: {
          ...metadata,
          labels: updatedLabels
        }
      }
    })

    console.log(`Labels ${action} for message:`, { messageId, labelIds })
  } catch (error) {
    console.error('Error processing label change:', error)
  }
}

// Enhanced notification function
async function notifyUser(userId: string, service: string, data: any) {
  console.log('Notifying user:', { userId, service, data })
  
  // Store notification in database for UI to pick up
  await prisma.notification.create({
    data: {
      userId,
      type: data.type || 'update',
      service,
      title: getNotificationTitle(data),
      message: getNotificationMessage(data),
      data: data,
      read: false
    }
  }).catch(console.error)
  
  // You could emit events via your WebSocket server here
  // Example: io.to(userId).emit('webhook:update', { service, data })
}

function getNotificationTitle(data: any): string {
  switch (data.type) {
    case 'contact_created':
      return 'New Contact Created'
    case 'update':
      return 'Data Updated'
    default:
      return 'Notification'
  }
}

function getNotificationMessage(data: any): string {
  switch (data.type) {
    case 'contact_created':
      return `New contact "${data.name}" was created in HubSpot from Gmail email`
    case 'update':
      return `${data.service} data has been updated`
    default:
      return 'You have a new notification'
  }
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