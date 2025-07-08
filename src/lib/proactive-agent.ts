import { prisma } from '@/lib/prisma'
import { 
  sendGmailEmail, 
  searchCalendarEvents 
} from '@/lib/google'
import { 
  searchHubSpotContact, 
  createHubSpotContact, 
  addHubSpotNote 
} from '@/lib/hubspot'

interface ProactiveContext {
  event: string
  service: string
  data: any
  userId: string
}

interface InstructionMatch {
  instruction: any
  confidence: number
  extractedParams: any
}

export async function handleProactiveEvent(context: ProactiveContext) {
  console.log('🤖 Proactive Agent activated for:', context.event, context.service)
  
  try {
    const instructions = await prisma.ongoingInstruction.findMany({
      where: {
        userId: context.userId,
        isActive: true
      },
      orderBy: { createdAt: 'desc' }
    })

    console.log(`📋 Found ${instructions.length} active instructions`)

    const matches = await analyzeEventAgainstInstructions(context, instructions)
    
    for (const match of matches) {
      if (match.confidence > 0.7) {
        console.log(`✅ Executing instruction: ${match.instruction.instruction}`)
        await executeProactiveAction(context, match)
      }
    }

    await handleContextualResponse(context)

  } catch (error) {
    console.error('❌ Proactive agent error:', error)
    
    await prisma.activityLog.create({
      data: {
        userId: context.userId,
        action: 'proactive_action_failed',
        service: context.service,
        details: {
          event: context.event,
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      }
    })
  }
}

async function analyzeEventAgainstInstructions(
  context: ProactiveContext, 
  instructions: any[]
): Promise<InstructionMatch[]> {
  const matches: InstructionMatch[] = []

  for (const instruction of instructions) {
    const match = await analyzeInstructionMatch(context, instruction)
    if (match.confidence > 0) {
      matches.push(match)
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence)
}

async function analyzeInstructionMatch(
  context: ProactiveContext,
  instruction: any
): Promise<InstructionMatch> {
  const instructionText = instruction.instruction.toLowerCase()
  
  const patterns = {
    emailNotInHubspot: {
      pattern: /when\s+(?:someone|anyone|a person)\s+emails?\s+(?:me|us).*(?:not\s+in|not\s+already\s+in|doesn't exist in)\s+hubspot/i,
      requiredEvent: 'new_email',
      requiredService: 'gmail'
    },
    contactCreated: {
      pattern: /when\s+(?:i|we)\s+create\s+(?:a\s+)?contact\s+in\s+hubspot.*(?:send|email)/i,
      requiredEvent: 'contact_created',
      requiredService: 'hubspot'
    },
    calendarEvent: {
      pattern: /when\s+(?:i|we)\s+(?:add|create|schedule)\s+(?:an?\s+)?(?:event|meeting|appointment).*(?:send|email|notify)/i,
      requiredEvent: 'event_created',
      requiredService: 'calendar'
    },
    emailSent: {
        pattern: /when\s+(?:i|we)\s+send\s+(?:an?\s+)?email.*(?:add|create|log)\s+(?:a\s+)?note/i,
        requiredEvent: 'email_sent',
        requiredService: 'gmail'
      },
      meetingScheduled: {
        pattern: /when\s+(?:i|we)\s+schedule\s+(?:a\s+)?meeting.*(?:send|email|notify|remind)/i,
        requiredEvent: 'meeting_scheduled',
        requiredService: 'calendar'
      },
      noteAdded: {
        pattern: /when\s+(?:i|we)\s+add\s+(?:a\s+)?note.*(?:send|email|notify|follow)/i,
        requiredEvent: 'note_added',
        requiredService: 'hubspot'
      },
      noAvailability: {
        pattern: /when\s+(?:i|we)\s+(?:have\s+)?no\s+availability.*(?:suggest|recommend|offer)/i,
        requiredEvent: 'no_availability_found',
        requiredService: 'calendar'
      },
      contactEmailSent: {
        pattern: /when\s+(?:i|we)\s+email\s+(?:a\s+)?contact.*(?:log|track|record)/i,
        requiredEvent: 'email_sent',
        requiredService: 'gmail'
      },
      meetingWithContact: {
        pattern: /when\s+(?:i|we)\s+meet\s+with\s+(?:a\s+)?contact.*(?:follow|send|email)/i,
        requiredEvent: 'meeting_scheduled',
        requiredService: 'calendar'
      }
  }

  let bestMatch = { confidence: 0, extractedParams: {} }

  for (const [type, config] of Object.entries(patterns)) {
    if (config.pattern.test(instructionText)) {
      if (context.event === config.requiredEvent && context.service === config.requiredService) {
        bestMatch.confidence = 0.9
        
        switch (type) {
          case 'emailNotInHubspot':
            bestMatch.extractedParams = extractEmailToContactParams(instructionText, context.data)
            break
          case 'contactCreated':
            bestMatch.extractedParams = extractContactCreatedParams(instructionText, context.data)
            break
          case 'calendarEvent':
            bestMatch.extractedParams = extractCalendarEventParams(instructionText, context.data)
            break
        }
      }
    }
  }

  return {
    instruction,
    confidence: bestMatch.confidence,
    extractedParams: bestMatch.extractedParams
  }
}

function extractEmailToContactParams(instruction: string, emailData: any) {
  const params: any = {
    action: 'create_contact_from_email',
    email: emailData.senderEmail,
    firstName: emailData.senderName?.split(' ')[0] || null,
    lastName: emailData.senderName?.split(' ').slice(1).join(' ') || null,
    emailSubject: emailData.subject,
    emailContent: emailData.snippet || emailData.content
  }

  if (/with\s+(?:a\s+)?note/i.test(instruction)) {
    params.addNote = true
    params.noteContent = `Email received: "${emailData.subject}"\n${emailData.snippet || ''}`
  }

  return params
}

function extractContactCreatedParams(instruction: string, contactData: any) {
  const params: any = {
    action: 'send_welcome_email',
    contactEmail: contactData.email,
    contactName: `${contactData.firstname || ''} ${contactData.lastname || ''}`.trim()
  }

  const thankYouMatch = instruction.match(/thank\s+you\s+for\s+(.+?)(?:\.|$)/i)
  if (thankYouMatch) {
    params.emailSubject = 'Thank you for connecting!'
    params.emailBody = `Dear ${params.contactName || 'Valued Client'},\n\nThank you for ${thankYouMatch[1]}.\n\nI look forward to working with you.\n\nBest regards`
  }

  return params
}

function extractCalendarEventParams(instruction: string, eventData: any) {
  return {
    action: 'notify_attendees',
    eventTitle: eventData.summary,
    eventStart: eventData.start?.dateTime || eventData.start?.date,
    eventEnd: eventData.end?.dateTime || eventData.end?.date,
    attendees: eventData.attendees || [],
    description: eventData.description
  }
}

async function executeProactiveAction(context: ProactiveContext, match: InstructionMatch) {
  const { action, ...params } = match.extractedParams

  try {
    switch (action) {
      case 'create_contact_from_email':
        await handleCreateContactFromEmail(context.userId, params)
        break
      
      case 'send_welcome_email':
        await handleSendWelcomeEmail(context.userId, params)
        break
      
      case 'notify_attendees':
        await handleNotifyAttendees(context.userId, params)
        break
    }

    await prisma.activityLog.create({
      data: {
        userId: context.userId,
        action: 'proactive_action_executed',
        service: context.service,
        details: {
          instruction: match.instruction.instruction,
          action,
          params
        }
      }
    })

  } catch (error) {
    console.error('Failed to execute proactive action:', error)
    throw error
  }
}

async function handleCreateContactFromEmail(userId: string, params: any) {
  const existingContacts = await searchHubSpotContact(userId, params.email)
  
  if (existingContacts.length > 0) {
    console.log('Contact already exists, skipping creation')
    return
  }

  const contactData = {
    email: params.email,
    firstname: params.firstName,
    lastname: params.lastName
  }

  const newContact = await createHubSpotContact(userId, contactData)

  if (params.addNote && newContact.id) {
    await addHubSpotNote(userId, newContact.id, params.noteContent)
  }

  await prisma.notification.create({
    data: {
      userId,
      type: 'contact_created',
      service: 'hubspot',
      title: 'Contact Auto-Created',
      message: `Created contact ${params.firstName || params.email} from email`,
      data: {
        contactId: newContact.id,
        email: params.email,
        name: `${params.firstName || ''} ${params.lastName || ''}`.trim(),
        source: 'proactive_agent',
        triggerEmail: params.emailSubject
      }
    }
  })
}

async function handleSendWelcomeEmail(userId: string, params: any) {
  const { contactEmail, contactName, emailSubject, emailBody } = params

  await sendGmailEmail(
    userId,
    contactEmail,
    emailSubject || 'Welcome!',
    emailBody || `Dear ${contactName},\n\nThank you for connecting with us. We're excited to work with you!\n\nBest regards`
  )

  await prisma.notification.create({
    data: {
      userId,
      type: 'email_sent',
      service: 'gmail',
      title: 'Welcome Email Sent',
      message: `Sent welcome email to ${contactName} (${contactEmail})`,
      data: {
        recipient: contactEmail,
        subject: emailSubject
      }
    }
  })
}

async function handleNotifyAttendees(userId: string, params: any) {
  const { eventTitle, eventStart, attendees, description } = params

  for (const attendee of attendees) {
    if (attendee.email && attendee.email !== 'self') {
      const emailBody = `
Hello ${attendee.displayName || attendee.email},

This is a reminder about our upcoming meeting:

Title: ${eventTitle}
When: ${new Date(eventStart).toLocaleString()}
${description ? `\nDetails: ${description}` : ''}

Looking forward to meeting with you!

Best regards
      `.trim()

      await sendGmailEmail(
        userId,
        attendee.email,
        `Meeting Reminder: ${eventTitle}`,
        emailBody
      )
    }
  }

  await prisma.notification.create({
    data: {
      userId,
      type: 'meeting_notifications_sent',
      service: 'calendar',
      title: 'Meeting Notifications Sent',
      message: `Sent notifications to ${attendees.length} attendees for "${eventTitle}"`,
      data: {
        eventTitle,
        attendeeCount: attendees.length
      }
    }
  })
}

async function handleContextualResponse(context: ProactiveContext) {
  if (context.service !== 'gmail' || context.event !== 'new_email') {
    return
  }

  const emailData = context.data
  const emailContent = emailData.content || emailData.snippet || ''

  const meetingQuestionPatterns = [
    /when\s+(?:is|are)\s+(?:our|the)\s+(?:next\s+)?(?:meeting|appointment|call)/i,
    /what\s+time\s+(?:is|are)\s+(?:we|our)\s+meeting/i,
    /(?:do|did)\s+we\s+have\s+(?:a|any)\s+meeting\s+scheduled/i,
    /when\s+(?:do|did)\s+we\s+(?:meet|schedule)/i
  ]

  const isAskingAboutMeeting = meetingQuestionPatterns.some(pattern => 
    pattern.test(emailContent)
  )

  if (!isAskingAboutMeeting) {
    return
  }

  console.log('📅 Email is asking about meetings, checking calendar...')

  const senderEmail = emailData.senderEmail
  const upcomingMeetings = await searchCalendarEvents(context.userId, {
    query: senderEmail,
    timeMin: new Date().toISOString(),
    maxResults: 5
  })

  if (upcomingMeetings.length > 0) {
    const nextMeeting = upcomingMeetings[0]
    
    let meetingDateStr: string | undefined
    if (nextMeeting.start?.dateTime) {
      meetingDateStr = nextMeeting.start.dateTime
    } else if (nextMeeting.start?.date) {
      meetingDateStr = nextMeeting.start.date
    }
    
    if (!meetingDateStr) {
      console.error('Meeting has no valid start date')
      return
    }
    
    const meetingDate = new Date(meetingDateStr)
    
    const responseBody = `
Hello,

I noticed you were asking about our meeting. Here's the information:

Meeting: ${nextMeeting.summary}
Date: ${meetingDate.toLocaleDateString()}
Time: ${meetingDate.toLocaleTimeString()}
${nextMeeting.location ? `Location: ${nextMeeting.location}` : ''}
${nextMeeting.description ? `\nDetails: ${nextMeeting.description}` : ''}

${upcomingMeetings.length > 1 ? `\nWe also have ${upcomingMeetings.length - 1} other meetings scheduled.` : ''}

Let me know if you need any other information!

Best regards
    `.trim()

    await sendGmailEmail(
      context.userId,
      senderEmail,
      `Re: ${emailData.subject}`,
      responseBody,
      undefined, // cc
      undefined, // bcc
      emailData.threadId 
    )

    // Create notification
    await prisma.notification.create({
      data: {
        userId: context.userId,
        type: 'auto_response_sent',
        service: 'gmail',
        title: 'Auto-Response Sent',
        message: `Answered meeting inquiry from ${emailData.senderName || senderEmail}`,
        data: {
          recipient: senderEmail,
          meetingInfo: nextMeeting.summary,
          originalEmail: emailData.subject
        }
      }
    })
  }
}

export async function handleGmailWebhook(userId: string, emailData: any) {
  await handleProactiveEvent({
    event: 'new_email',
    service: 'gmail',
    data: emailData,
    userId
  })
}

export async function handleCalendarWebhook(userId: string, eventData: any) {
  await handleProactiveEvent({
    event: 'event_created',
    service: 'calendar',
    data: eventData,
    userId
  })
}

export async function handleHubSpotWebhook(userId: string, contactData: any) {
  await handleProactiveEvent({
    event: 'contact_created',
    service: 'hubspot',
    data: contactData,
    userId
  })
}