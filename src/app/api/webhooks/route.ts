import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { analyzeProactiveAction, embedDocument } from '@/lib/rag'
import { sendGmailEmail, createCalendarEvent } from '@/lib/google'
import { createHubSpotContact, addHubSpotNote, searchHubSpotContact } from '@/lib/hubspot'

// Webhook handler for Gmail, Calendar, and HubSpot events
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { eventType, data, userId } = body

    console.log(`Received webhook: ${eventType} for user ${userId}`)

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 })
    }

    // Process different event types
    switch (eventType) {
      case 'gmail.message_received':
        await handleGmailMessage(userId, data)
        break
      
      case 'calendar.event_created':
        await handleCalendarEvent(userId, data)
        break
      
      case 'hubspot.contact_created':
        await handleHubSpotContact(userId, data)
        break
      
      case 'hubspot.contact_updated':
        await handleHubSpotContactUpdate(userId, data)
        break
      
      default:
        console.log(`Unknown event type: ${eventType}`)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Handle incoming Gmail messages
async function handleGmailMessage(userId: string, messageData: any) {
  try {
    const { from, subject, body, messageId, threadId } = messageData

    // Extract sender email
    const senderEmail = extractEmailFromHeader(from)
    
    // Embed the email content for future RAG searches
    await embedDocument(
      userId,
      `Email: ${subject}`,
      `From: ${from}\nSubject: ${subject}\nBody: ${body}`,
      'email',
      messageId,
      {
        messageId,
        threadId,
        senderEmail,
        receivedAt: new Date().toISOString()
      }
    )

    // Get ongoing instructions
    const instructions = await prisma.ongoingInstruction.findMany({
      where: { userId, isActive: true }
    })

    // Check for proactive actions
    const proactiveAction = await analyzeProactiveAction(
      userId,
      'email_received',
      {
        from,
        subject,
        body,
        senderEmail,
        instructions: instructions.map(i => i.instruction)
      }
    )

    if (proactiveAction) {
      await executeProactiveAction(userId, proactiveAction, {
        trigger: 'email_received',
        triggerData: messageData
      })
    }

    // Check specific common scenarios
    await checkCommonEmailScenarios(userId, messageData, instructions)

  } catch (error) {
    console.error('Gmail message handling error:', error)
  }
}

// Handle calendar events
async function handleCalendarEvent(userId: string, eventData: any) {
  try {
    const { eventId, title, start, end, attendees, description } = eventData

    // Embed the calendar event
    await embedDocument(
      userId,
      `Calendar: ${title}`,
      `Event: ${title}\nStart: ${start}\nEnd: ${end}\nAttendees: ${attendees?.join(', ') || 'None'}\nDescription: ${description || ''}`,
      'calendar',
      eventId,
      {
        eventId,
        start,
        end,
        attendees,
        createdAt: new Date().toISOString()
      }
    )

    // Get ongoing instructions
    const instructions = await prisma.ongoingInstruction.findMany({
      where: { userId, isActive: true }
    })

    // Check for proactive actions
    const proactiveAction = await analyzeProactiveAction(
      userId,
      'calendar_event_created',
      {
        title,
        start,
        end,
        attendees,
        description,
        instructions: instructions.map(i => i.instruction)
      }
    )

    if (proactiveAction) {
      await executeProactiveAction(userId, proactiveAction, {
        trigger: 'calendar_event_created',
        triggerData: eventData
      })
    }

  } catch (error) {
    console.error('Calendar event handling error:', error)
  }
}

// Handle HubSpot contact creation
async function handleHubSpotContact(userId: string, contactData: any) {
  try {
    const { contactId, email, firstName, lastName, company } = contactData

    // Embed the contact information
    await embedDocument(
      userId,
      `Contact: ${firstName} ${lastName}`,
      `Name: ${firstName} ${lastName}\nEmail: ${email}\nCompany: ${company || 'N/A'}\nHubSpot ID: ${contactId}`,
      'hubspot',
      contactId,
      {
        contactId,
        email,
        firstName,
        lastName,
        company,
        createdAt: new Date().toISOString()
      }
    )

    // Get ongoing instructions
    const instructions = await prisma.ongoingInstruction.findMany({
      where: { userId, isActive: true }
    })

    // Check for proactive actions
    const proactiveAction = await analyzeProactiveAction(
      userId,
      'hubspot_contact_created',
      {
        contactId,
        email,
        firstName,
        lastName,
        company,
        instructions: instructions.map(i => i.instruction)
      }
    )

    if (proactiveAction) {
      await executeProactiveAction(userId, proactiveAction, {
        trigger: 'hubspot_contact_created',
        triggerData: contactData
      })
    }

  } catch (error) {
    console.error('HubSpot contact handling error:', error)
  }
}

// Handle HubSpot contact updates
async function handleHubSpotContactUpdate(userId: string, contactData: any) {
  try {
    const { contactId, changes } = contactData

    // Log the update
    console.log(`Contact ${contactId} updated:`, changes)

    // Could trigger additional actions based on what changed
    // For now, just log it
    
  } catch (error) {
    console.error('HubSpot contact update handling error:', error)
  }
}

// Execute proactive actions
async function executeProactiveAction(userId: string, action: any, context: any) {
  let taskId: string | null = null
  
  try {
    const { name, parameters } = action

    console.log(`Executing proactive action: ${name}`, parameters)

    // Create a task to track the proactive action
    // Fixed: Use 'context' instead of 'data' field and store as JSON
    const task = await prisma.task.create({
      data: {
        userId,
        description: `Proactive action: ${name}`,
        status: 'in_progress',
        context: { action, context } // Fixed: Use 'context' field which exists in schema
      }
    })

    taskId = task.id

    let result
    switch (name) {
      case 'send_email':
        result = await sendGmailEmail(
          userId,
          parameters.to,
          parameters.subject,
          parameters.body
        )
        break
      
      case 'create_contact':
        result = await createHubSpotContact(userId, parameters)
        break
      
      case 'add_contact_note':
        if (parameters.email) {
          const contacts = await searchHubSpotContact(userId, parameters.email)
          if (contacts.length > 0) {
            const contactId = contacts[0].id
            result = await addHubSpotNote(userId, contactId, parameters.note)
          } else {
            console.log('Contact not found for email:', parameters.email)
            result = { error: 'Contact not found' }
          }
        } else if (parameters.contactId) {
          result = await addHubSpotNote(userId, parameters.contactId, parameters.note)
        } else {
          throw new Error('Either email or contactId required for add_contact_note')
        }
        break
      
      case 'create_calendar_event':
        result = await createCalendarEvent(userId, parameters)
        break
      
      default:
        throw new Error(`Unknown proactive action: ${name}`)
    }

    // Update task status
    // Fixed: Use 'result' field as string (JSON.stringify if needed)
    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: 'completed',
        result: typeof result === 'string' ? result : JSON.stringify(result)
      }
    })

    console.log(`Proactive action completed: ${name}`)

  } catch (error: any) {
    console.error('Proactive action execution error:', error)
    
    // Update task status to failed
    if (taskId) {
      try {
        await prisma.task.update({
          where: { id: taskId },
          data: {
            status: 'failed',
            result: JSON.stringify({ error: error.message })
          }
        })
      } catch (updateError) {
        console.error('Failed to update task status:', updateError)
      }
    }
  }
}

