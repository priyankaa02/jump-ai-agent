// app/api/webhooks/hubspot/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

export async function POST(req: NextRequest) {
  try {
    // Verify the webhook signature
    const signature = req.headers.get('X-HubSpot-Signature-v3')
    const timestamp = req.headers.get('X-HubSpot-Request-Timestamp')
    
    if (!signature || !timestamp) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
    }

    const body = await req.text()
    
    // Verify signature (implement based on HubSpot's webhook security)
    if (!verifyHubSpotSignature(body, signature, timestamp)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const events = JSON.parse(body)

    // Process each event
    for (const event of events) {
      await processHubSpotEvent(event)
    }

    // Acknowledge the webhook
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('HubSpot webhook error:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}

function verifyHubSpotSignature(body: string, signature: string, timestamp: string): boolean {
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET!
  const sourceString = `${clientSecret}${body}${timestamp}`
  
  const hash = crypto
    .createHash('sha256')
    .update(sourceString)
    .digest('hex')
  
  return hash === signature
}

async function processHubSpotEvent(event: any) {
  const { eventType, objectId, propertyName, propertyValue, portalId } = event

  console.log('Processing HubSpot event:', {
    eventType,
    objectId,
    propertyName,
    portalId
  })

  // Find user by portal ID
  const user = await prisma.user.findFirst({
    where: {
      hubspotPortalId: portalId.toString()
    }
  })

  if (!user) {
    console.error('User not found for portal:', portalId)
    return
  }

  switch (eventType) {
    case 'contact.propertyChange':
      await processContactPropertyChange(user.id, objectId, propertyName, propertyValue)
      break
    
    case 'contact.creation':
      await processContactCreation(user.id, objectId)
      break
    
    case 'contact.deletion':
      await processContactDeletion(user.id, objectId)
      break
    
    case 'deal.propertyChange':
      await processDealPropertyChange(user.id, objectId, propertyName, propertyValue)
      break
    
    case 'deal.creation':
      await processDealCreation(user.id, objectId)
      break
    
    default:
      console.log('Unhandled event type:', eventType)
  }

  // Notify user of updates
  await notifyUser(user.id, 'hubspot', {
    type: 'update',
    eventType,
    objectId
  })
}

async function processContactPropertyChange(
  userId: string, 
  contactId: string, 
  propertyName: string, 
  propertyValue: any
) {
  try {
    // Get existing contact document
    const existingDoc = await prisma.document.findFirst({
      where: {
        userId,
        source: 'hubspot',
        sourceId: `contact-${contactId}`
      }
    })

    if (existingDoc) {
      // Update the property in metadata
      const metadata = existingDoc.metadata as any || {}
      metadata[propertyName] = propertyValue
      metadata.lastModified = new Date()

      await prisma.document.update({
        where: { id: existingDoc.id },
        data: { metadata }
      })
    } else {
      // Fetch full contact details and create document
      await fetchAndStoreContact(userId, contactId)
    }

    console.log('Processed contact property change:', {
      contactId,
      propertyName,
      propertyValue
    })
  } catch (error) {
    console.error('Error processing contact property change:', error)
  }
}

async function processContactCreation(userId: string, contactId: string) {
  try {
    await fetchAndStoreContact(userId, contactId)
    console.log('Processed new contact:', contactId)
  } catch (error) {
    console.error('Error processing contact creation:', error)
  }
}

async function processContactDeletion(userId: string, contactId: string) {
  try {
    await prisma.document.deleteMany({
      where: {
        userId,
        source: 'hubspot',
        sourceId: `contact-${contactId}`
      }
    })
    console.log('Processed contact deletion:', contactId)
  } catch (error) {
    console.error('Error processing contact deletion:', error)
  }
}

async function processDealPropertyChange(
  userId: string, 
  dealId: string, 
  propertyName: string, 
  propertyValue: any
) {
  try {
    // Get existing deal document
    const existingDoc = await prisma.document.findFirst({
      where: {
        userId,
        source: 'hubspot',
        sourceId: `deal-${dealId}`
      }
    })

    if (existingDoc) {
      // Update the property in metadata
      const metadata = existingDoc.metadata as any || {}
      metadata[propertyName] = propertyValue
      metadata.lastModified = new Date()

      await prisma.document.update({
        where: { id: existingDoc.id },
        data: { metadata }
      })
    } else {
      // Fetch full deal details and create document
      await fetchAndStoreDeal(userId, dealId)
    }

    console.log('Processed deal property change:', {
      dealId,
      propertyName,
      propertyValue
    })
  } catch (error) {
    console.error('Error processing deal property change:', error)
  }
}

async function processDealCreation(userId: string, dealId: string) {
  try {
    await fetchAndStoreDeal(userId, dealId)
    console.log('Processed new deal:', dealId)
  } catch (error) {
    console.error('Error processing deal creation:', error)
  }
}

async function fetchAndStoreContact(userId: string, contactId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { hubspotAccessToken: true }
  })

  if (!user?.hubspotAccessToken) {
    throw new Error('HubSpot access token not found')
  }

  // Fetch contact details from HubSpot API
  const response = await fetch(
    `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=email,firstname,lastname,phone,company,jobtitle,lifecycle_stage`,
    {
      headers: {
        'Authorization': `Bearer ${user.hubspotAccessToken}`
      }
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch contact: ${response.statusText}`)
  }

  const contact = await response.json()

  // Store as document
  const existingDocument = await prisma.document.findFirst({
    where: {
      userId,
      sourceId: `contact-${contactId}`
    }
  })

  if (existingDocument) {
    await prisma.document.update({
      where: { id: existingDocument.id },
      data: {
        title: `${contact.properties.firstname || ''} ${contact.properties.lastname || ''}`.trim() || contact.properties.email || 'Unknown Contact',
        content: formatContactContent(contact.properties),
        metadata: {
          ...contact.properties,
          objectType: 'contact',
          hubspotId: contactId,
          lastModified: new Date()
        }
      }
    })
  } else {
    await prisma.document.create({
      data: {
        userId,
        title: `${contact.properties.firstname || ''} ${contact.properties.lastname || ''}`.trim() || contact.properties.email || 'Unknown Contact',
        content: formatContactContent(contact.properties),
        source: 'hubspot',
        sourceId: `contact-${contactId}`,
        metadata: {
          ...contact.properties,
          objectType: 'contact',
          hubspotId: contactId,
          lastModified: new Date()
        }
      }
    })
  }
}

async function fetchAndStoreDeal(userId: string, dealId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { hubspotAccessToken: true }
  })

  if (!user?.hubspotAccessToken) {
    throw new Error('HubSpot access token not found')
  }

  // Fetch deal details from HubSpot API
  const response = await fetch(
    `https://api.hubapi.com/crm/v3/objects/deals/${dealId}?properties=dealname,amount,dealstage,closedate,pipeline`,
    {
      headers: {
        'Authorization': `Bearer ${user.hubspotAccessToken}`
      }
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch deal: ${response.statusText}`)
  }

  const deal = await response.json()

  // Store as document
  const existingDeal = await prisma.document.findFirst({
    where: {
      userId,
      sourceId: `deal-${dealId}`
    }
  })

  if (existingDeal) {
    await prisma.document.update({
      where: { id: existingDeal.id },
      data: {
        title: deal.properties.dealname || 'Unknown Deal',
        content: formatDealContent(deal.properties),
        metadata: {
          ...deal.properties,
          objectType: 'deal',
          hubspotId: dealId,
          lastModified: new Date()
        }
      }
    })
  } else {
    await prisma.document.create({
      data: {
        userId,
        title: deal.properties.dealname || 'Unknown Deal',
        content: formatDealContent(deal.properties),
        source: 'hubspot',
        sourceId: `deal-${dealId}`,
        metadata: {
          ...deal.properties,
          objectType: 'deal',
          hubspotId: dealId,
          lastModified: new Date()
        }
      }
    })
  }
}

function formatContactContent(properties: any): string {
  const parts = []
  
  if (properties.email) parts.push(`Email: ${properties.email}`)
  if (properties.phone) parts.push(`Phone: ${properties.phone}`)
  if (properties.company) parts.push(`Company: ${properties.company}`)
  if (properties.jobtitle) parts.push(`Job Title: ${properties.jobtitle}`)
  if (properties.lifecycle_stage) parts.push(`Lifecycle Stage: ${properties.lifecycle_stage}`)
  
  return parts.join('\n')
}

function formatDealContent(properties: any): string {
  const parts = []
  
  if (properties.dealname) parts.push(`Deal: ${properties.dealname}`)
  if (properties.amount) parts.push(`Amount: $${properties.amount}`)
  if (properties.dealstage) parts.push(`Stage: ${properties.dealstage}`)
  if (properties.closedate) parts.push(`Close Date: ${new Date(properties.closedate).toLocaleDateString()}`)
  if (properties.pipeline) parts.push(`Pipeline: ${properties.pipeline}`)
  
  return parts.join('\n')
}

// Notify user of updates
async function notifyUser(userId: string, service: string, data: any) {
  console.log('Notifying user:', { userId, service, data })
  
  // You could emit events via your WebSocket server here
  // Example: io.to(userId).emit('webhook:update', { service, data })
}

// GET endpoint for webhook verification (if HubSpot requires it)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const challenge = searchParams.get('challenge')
  
  if (challenge) {
    return new NextResponse(challenge, { status: 200 })
  }
  
  return NextResponse.json({ status: 'ok' })
}