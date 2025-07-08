import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { google } from 'googleapis'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { source } = await req.json()
    
    if (!source || !['gmail', 'hubspot'].includes(source)) {
      return NextResponse.json({ error: 'Invalid source' }, { status: 400 })
    }

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    let processedCount = 0
    const syncTime = new Date()

    if (source === 'gmail') {
      processedCount = await embedGmailData(user)
      
      // 🔥 UPDATE GMAIL SYNC TIMESTAMP
      await prisma.user.update({
        where: { id: user.id },
        data: { 
          lastGmailSync: syncTime,
        }
      })
      
    } else if (source === 'hubspot') {
      if (!user.hubspotAccessToken) {
        return NextResponse.json({ error: 'HubSpot not connected' }, { status: 400 })
      }
      
      processedCount = await embedHubSpotData(user)
      
      // 🔥 UPDATE HUBSPOT SYNC TIMESTAMP
      await prisma.user.update({
        where: { id: user.id },
        data: { 
          lastHubspotSync: syncTime,
        }
      })
    }

    return NextResponse.json({ 
      success: true,
      message: `Successfully processed ${processedCount} ${source} items`,
      lastSync: syncTime.toISOString(),
      processedCount
    })
    
  } catch (error) {
    console.error('Embed error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 })
  }
}

async function embedGmailData(user: any): Promise<number> {
  if (!user.googleAccessToken) {
    throw new Error('Gmail not connected')
  }

  // Set up Gmail API
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )

  oauth2Client.setCredentials({
    access_token: user.googleAccessToken,
    refresh_token: user.googleRefreshToken
  })

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

  try {
    // Get recent emails - expand to 100 for better coverage
    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 100,
      q: 'newer_than:30d' // Last 30 days for better context
    })

    const messages = response.data.messages || []
    let processedCount = 0

    console.log(`🔍 Found ${messages.length} emails to process for user ${user.email}`)

    // Process messages and store as documents
    for (const message of messages.slice(0, 50)) { // Process up to 50 emails
      try {
        const messageDetail = await gmail.users.messages.get({
          userId: 'me',
          id: message.id!
        })

        const headers = messageDetail.data.payload?.headers || []
        const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject'
        const from = headers.find(h => h.name === 'From')?.value || 'Unknown'
        const to = headers.find(h => h.name === 'To')?.value || 'Unknown'
        const date = headers.find(h => h.name === 'Date')?.value || ''

        // Extract body with better handling
        let body = ''
        if (messageDetail.data.payload?.body?.data) {
          body = Buffer.from(messageDetail.data.payload.body.data, 'base64').toString('utf8')
        } else if (messageDetail.data.payload?.parts) {
          for (const part of messageDetail.data.payload.parts) {
            if (part.mimeType === 'text/plain' && part.body?.data) {
              body = Buffer.from(part.body.data, 'base64').toString('utf8')
              break
            }
            // Fallback to HTML if plain text not available
            if (part.mimeType === 'text/html' && part.body?.data && !body) {
              body = Buffer.from(part.body.data, 'base64').toString('utf8')
            }
          }
        }

        // Use snippet as fallback
        if (!body && messageDetail.data.snippet) {
          body = messageDetail.data.snippet
        }

        // Check if document already exists
        const existingDoc = await prisma.document.findFirst({
          where: {
            userId: user.id,
            sourceId: message.id!,
            source: 'gmail'
          }
        })

        if (!existingDoc) {
          // Create document entry with better content structure
          const content = `Subject: ${subject}
From: ${from}
To: ${to}
Date: ${date}

Content:
${body.substring(0, 3000)}`  // Increased content length
          
          await prisma.document.create({
            data: {
              userId: user.id,
              title: subject,
              content,
              source: 'gmail',
              sourceId: message.id!,
              metadata: {
                from,
                to,
                date,
                snippet: messageDetail.data.snippet || '',
                threadId: messageDetail.data.threadId,
                labelIds: messageDetail.data.labelIds || []
              }
            }
          })

          processedCount++
        }
      } catch (error) {
        console.error('Error processing email:', error)
        continue
      }
    }

    console.log(`✅ Processed ${processedCount} new emails for user ${user.email}`)
    return processedCount
    
  } catch (error) {
    console.error('Gmail API error:', error)
    throw new Error('Failed to sync Gmail data')
  }
}