// Check common email scenarios
async function checkCommonEmailScenarios(userId: string, messageData: any, instructions: any[]) {
  const { from, subject, body } = messageData
  const senderEmail = extractEmailFromHeader(from)

  // Scenario 1: Email from unknown sender - create HubSpot contact
  const createContactInstruction = instructions.find(i => 
    i.instruction.toLowerCase().includes('create') && 
    i.instruction.toLowerCase().includes('contact') &&
    i.instruction.toLowerCase().includes('not in hubspot')
  )

  if (createContactInstruction) {
    const existingContacts = await searchHubSpotContact(userId, senderEmail)
    
    if (existingContacts.length === 0) {
      // Extract name from email signature or sender
      const name = extractNameFromEmail(from)
      
      await executeProactiveAction(userId, {
        name: 'create_contact',
        parameters: {
          email: senderEmail,
          firstname: name.firstName, // HubSpot uses 'firstname' not 'firstName'
          lastname: name.lastName,   // HubSpot uses 'lastname' not 'lastName'
        }
      }, {
        trigger: 'unknown_sender',
        triggerData: messageData
      })

      // Add note about the email
      setTimeout(async () => {
        await executeProactiveAction(userId, {
          name: 'add_contact_note',
          parameters: {
            email: senderEmail,
            note: `Initial contact via email. Subject: ${subject}`
          }
        }, {
          trigger: 'unknown_sender_note',
          triggerData: messageData
        })
      }, 2000) // Wait 2 seconds for contact creation
    }
  }

  // Scenario 2: Meeting request - look up in calendar and respond
  if (subject.toLowerCase().includes('meeting') || 
      body.toLowerCase().includes('when is our meeting') ||
      body.toLowerCase().includes('upcoming meeting')) {
    
    await checkUpcomingMeetings(userId, senderEmail, messageData)
  }

  // Scenario 3: Stock mention - log for financial tracking
  const stockMentions = extractStockMentions(body)
  if (stockMentions.length > 0) {
    await executeProactiveAction(userId, {
      name: 'add_contact_note',
      parameters: {
        email: senderEmail,
        note: `Mentioned stocks: ${stockMentions.join(', ')} in email "${subject}"`
      }
    }, {
      trigger: 'stock_mention',
      triggerData: { messageData, stockMentions }
    })
  }
}

