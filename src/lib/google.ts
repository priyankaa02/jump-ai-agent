import { google } from 'googleapis'
import { prisma } from './prisma'

export async function getGoogleClient(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  })

  if (!user?.googleAccessToken) {
    throw new Error('Google access token not found')
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.NEXTAUTH_URL + '/api/auth/callback/google'
  )

  oauth2Client.setCredentials({
    access_token: user.googleAccessToken,
    refresh_token: user.googleRefreshToken,
  })

  return oauth2Client
}

export async function getGmailEmails(userId: string, maxResults = 100) {
  const auth = await getGoogleClient(userId)
  const gmail = google.gmail({ version: 'v1', auth })

  const response = await gmail.users.messages.list({
    userId: 'me',
    maxResults,
    q: 'in:inbox OR in:sent',
  })

  const messages = []
  if (response.data.messages) {
    for (const message of response.data.messages) {
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: message.id!,
      })
      messages.push(detail.data)
    }
  }

  return messages
}

export async function sendGmailEmail(
  userId: string, 
  to: string, 
  subject: string, 
  body: string,
  cc?: string | string[],
  bcc?: string | string[],
  threadId?: string // Added threadId parameter
) {
  const auth = await getGoogleClient(userId)
  const gmail = google.gmail({ version: 'v1', auth })

  const emailLines = [
    `To: ${to}`,
    `Subject: ${subject}`,
  ]

  if (cc) {
    const ccAddresses = Array.isArray(cc) ? cc.join(', ') : cc
    emailLines.push(`Cc: ${ccAddresses}`)
  }

  if (bcc) {
    const bccAddresses = Array.isArray(bcc) ? bcc.join(', ') : bcc
    emailLines.push(`Bcc: ${bccAddresses}`)
  }

  if (threadId) {
    emailLines.push(`In-Reply-To: ${threadId}`)
    emailLines.push(`References: ${threadId}`)
  }

  emailLines.push('Content-Type: text/html; charset=utf-8')
  emailLines.push('MIME-Version: 1.0')
  
  emailLines.push('')
  
  emailLines.push(body)

  const email = emailLines.join('\r\n')
  
  const encodedEmail = Buffer.from(email)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '') // Remove padding

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedEmail,
      threadId: threadId
    },
  })

  return response.data
}

export async function getCalendarEvents(userId: string, maxResults = 100) {
  const auth = await getGoogleClient(userId)
  const calendar = google.calendar({ version: 'v3', auth })

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: new Date().toISOString(),
    maxResults,
    singleEvents: true,
    orderBy: 'startTime',
  })

  return response.data.items || []
}

export async function searchCalendarEvents(
  userId: string, 
  params: {
    query?: string,
    timeMin?: string,
    timeMax?: string,
    maxResults?: number
  }
) {
  const auth = await getGoogleClient(userId)
  const calendar = google.calendar({ version: 'v3', auth })

  const searchParams: any = {
    calendarId: 'primary',
    timeMin: params.timeMin || new Date().toISOString(),
    timeMax: params.timeMax || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days ahead
    maxResults: params.maxResults || 10,
    singleEvents: true,
    orderBy: 'startTime',
  }

  if (params.query) {
    searchParams.q = params.query
  }

  const response = await calendar.events.list(searchParams)

  const events = response.data.items || []

  if (params.query && params.query.includes('@')) {
    return events.filter(event => 
      event.attendees?.some(attendee => 
        attendee.email?.toLowerCase().includes(params.query!.toLowerCase())
      )
    )
  }

  return events
}

export async function createCalendarEvent(userId: string, event: any) {
  const auth = await getGoogleClient(userId)
  const calendar = google.calendar({ version: 'v3', auth })

  const response = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: event,
  })

  return response.data
}

export async function getAvailableTimeSlots(userId: string, duration = 60) {
  const auth = await getGoogleClient(userId)
  const calendar = google.calendar({ version: 'v3', auth })

  const timeMin = new Date()
  const timeMax = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // Next 7 days

  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: 'America/New_York',
      items: [{ id: 'primary' }],
    },
  })

  const busyTimes = response.data.calendars?.primary?.busy || []
  const availableSlots = []

  // Generate business hours slots and filter out busy times
  for (let day = 0; day < 7; day++) {
    const currentDate = new Date(timeMin.getTime() + day * 24 * 60 * 60 * 1000)
    
    // Business hours: 9 AM to 5 PM
    for (let hour = 9; hour < 17; hour++) {
      const slotStart = new Date(currentDate)
      slotStart.setHours(hour, 0, 0, 0)
      
      const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000)
      
      // Check if slot conflicts with busy times
      const isAvailable = !busyTimes.some(busy => {
        const busyStart = new Date(busy.start!)
        const busyEnd = new Date(busy.end!)
        return slotStart < busyEnd && slotEnd > busyStart
      })
      
      if (isAvailable) {
        availableSlots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
        })
      }
    }
  }

  return availableSlots.slice(0, 5)
}