async function embedHubSpotData(user: any): Promise<number> {
  try {
    // First, check if we need to refresh the token
    const accessToken = await getValidHubSpotToken(user)
    
    // Get HubSpot contacts with pagination support
    let allContacts: any[] = []
    let after = undefined
    let hasMore = true
    
    while (hasMore && allContacts.length < 200) { // Limit to 200 contacts per sync
      const url = new URL('https://api.hubapi.com/crm/v3/objects/contacts')
      url.searchParams.append('limit', '100')
      url.searchParams.append('properties', 'email,firstname,lastname,company,phone,lifecyclestage,notes,createdate,lastmodifieddate')
      if (after) {
        url.searchParams.append('after', after)
      }
      
      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        console.error('HubSpot API error details:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData
        })
        
        if (response.status === 401) {
          throw new Error('HubSpot authentication failed. Please reconnect your HubSpot account.')
        } else if (response.status === 403) {
          throw new Error('HubSpot access denied. Please check your account permissions.')
        } else if (response.status === 429) {
          throw new Error('HubSpot API rate limit exceeded. Please try again later.')
        } else {
          throw new Error(`HubSpot API error: ${response.status} - ${errorData.message || response.statusText}`)
        }
      }

      const data = await response.json()
      allContacts.push(...(data.results || []))
      
      // Check pagination
      hasMore = !!data.paging?.next?.after
      after = data.paging?.next?.after
    }

    console.log(`🔍 Found ${allContacts.length} contacts to process for user ${user.email}`)

    let processedCount = 0

    // Process contacts and store as documents
    for (const contact of allContacts) {
      try {
        const contactData = {
          id: contact.id,
          email: contact.properties?.email || '',
          firstName: contact.properties?.firstname || '',
          lastName: contact.properties?.lastname || '',
          company: contact.properties?.company || '',
          phone: contact.properties?.phone || '',
          lifecycleStage: contact.properties?.lifecyclestage || '',
          notes: contact.properties?.notes || '',
          createDate: contact.properties?.createdate || '',
          lastModified: contact.properties?.lastmodifieddate || ''
        }

        // Check if document already exists
        const existingDoc = await prisma.document.findFirst({
          where: {
            userId: user.id,
            sourceId: contact.id,
            source: 'hubspot'
          }
        })

        if (!existingDoc) {
          // Create document entry with enhanced content
          const content = `Contact: ${contactData.firstName} ${contactData.lastName}
Email: ${contactData.email}
Company: ${contactData.company}
Phone: ${contactData.phone}
Lifecycle Stage: ${contactData.lifecycleStage}
Created: ${contactData.createDate}
Last Modified: ${contactData.lastModified}

Notes:
${contactData.notes}`

          const title = `${contactData.firstName} ${contactData.lastName}`.trim() || contactData.email || `Contact ${contact.id}`

          await prisma.document.create({
            data: {
              userId: user.id,
              title,
              content,
              source: 'hubspot',
              sourceId: contact.id,
              metadata: contactData
            }
          })

          processedCount++
        } else {
          // Update existing document with latest data
          const content = `Contact: ${contactData.firstName} ${contactData.lastName}
Email: ${contactData.email}
Company: ${contactData.company}
Phone: ${contactData.phone}
Lifecycle Stage: ${contactData.lifecycleStage}
Created: ${contactData.createDate}
Last Modified: ${contactData.lastModified}

Notes:
${contactData.notes}`

          await prisma.document.update({
            where: { id: existingDoc.id },
            data: {
              content,
              metadata: contactData,
            }
          })
        }
      } catch (error) {
        console.error('Error processing contact:', error)
        continue
      }
    }

    console.log(`✅ Processed ${processedCount} new contacts for user ${user.email}`)
    return processedCount
    
  } catch (error) {
    console.error('HubSpot API error:', error)
    throw error // Re-throw the original error with better context
  }
}

async function getValidHubSpotToken(user: any): Promise<string> {
  if (!user.hubspotAccessToken) {
    throw new Error('HubSpot access token not found. Please connect your HubSpot account.')
  }

  // Check if token is still valid by making a test request
  const testResponse = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', {
    headers: {
      'Authorization': `Bearer ${user.hubspotAccessToken}`,
      'Content-Type': 'application/json'
    }
  })

  if (testResponse.ok) {
    return user.hubspotAccessToken
  }

  // If token is invalid and we have a refresh token, try to refresh
  if (user.hubspotRefreshToken) {
    try {
      const refreshResponse = await fetch('https://api.hubapi.com/oauth/v1/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: process.env.HUBSPOT_CLIENT_ID!,
          client_secret: process.env.HUBSPOT_CLIENT_SECRET!,
          refresh_token: user.hubspotRefreshToken
        })
      })

      if (refreshResponse.ok) {
        const tokenData = await refreshResponse.json()
        
        // Update user with new token
        await prisma.user.update({
          where: { id: user.id },
          data: {
            hubspotAccessToken: tokenData.access_token,
            hubspotRefreshToken: tokenData.refresh_token || user.hubspotRefreshToken
          }
        })

        return tokenData.access_token
      }
    } catch (refreshError) {
      console.error('Token refresh failed:', refreshError)
    }
  }

  throw new Error('HubSpot authentication expired. Please reconnect your HubSpot account.')
}