// Check for upcoming meetings with sender
async function checkUpcomingMeetings(userId: string, senderEmail: string, messageData: any) {
  try {
    // Search for upcoming calendar events with this attendee
    const upcomingEvents = await prisma.document.findMany({
      where: {
        userId,
        source: 'calendar',
        content: {
          contains: senderEmail,
          mode: 'insensitive'
        },
        createdAt: {
          gte: new Date() // Only future events
        }
      },
      take: 5
    })

    if (upcomingEvents.length > 0) {
      const eventDetails = upcomingEvents[0].content
      
      await executeProactiveAction(userId, {
        name: 'send_email',
        parameters: {
          to: senderEmail,
          subject: `Re: ${messageData.subject}`,
          body: `Hi! I found our upcoming meeting details:\n\n${eventDetails}\n\nLet me know if you have any questions!`
        }
      }, {
        trigger: 'meeting_inquiry_response',
        triggerData: { messageData, upcomingEvents }
      })
    }
  } catch (error) {
    console.error('Meeting check error:', error)
  }
}

// Helper functions
function extractEmailFromHeader(fromHeader: string): string {
  const emailMatch = fromHeader.match(/<(.+)>/)
  return emailMatch ? emailMatch[1] : fromHeader
}

function extractNameFromEmail(fromHeader: string): { firstName: string, lastName: string } {
  // Try to extract name from "Name <email>" format
  const nameMatch = fromHeader.match(/^(.+)\s*<.+>/)
  
  if (nameMatch) {
    const fullName = nameMatch[1].trim()
    const nameParts = fullName.split(' ')
    return {
      firstName: nameParts[0] || '',
      lastName: nameParts.slice(1).join(' ') || ''
    }
  }
  
  // Fallback to email username
  const emailMatch = fromHeader.match(/([^@]+)@/)
  const username = emailMatch ? emailMatch[1] : 'Unknown'
  
  return {
    firstName: username,
    lastName: ''
  }
}

function extractStockMentions(text: string): string[] {
  // Simple regex to find stock symbols (3-5 uppercase letters)
  const stockRegex = /\b[A-Z]{3,5}\b/g
  const matches = text.match(stockRegex) || []
  
  // Filter out common false positives
  const commonWords = ['THE', 'AND', 'FOR', 'YOU', 'ARE', 'BUT', 'NOT', 'CAN', 'ALL', 'ANY', 'HAD', 'HER', 'WAS', 'ONE', 'OUR', 'OUT', 'DAY', 'GET', 'HAS', 'HIM', 'HIS', 'HOW', 'ITS', 'MAY', 'NEW', 'NOW', 'OLD', 'SEE', 'TWO', 'WHO', 'BOY', 'DID', 'ITS', 'LET', 'PUT', 'SAY', 'SHE', 'TOO', 'USE']
  
  return matches.filter(match => !commonWords.includes(match))
}