import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { generateRAGResponse } from '@/lib/rag'
import { prisma } from '@/lib/prisma'
import { 
  sendGmailEmail, 
  createCalendarEvent, 
  getAvailableTimeSlots,
  getCalendarEvents 
} from '@/lib/google'
import { 
  searchHubSpotContact, 
  createHubSpotContact, 
  addHubSpotNote,
  getHubSpotClient, 
  getHubSpotContacts,
  getHubSpotContactNotes,
  getHubSpotContactById
} from '@/lib/hubspot'
import { handleProactiveEvent } from '@/lib/proactive-agent'

interface ExecutionLogEntry {
  tool: string;
  success: boolean;
  description: string;
  error?: string;
  data?: any;
}

interface ContactToolResult {
  contacts: any[];
  contactSummary?: string;
  contactsSummary?: string; // For get_all_contacts_with_notes
  totalCount: number;
  hasMore: boolean;
  displayedCount: number;
  contactsWithNotes?: any[];
  contactsWithoutNotes?: any[];
  notesCount?: number;
  contactsWithNotesCount?: number;
  contactsWithoutNotesCount?: number;
}

interface ToolExecutionResult {
  success: boolean;
  description: string;
  error?: string;
  data?: any;
}

interface ContactExecutionResult extends ToolExecutionResult {
  data?: ContactToolResult;
}

// UPDATED: Type guard with proper typing
function isContactToolResult(result: ExecutionLogEntry): result is ExecutionLogEntry & { data: ContactToolResult } {
  return result?.data && 
         result.success &&
         typeof result.data === 'object' &&
         ('contactSummary' in result.data || 'contactsSummary' in result.data) &&
         'hasMore' in result.data && 
         'displayedCount' in result.data && 
         'totalCount' in result.data;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { query, conversationHistory, context: requestContext } = await req.json()
    const userId = session.user.id!

    // Initialize context with defaults if not provided
    const context = requestContext || {}

    // Save user message
    await prisma.message.create({
      data: {
        userId,
        role: 'user',
        content: query,
      },
    })

    let finalResponse = ''
    let executionLog: ExecutionLogEntry[] = []
    let totalToolsExecuted = 0
    let followUp = null
    let meetings: any = []
    let response: any = {}

    try {
      const queryLower = query.toLowerCase();

      // IMPROVED: Meeting detection should come BEFORE contact detection
      const meetingKeywords = ['meeting', 'schedule', 'calendar', 'appointment', 'event', 'call']
      const isMeetingQuery = meetingKeywords.some(keyword => 
        queryLower.includes(keyword)
      ) || /find meetings with/i.test(query)

      // IMPROVED: More specific meeting scheduling detection
      const isMeetingSchedulingQuery = 
        /schedule\s+(a\s+)?meeting\s+with/i.test(query) ||
        /meet\s+with.*\s+(on|at)/i.test(query) ||
        /book\s+(a\s+)?meeting\s+with/i.test(query) ||
        (queryLower.includes('schedule') && queryLower.includes('with') && 
         (queryLower.includes('on') || queryLower.includes('at')))

      // Get meetings if it's a meeting-related query (but not scheduling)
      if (isMeetingQuery && !isMeetingSchedulingQuery) {
        meetings = await getCalendarEvents(userId, 10)
        
        // Extract attendee names for better meeting context
        const attendeeNames = meetings.flatMap((meeting: any) => 
          meeting.attendees?.map((attendee: any) => attendee.name || attendee.email)
        ).filter(Boolean)
        
        // Enhance context with meeting-specific data
        context.meetingContext = {
          recentMeetings: meetings,
          attendeeNames,
          meetingCount: meetings.length
        }
      }

      // Check for contacts with notes queries
      const isContactsWithNotesQuery = [
        'show contacts and their notes', 'contacts and notes', 'all contacts notes',
        'show all contacts notes', 'contacts with notes', 'show me all notes',
        'list all contacts notes', 'display all contacts notes',
        'show all notes for contacts', 'get notes for all contacts',
        'show all my contacts and their notes', 'can you show all my contacts and their notes'
      ].some(phrase => queryLower.includes(phrase));

      // Check for regular contact queries (without notes)
      const isRegularContactQuery = !isContactsWithNotesQuery && !isMeetingSchedulingQuery && [
        'show contacts', 'list contacts', 'get contacts', 'all contacts',
        'show all contacts', 'list all contacts', 'get all contacts',
        'display contacts', 'view contacts', 'my contacts', 'hubspot contacts',
        'show me contacts', 'show me all contacts', 'list my contacts',
        'get my contacts', 'display my contacts', 'view my contacts',
        'show my contacts'
      ].some(phrase => queryLower.includes(phrase));

      // PRIORITY 1: Handle meeting scheduling queries directly
      if (isMeetingSchedulingQuery) {
        console.log('🔍 Direct meeting scheduling query detected, going through RAG');
        
        // Let RAG handle meeting scheduling with better parsing
        response = await generateRAGResponse(userId, query, conversationHistory, context)
        finalResponse = response.content

        if (response.toolCalls?.length > 0) {
          const toolResults = await executeToolCallsSequentially(userId, response.toolCalls, query)
          executionLog = toolResults.executionLog
          totalToolsExecuted = toolResults.successCount
          
          // Handle meeting scheduling results
          if (toolResults.successCount > 0) {
            
            const meetingResult = toolResults.executionLog.find(
              (log: ExecutionLogEntry) => log.tool === 'schedule_meeting_with_contact' && log.success
            );
            
            if (meetingResult) {
              // Replace response with just the meeting confirmation
              finalResponse = `I've scheduled the meeting successfully. ${meetingResult.description}.`;
            } else {
              // Show any successful actions
              const successfulTools = toolResults.executionLog.filter((log: ExecutionLogEntry) => log.success);
              if (successfulTools.length > 0) {
                finalResponse += `\n\n✅ Successfully executed ${toolResults.successCount} action(s):\n` +
                  successfulTools.map((log: ExecutionLogEntry) => `• ${log.description}`).join('\n');
              }
            }

            const availabilityResult = toolResults.executionLog.find(
              (log: ExecutionLogEntry) => log.tool === 'get_available_times' && log.success
            );
          
            if (availabilityResult && availabilityResult.data) {
              const availabilityData = availabilityResult.data;
              
              // Replace the LLM response with formatted availability
              if (availabilityData.availabilitySummary) {
                finalResponse = availabilityData.availabilitySummary;
              } else {
                finalResponse = `I found ${availabilityData.totalSlots || 0} available time slots.`;
              }
            }
          }
          
          // Handle failures
          if (toolResults.failureCount > 0) {
            finalResponse += `\n\n❌ ${toolResults.failureCount} action(s) failed:\n` +
              toolResults.executionLog
                .filter((log: ExecutionLogEntry) => !log.success)
                .map((log: ExecutionLogEntry) => `• ${log.description}: ${log.error}`)
                .join('\n')
          }
        }
      }
      // PRIORITY 2: Handle contact queries
      else if (isContactsWithNotesQuery) {
        console.log('🔍 Direct contacts with notes query detected, executing tool directly');
        
        const toolResult = await executeGetAllContactsWithNotes(userId, {
          limit: 50,
          includeContactsWithoutNotes: queryLower.includes('all contacts')
        });

        if (toolResult.success && toolResult.data) {
          const contactData = toolResult.data as ContactToolResult;
          
          if (contactData.contacts.length === 0) {
            finalResponse = "You don't have any contacts in HubSpot yet.";
          } else {
            finalResponse = `Here are all your contacts with their notes:\n\n${contactData.contactsSummary || 'No summary available'}`;
            
            if (contactData.hasMore) {
              finalResponse += `\n\n📊 Showing ${contactData.displayedCount} of ${contactData.totalCount} total contacts.`;
              if (contactData.totalCount > contactData.displayedCount) {
                finalResponse += `\n💡 Let me know if you'd like to see more contacts.`;
              }
            }
          }
          
          executionLog = [{
            tool: 'get_all_contacts_with_notes',
            success: true,
            description: toolResult.description,
            data: toolResult.data
          }];
          totalToolsExecuted = 1;
        } else {
          finalResponse = "I'm sorry, I couldn't retrieve your contacts right now. Please try again.";
          executionLog = [{
            tool: 'get_all_contacts_with_notes',
            success: false,
            description: toolResult.description,
            error: toolResult.error
          }];
        }
      } 
      else if (isRegularContactQuery) {
        console.log('🔍 Direct contacts query detected, executing tool directly');
        
        const toolResult = await executeGetAllContacts(userId, {
          limit: 100,
          offset: 0
        });

        if (toolResult.success && toolResult.data) {
          const contactData = toolResult.data as ContactToolResult;
          
          if (contactData.contacts.length === 0) {
            finalResponse = "You don't have any contacts in HubSpot yet.";
          } else {
            finalResponse = `Here are your contacts:\n\n${contactData.contactSummary || 'No summary available'}`;
            
            if (contactData.hasMore) {
              finalResponse += `\n\n📊 Showing ${contactData.displayedCount} of ${contactData.totalCount} total contacts.`;
              if (contactData.totalCount > contactData.displayedCount) {
                finalResponse += `\n💡 Let me know if you'd like to see more contacts.`;
              }
            }
          }
          
          executionLog = [{
            tool: 'get_all_contacts',
            success: true,
            description: toolResult.description,
            data: toolResult.data
          }];
          totalToolsExecuted = 1;
        } else {
          finalResponse = "I'm sorry, I couldn't retrieve your contacts right now. Please try again.";
          executionLog = [{
            tool: 'get_all_contacts',
            success: false,
            description: toolResult.description,
            error: toolResult.error
          }];
        }
      } 
      else {
        // Generate RAG response for other queries
        response = await generateRAGResponse(userId, query, conversationHistory, context)
        finalResponse = response.content

        if (response.intent?.isConditionalInstruction) {
          await prisma.ongoingInstruction.create({
            data: {
              userId,
              instruction: query,
              isActive: true,
            }
          });
          
          response.toolCalls = [];
          console.log('📋 Stored conditional instruction:', query);
        }

        // Handle tool calls for other queries
        if (response.toolCalls?.length > 0) {
          const toolResults = await executeToolCallsSequentially(userId, response.toolCalls, query)
          executionLog = toolResults.executionLog
          totalToolsExecuted = toolResults.successCount
        
          // Handle tool execution results
          if (toolResults.successCount > 0) {

            const availabilityResult = toolResults.executionLog.find(
              (log: ExecutionLogEntry) => log.tool === 'get_available_times' && log.success
            );
          
            if (availabilityResult && availabilityResult.data) {
              const availabilityData = availabilityResult.data;
              
              // Replace the LLM response with formatted availability
              if (availabilityData.availabilitySummary) {
                finalResponse = availabilityData.availabilitySummary;
              } else {
                finalResponse = `I found ${availabilityData.totalSlots || 0} available time slots.`;
              }
            }
            
            const contactToolResult = toolResults.executionLog.find(
              (log: ExecutionLogEntry) => (log.tool === 'get_all_contacts_with_notes' || log.tool === 'get_all_contacts') && log.success
            );
          
            if (contactToolResult && isContactToolResult(contactToolResult)) {
              // Handle contact tool results (existing logic)
              const contactData = contactToolResult.data;
              
              let contactResponse = '';
              
              if (contactData.contacts.length === 0) {
                contactResponse = "You don't have any contacts in HubSpot yet.";
              } else {
                const summaryToUse = contactData.contactsSummary || contactData.contactSummary || 'No summary available';
                
                if (contactToolResult.tool === 'get_all_contacts_with_notes') {
                  contactResponse = `Here are your contacts with their notes:\n\n${summaryToUse}`;
                } else {
                  contactResponse = `Here are your contacts:\n\n${summaryToUse}`;
                }
                
                if (contactData.hasMore) {
                  contactResponse += `\n\n📊 Showing ${contactData.displayedCount} of ${contactData.totalCount} total contacts.`;
                  contactResponse += `\n💡 Let me know if you'd like to see more contacts.`;
                }
              }
              
              finalResponse = contactResponse;
            } else {
              // Handle other tool types normally
              const successfulTools = toolResults.executionLog.filter((log: ExecutionLogEntry) => log.success);
              
              const hasDetailedResponse = finalResponse.toLowerCase().includes('email sent') || 
                                         finalResponse.toLowerCase().includes('meeting scheduled') ||
                                         finalResponse.toLowerCase().includes('event created');
              
              if (!hasDetailedResponse && successfulTools.length > 0) {
                finalResponse += `\n\n✅ Successfully executed ${toolResults.successCount} action(s):\n` +
                  successfulTools
                    .map((log: ExecutionLogEntry) => `• ${log.description}`)
                    .join('\n');
              }
            }
          }
        
          // Handle failures
          if (toolResults.failureCount > 0) {
            finalResponse += `\n\n❌ ${toolResults.failureCount} action(s) failed:\n` +
              toolResults.executionLog
                .filter((log: ExecutionLogEntry) => !log.success)
                .map((log: ExecutionLogEntry) => `• ${log.description}: ${log.error}`)
                .join('\n')
          }
        
          // Refresh meetings if calendar changes were made
          if (
            toolResults.executionLog.some(
              (log: ExecutionLogEntry) =>
                ['create_calendar_event', 'schedule_meeting_with_contact'].includes(log.tool)
            )
          ) {
            meetings = await getCalendarEvents(userId, 10)
          }
        }

        // Check for follow-up actions
        followUp = await checkFollowUpActions(userId, query, response.toolCalls)
        if (followUp) {
          finalResponse += `\n\n📋 Follow-up: ${followUp.description}`
        }
      }

    } catch (error: any) {
      console.error('RAG generation error:', error)
      finalResponse = handleRAGError(error, query)
    }

    // Save assistant message
    await prisma.message.create({
      data: {
        userId,
        role: 'assistant',
        content: finalResponse,
      },
    })

    return NextResponse.json({
      response: finalResponse,
      metadata: {
        toolsExecuted: totalToolsExecuted,
        executionLog,
        hasFollowUp: followUp !== null,
        //@ts-ignore
        meetings: meetings.length > 0 ? formatMeetingsForResponse(meetings) : undefined,
        provider: response?.provider || 'direct',
        intent: response?.intent || { type: 'direct_contact_query' }
      }
    })

  } catch (error) {
    console.error('Query error:', error)
    return NextResponse.json({
      error: 'Internal server error',
      message: 'I encountered a technical error. Please try again in a moment.'
    }, { status: 500 })
  }
}

// IMPROVED: Enhanced date parsing function
function parseNaturalDate(dateString: string, timeString?: string): { start: string; end: string } | null {
  try {
    const currentYear = new Date().getFullYear();
    let parsedDate: Date;
    
    // Handle various date formats
    if (/^\d{1,2}(st|nd|rd|th)?\s+\w+$/i.test(dateString)) {
      // Handle "15th July", "15 July" format
      const cleanDate = dateString.replace(/(st|nd|rd|th)/i, '');
      parsedDate = new Date(`${cleanDate} ${currentYear}`);
      
      // If the date is in the past, use next year
      if (parsedDate < new Date()) {
        parsedDate = new Date(`${cleanDate} ${currentYear + 1}`);
      }
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      // Handle ISO format
      parsedDate = new Date(dateString);
    } else {
      // Try general parsing
      parsedDate = new Date(dateString);
    }
    
    if (isNaN(parsedDate.getTime())) {
      console.error('Invalid date:', dateString);
      return null;
    }
    
    // Parse time if provided
    let hour = 12; // Default to noon
    let minute = 0;
    
    if (timeString) {
      const timeMatch = timeString.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
      if (timeMatch) {
        hour = parseInt(timeMatch[1]);
        minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
        
        if (timeMatch[3]) {
          const ampm = timeMatch[3].toLowerCase();
          if (ampm === 'pm' && hour !== 12) {
            hour += 12;
          } else if (ampm === 'am' && hour === 12) {
            hour = 0;
          }
        }
      }
    }
    
    // Set the time
    parsedDate.setHours(hour, minute, 0, 0);
    
    const startTime = parsedDate.toISOString();
    const endTime = new Date(parsedDate.getTime() + 60 * 60 * 1000).toISOString(); // 1 hour later
    
    return { start: startTime, end: endTime };
  } catch (error) {
    console.error('Date parsing error:', error);
    return null;
  }
}

async function executeScheduleMeetingWithContact(
  userId: string, 
  parameters: any, 
  originalQuery: string
): Promise<ToolExecutionResult> {
  try {
    console.log('🚀 MEETING SCHEDULING - Parameters:', JSON.stringify(parameters, null, 2));
    console.log('🚀 MEETING SCHEDULING - Original Query:', originalQuery);
    
    // Handle both contactEmail and contactName parameters
    let contactIdentifier = parameters.contactName || parameters.contactEmail;
    
    if (!contactIdentifier) {
      return {
        success: false,
        description: `Missing contact information`,
        error: `Either contactName or contactEmail is required. Received: ${JSON.stringify(parameters)}`
      };
    }
    
    console.log('🔍 Searching for contact:', contactIdentifier);
    
    // Search for the contact
    const contacts = await searchHubSpotContact(userId, contactIdentifier);
    
    if (contacts.length === 0) {
      return {
        success: false,
        description: `Contact "${contactIdentifier}" not found in HubSpot`,
        error: `No contact found with name "${contactIdentifier}". Please check the spelling or add the contact first.`
      };
    }

    const contact = contacts[0];
    const contactEmail = contact.properties.email;
    const contactId = contact.id;
    const contactName = `${contact.properties.firstname || ''} ${contact.properties.lastname || ''}`.trim() || contactEmail;
    
    console.log('✅ Found contact:', { contactName, contactEmail });
    
    if (!contactEmail) {
      return {
        success: false,
        description: `Contact found but has no email address`,
        error: `Contact exists but doesn't have an email address on file.`
      };
    }
    
    // Handle date/time - use parameters if available, otherwise use defaults
    let eventStart: string;
    let eventEnd: string;
    
    const { title, start, end, date, time } = parameters;
    
    if (start && end) {
      eventStart = start;
      eventEnd = end;
    } else if (date && time) {
      // Parse the date and time
      const eventDate = new Date(`${date}T${time}`);
      if (isNaN(eventDate.getTime())) {
        // If parsing fails, try alternative formats
        const alternativeDate = new Date(`${date} ${time}`);
        if (isNaN(alternativeDate.getTime())) {
          console.log('⚠️ Could not parse date/time, using defaults');
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          tomorrow.setHours(14, 0, 0, 0);
          eventStart = tomorrow.toISOString();
          eventEnd = new Date(tomorrow.getTime() + 60 * 60 * 1000).toISOString();
        } else {
          eventStart = alternativeDate.toISOString();
          eventEnd = new Date(alternativeDate.getTime() + 60 * 60 * 1000).toISOString();
        }
      } else {
        eventStart = eventDate.toISOString();
        eventEnd = new Date(eventDate.getTime() + 60 * 60 * 1000).toISOString();
      }
    } else {
      // DEFAULT: Schedule for tomorrow at 2 PM if no date/time provided
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(14, 0, 0, 0);
      
      eventStart = tomorrow.toISOString();
      eventEnd = new Date(tomorrow.getTime() + 60 * 60 * 1000).toISOString();
      
      console.log('⏰ Using default date/time:', { eventStart, eventEnd });
    }
    
    const meetingTitle = title || `Meeting with ${contactName}`;
    const meetingDescription = parameters.description || 'Scheduled meeting';
    
    console.log('📅 Creating calendar event...');
    
    // Create task for tracking
    const task = await prisma.task.create({
      data: {
        userId,
        description: `Create meeting with ${contactName} (${contactEmail})`,
        status: 'in_progress',
        context: { 
          contactIdentifier,
          contactName, 
          contactEmail, 
          contactId,
          title: meetingTitle, 
          start: eventStart, 
          end: eventEnd, 
          description: meetingDescription, 
          originalQuery 
        }
      }
    });

    // Create calendar event
    const eventData = {
      summary: meetingTitle,
      description: meetingDescription,
      start: {
        dateTime: eventStart,
        timeZone: 'America/New_York',
      },
      end: {
        dateTime: eventEnd,
        timeZone: 'America/New_York',
      },
      attendees: [{ email: contactEmail }]
    };

    console.log('📅 About to call createCalendarEvent with:', JSON.stringify(eventData, null, 2));
    
    const eventResult = await createCalendarEvent(userId, eventData);
    
    console.log('✅ createCalendarEvent returned:', JSON.stringify(eventResult, null, 2));
    
    try {
      const noteContent = `Scheduled meeting: ${meetingTitle}\n` +
                         `When: ${new Date(eventStart).toLocaleString()}\n` +
                         `Description: ${meetingDescription}`;
      
      await addHubSpotNote(userId, contactId, noteContent);
      console.log('✅ Added note to HubSpot contact');
    } catch (noteError) {
      console.error('⚠️ Failed to add meeting note:', noteError);
    }
    
    // Update task
    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: 'completed',
        result: `Meeting scheduled with ${contactName} (${contactEmail}). Event ID: ${eventResult.id}`
      }
    });

    return {
      success: true,
      description: `Meeting scheduled with ${contactName} for ${new Date(eventStart).toLocaleString()}`,
      data: { 
        eventId: eventResult.id, 
        taskId: task.id, 
        contactName, 
        contactEmail,
        contactId,
        meetingTitle,
        startTime: eventStart,
        endTime: eventEnd
      }
    };
    
  } catch (error) {
    console.error('❌ MEETING SCHEDULING ERROR:', error);
    return {
      success: false,
      description: `Failed to schedule meeting`,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Update the executeGetAllContacts function to use proper typing
async function executeGetAllContacts(userId: string, parameters: any): Promise<ContactExecutionResult> {
  try {
    const { limit = 100, offset = 0 } = parameters
    
    // Get all contacts from HubSpot with enhanced function
    const result = await getHubSpotContacts(userId, { limit, offset })
    
    // Format the contacts for display
    const formattedContacts = result.contacts.map((contact: any) => ({
      id: contact.id,
      name: `${contact.properties.firstname || ''} ${contact.properties.lastname || ''}`.trim(),
      email: contact.properties.email || '',
      phone: contact.properties.phone || '',
      company: contact.properties.company || '',
      createdAt: contact.createdAt
    }))

    // Create a nicely formatted summary for the LLM to use
    const contactSummary = formattedContacts.map((contact: any, index: number) => {
      const displayName = contact.name || 'No name';
      const displayEmail = contact.email || 'No email';
      const displayCompany = contact.company || 'No company';
      const displayPhone = contact.phone || 'No phone';
      
      return `${index + 1}. ${displayName}
   📧 ${displayEmail}
   🏢 ${displayCompany}
   📞 ${displayPhone}`;
    }).join('\n\n');

    let description = `Retrieved ${formattedContacts.length} contacts from HubSpot`
    if (result.total > formattedContacts.length) {
      description += ` (${result.total} total contacts available)`
    }

    console.log('formatted contacts', formattedContacts)
    
    // Return properly typed result
    return {
      success: true,
      description,
      data: { 
        contacts: formattedContacts,
        contactSummary,
        totalCount: result.total,
        hasMore: result.hasMore,
        displayedCount: formattedContacts.length
      } as ContactToolResult
    }
  } catch (error) {
    return {
      success: false,
      description: 'Failed to retrieve HubSpot contacts',
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// Helper function to format meetings for the response
function formatMeetingsForResponse(meetings: any[]) {
  return meetings.map(meeting => ({
    id: meeting.id,
    title: meeting.summary || 'Untitled Meeting',
    start: meeting.start?.dateTime || meeting.start?.date,
    end: meeting.end?.dateTime || meeting.end?.date,
    description: meeting.description,
    attendees: meeting.attendees?.map((attendee: any) => ({
      email: attendee.email,
      name: attendee.displayName || attendee.email,
      avatar: attendee.photoUrl
    })) || [],
    metadata: meeting
  }))
}

async function executeToolCallsSequentially(
  userId: string,
  toolCalls: any[],
  originalQuery: string
): Promise<{
  executionLog: ExecutionLogEntry[];
  successCount: number;
  failureCount: number;
}> {
  const executionLog: ExecutionLogEntry[] = [];
  let successCount = 0;
  let failureCount = 0;

  // Validate toolCalls array
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    console.log('No tool calls to execute');
    return { executionLog, successCount, failureCount };
  }

  console.log(`Executing ${toolCalls.length} tool calls sequentially`);

  for (const toolCall of toolCalls) {
    try {
      // Validate tool call structure
      if (!toolCall.name) {
        console.error('Tool call missing name:', toolCall);
        failureCount++;
        executionLog.push({
          tool: 'unknown',
          success: false,
          description: 'Tool call missing name',
          error: 'Invalid tool call structure'
        });
        continue;
      }

      console.log(`Executing tool: ${toolCall.name}`);
      const result = await executeToolCall(userId, toolCall, originalQuery);
      
      if (result.success) {
        successCount++;
        executionLog.push({
          tool: toolCall.name,
          success: true,
          description: result.description,
          data: result.data
        });
      } else {
        failureCount++;
        executionLog.push({
          tool: toolCall.name,
          success: false,
          description: result.description,
          error: result.error
        });
      }
    } catch (error) {
      console.error(`Error executing tool ${toolCall.name}:`, error);
      failureCount++;
      executionLog.push({
        tool: toolCall.name || 'unknown',
        success: false,
        description: `Failed to execute ${toolCall.name || 'unknown tool'}`,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  console.log(`Tool execution completed: ${successCount} succeeded, ${failureCount} failed`);
  return { executionLog, successCount, failureCount };
}

// async function executeToolCallsSequentially(
//   userId: string,
//   toolCalls: any[],
//   originalQuery: string
// ) {
//   const executionLog: any = [];
//   let successCount = 0;
//   let failureCount = 0;

//   // Validate toolCalls array
//   if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
//     console.log('No tool calls to execute');
//     return { executionLog, successCount, failureCount };
//   }

//   console.log(`Executing ${toolCalls.length} tool calls sequentially`);

//   for (const toolCall of toolCalls) {
//     try {
//       // Validate tool call structure
//       if (!toolCall.name) {
//         console.error('Tool call missing name:', toolCall);
//         failureCount++;
//         executionLog.push({
//           tool: 'unknown',
//           success: false,
//           description: 'Tool call missing name',
//           error: 'Invalid tool call structure'
//         });
//         continue;
//       }

//       console.log(`Executing tool: ${toolCall.name}`);
//       const result = await executeToolCall(userId, toolCall, originalQuery);
      
//       if (result.success) {
//         successCount++;
//         executionLog.push({
//           tool: toolCall.name,
//           success: true,
//           description: result.description,
//           data: result.data
//         });
//       } else {
//         failureCount++;
//         executionLog.push({
//           tool: toolCall.name,
//           success: false,
//           description: result.description,
//           error: result.error
//         });
//       }
//     } catch (error) {
//       console.error(`Error executing tool ${toolCall.name}:`, error);
//       failureCount++;
//       executionLog.push({
//         tool: toolCall.name || 'unknown',
//         success: false,
//         description: `Failed to execute ${toolCall.name || 'unknown tool'}`,
//         error: error instanceof Error ? error.message : 'Unknown error'
//       });
//     }
//   }

//   console.log(`Tool execution completed: ${successCount} succeeded, ${failureCount} failed`);
//   return { executionLog, successCount, failureCount };
// }

// Execute individual tool call
async function executeToolCall(
  userId: string,
  toolCall: any,
  originalQuery: string
) {
  const { name, parameters } = toolCall;

  // Add debugging for tool call parameters
  console.log('executeToolCall called:', { name, parameters });

  // Validate that parameters exist
  if (!parameters || typeof parameters !== 'object') {
    console.error('Invalid parameters for tool call:', { name, parameters });
    return {
      success: false,
      description: `Invalid parameters for tool ${name}`,
      error: 'Tool call parameters are missing or invalid'
    };
  }

  try {
    switch (name) {
      case 'send_email':
        return await executeSendEmail(userId, parameters, originalQuery);
      
      case 'create_calendar_event':
        return await executeCreateCalendarEvent(userId, parameters, originalQuery);
      
      case 'schedule_meeting_with_contact':
        return await executeScheduleMeetingWithContact(userId, parameters, originalQuery);
      
      case 'search_contacts':
        return await executeSearchContacts(userId, parameters);
      
      case 'create_contact':
        return await executeCreateContact(userId, parameters, originalQuery);
      
      case 'add_contact_note':
        return await executeAddContactNote(userId, parameters, originalQuery);
      
      case 'get_available_times':
        return await executeGetAvailableTimes(userId, parameters);
      
      case 'get_all_contacts':
        return await executeGetAllContacts(userId, parameters);
      
      case 'get_contact_notes':
        return await executeGetContactNotes(userId, parameters);

      case 'get_all_contacts_with_notes':
        return await executeGetAllContactsWithNotes(userId, parameters);
      
      default:
        return {
          success: false,
          description: `Unknown tool: ${name}`,
          error: 'Tool not implemented'
        };
    }
  } catch (error) {
    console.error('executeToolCall error:', error);
    return {
      success: false,
      description: `Error executing ${name}`,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// async function executeGetAllContacts(userId: string, parameters: any) {
//   try {
//     const { limit = 100, offset = 0 } = parameters
    
//     // Get all contacts from HubSpot with enhanced function
//     const result = await getHubSpotContacts(userId, { limit, offset })

//     console.log('result', result)
    
//     // Format the contacts for display
//     const formattedContacts = result.contacts.map((contact: any) => ({
//       id: contact.id,
//       name: `${contact.properties.firstname || ''} ${contact.properties.lastname || ''}`.trim(),
//       email: contact.properties.email || '',
//       phone: contact.properties.phone || '',
//       company: contact.properties.company || '',
//       createdAt: contact.createdAt
//     }))

//     // Create a nicely formatted summary for the LLM to use
//     const contactSummary = formattedContacts.map((contact: any, index: number) => {
//       const displayName = contact.name || 'No name';
//       const displayEmail = contact.email || 'No email';
//       const displayCompany = contact.company || 'No company';
//       const displayPhone = contact.phone || 'No phone';
      
//       return `${index + 1}. ${displayName}
//    📧 ${displayEmail}
//    🏢 ${displayCompany}
//    📞 ${displayPhone}`;
//     }).join('\n\n');

//     let description = `Retrieved ${formattedContacts.length} contacts from HubSpot`
//     if (result.total > formattedContacts.length) {
//       description += ` (${result.total} total contacts available)`
//     }

//     console.log('formatted contacts', formattedContacts)
//     return {
//       success: true,
//       description,
//       data: { 
//         contacts: formattedContacts,
//         contactSummary, // Add this formatted summary
//         totalCount: result.total,
//         hasMore: result.hasMore,
//         displayedCount: formattedContacts.length
//       }
//     }
//   } catch (error) {
//     return {
//       success: false,
//       description: 'Failed to retrieve HubSpot contacts',
//       error: error instanceof Error ? error.message : 'Unknown error'
//     }
//   }
// }

async function executeGetAllContactsWithNotes(
  userId: string,
  parameters: GetContactsParameters
): Promise<ToolExecutionResult> {
  try {
    const { limit = 50, offset = 0, includeContactsWithoutNotes = false } = parameters;

    const contactsResult: HubSpotContactsResult = await getHubSpotContacts(userId, {
      limit,
      offset,
      properties: ['firstname', 'lastname', 'email', 'phone', 'company', 'createdate', 'lastmodifieddate']
    });

    if (contactsResult.contacts.length === 0) {
      return {
        success: true,
        description: 'No contacts found in HubSpot',
        data: {
          contacts: [],
          contactsWithNotes: [],
          contactsWithoutNotes: [],
          contactsSummary: 'No contacts found in your HubSpot account.',
          totalCount: 0,
          notesCount: 0,
          contactsWithNotesCount: 0,
          contactsWithoutNotesCount: 0,
          hasMore: false
        }
      };
    }

    const contactsWithNotes: ContactWithNotes[] = [];
    const contactsWithoutNotes: ContactWithNotes[] = [];
    let totalNotesCount = 0;

    const batchSize = 5;
    for (let i = 0; i < contactsResult.contacts.length; i += batchSize) {
      const batch = contactsResult.contacts.slice(i, i + batchSize);

      const batchPromises = batch.map(async (contact): Promise<ContactWithNotes> => {
        try {
          const notes: HubSpotNote[] = await getHubSpotContactNotes(userId, contact.id);

          const formattedNotes = notes.map((note) => ({
            id: note.id,
            content: note.properties?.hs_note_body || 'No content',
            createdAt: note.createdAt || note.properties?.createdate,
            createdBy: note.properties?.hs_created_by_user_id
          }));

          const contactData: ContactWithNotes = {
            id: contact.id,
            name: `${contact.properties.firstname || ''} ${contact.properties.lastname || ''}`.trim() || 'No Name',
            email: contact.properties.email || 'No Email',
            phone: contact.properties.phone || 'No Phone',
            company: contact.properties.company || 'No Company',
            createdAt: contact.createdAt,
            lastModified: contact.updatedAt,
            notes: formattedNotes,
            notesCount: formattedNotes.length
          };

          totalNotesCount += formattedNotes.length;

          if (formattedNotes.length > 0) {
            contactsWithNotes.push(contactData);
          } else {
            contactsWithoutNotes.push(contactData);
          }

          return contactData;
        } catch (error) {
          const contactData: ContactWithNotes = {
            id: contact.id,
            name: `${contact.properties.firstname || ''} ${contact.properties.lastname || ''}`.trim() || 'No Name',
            email: contact.properties.email || 'No Email',
            phone: contact.properties.phone || 'No Phone',
            company: contact.properties.company || 'No Company',
            createdAt: contact.createdAt,
            lastModified: contact.updatedAt,
            notes: [],
            notesCount: 0,
            notesError: 'Failed to retrieve notes'
          };

          contactsWithoutNotes.push(contactData);
          return contactData;
        }
      });

      await Promise.all(batchPromises);

      if (i + batchSize < contactsResult.contacts.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Build contacts summary
    let contactsSummary = '';
    if (contactsWithNotes.length === 0) {
      contactsSummary = `📋 **Contact Summary**\n\nYou have ${contactsResult.contacts.length} contacts, but none have notes yet.\n\n`;

      if (includeContactsWithoutNotes && contactsWithoutNotes.length > 0) {
        contactsSummary += `**Contacts without notes:**\n`;
        contactsWithoutNotes.slice(0, 10).forEach((contact, index) => {
          contactsSummary += `${index + 1}. **${contact.name}**\n   📧 ${contact.email}\n   🏢 ${contact.company}\n\n`;
        });
        if (contactsWithoutNotes.length > 10) {
          contactsSummary += `... and ${contactsWithoutNotes.length - 10} more contacts\n`;
        }
      }
    } else {
      contactsSummary = `📋 **Contacts with Notes** (${contactsWithNotes.length} of ${contactsResult.contacts.length} total contacts)\n\n`;

      contactsWithNotes.forEach((contact, index) => {
        contactsSummary += `${index + 1}. **${contact.name}**\n   📧 ${contact.email}\n   🏢 ${contact.company}\n   📝 **${contact.notesCount} note(s):**\n`;
        contact.notes.forEach((note, noteIndex) => {
          const noteDate = note.createdAt ? new Date(note.createdAt).toLocaleDateString() : 'Unknown date';
          const notePreview = note.content.length > 100 ? note.content.slice(0, 100) + '...' : note.content;
          contactsSummary += `      ${noteIndex + 1}. ${notePreview} (${noteDate})\n`;
        });
        contactsSummary += '\n';
      });

      if (includeContactsWithoutNotes && contactsWithoutNotes.length > 0) {
        contactsSummary += `\n📋 **Contacts without notes** (${contactsWithoutNotes.length}):\n`;
        contactsWithoutNotes.slice(0, 5).forEach((contact, index) => {
          contactsSummary += `${index + 1}. ${contact.name} (${contact.email})\n`;
        });
        if (contactsWithoutNotes.length > 5) {
          contactsSummary += `... and ${contactsWithoutNotes.length - 5} more\n`;
        }
      }
    }

    if (contactsResult.hasMore) {
      contactsSummary += `\n📊 Showing ${contactsResult.contacts.length} of ${contactsResult.total} total contacts.`;
      contactsSummary += `\n💡 To see more contacts, ask me to show contacts with offset.`;
    }

    return {
      success: true,
      description: `Retrieved ${contactsResult.contacts.length} contacts with ${totalNotesCount} total notes`,
      data: {
        contacts: includeContactsWithoutNotes
          ? [...contactsWithNotes, ...contactsWithoutNotes]
          : contactsWithNotes,
        contactsWithNotes,
        contactsWithoutNotes,
        contactsSummary,
        totalCount: contactsResult.contacts.length,
        notesCount: totalNotesCount,
        contactsWithNotesCount: contactsWithNotes.length,
        contactsWithoutNotesCount: contactsWithoutNotes.length,
        hasMore: contactsResult.hasMore
      }
    };

  } catch (error) {
    return {
      success: false,
      description: 'Failed to retrieve contacts with notes',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}


async function executeGetContactNotes(userId: string, parameters: any): Promise<ToolExecutionResult> {
  try {
    const { contactId, email, contactName } = parameters;
    let contact;
    
    if (contactId) {
      contact = await getHubSpotContactById(userId, contactId);
    } else if (email || contactName) {
      // Search for contact
      const searchQuery = email || contactName;
      const contacts = await searchHubSpotContact(userId, searchQuery);
      
      if (contacts.length === 0) {
        return {
          success: false,
          description: `Contact not found: ${searchQuery}`,
          error: `No contact found with identifier "${searchQuery}"`
        };
      }
      
      contact = contacts[0];
    } else {
      return {
        success: false,
        description: 'Missing contact identifier',
        error: 'Please provide contactId, email, or contactName'
      };
    }

    if (!contact) {
      return {
        success: false,
        description: 'Contact not found',
        error: 'Could not retrieve contact information'
      };
    }

    const notes = await getHubSpotContactNotes(userId, contact.id);
    
    // Format contact details
    const contactDetails = {
      id: contact.id,
      name: `${contact.properties.firstname || ''} ${contact.properties.lastname || ''}`.trim(),
      email: contact.properties.email || '',
      phone: contact.properties.phone || '',
      company: contact.properties.company || '',
      createdAt: contact.createdAt,
      lastModified: contact.updatedAt,
      notes: notes.map((note: any) => ({
        id: note.id,
        content: note.properties.hs_note_body,
        createdAt: note.createdAt,
        createdBy: note.properties.hs_created_by_user_id
      }))
    };

    const contactSummary = `📋 Contact Details:
👤 Name: ${contactDetails.name || 'No name'}
📧 Email: ${contactDetails.email || 'No email'}
📞 Phone: ${contactDetails.phone || 'No phone'}
🏢 Company: ${contactDetails.company || 'No company'}
📅 Created: ${new Date(contactDetails.createdAt).toLocaleDateString()}

📝 Notes (${contactDetails.notes.length}):
${contactDetails.notes.length === 0 
  ? 'No notes found for this contact.' 
  : contactDetails.notes.map((note: any, index: number) => 
      `${index + 1}. ${note.content} (${new Date(note.createdAt).toLocaleDateString()})`
    ).join('\n')
}`;

    return {
      success: true,
      description: `Retrieved details and ${notes.length} notes for ${contactDetails.name || contactDetails.email}`,
      data: {
        contact: contactDetails,
        contactSummary,
        notesCount: notes.length
      }
    };
    
  } catch (error) {
    return {
      success: false,
      description: 'Failed to retrieve contact notes',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function executeSendEmail(userId: string, parameters: any, originalQuery: string) {
  try {
    console.log('executeSendEmail called with parameters:', parameters);
    
    let { to, subject, body, cc, bcc, contactName } = parameters;
    
    // If contactName is provided instead of 'to', resolve it
    if (!to && contactName) {
      console.log(`Resolving contact name: ${contactName}`);
      const contacts = await searchHubSpotContact(userId, contactName);
      
      if (contacts.length === 0) {
        return {
          success: false,
          description: `Contact "${contactName}" not found in HubSpot`,
          error: `No contact found with name "${contactName}". Please check the spelling or add the contact first.`
        };
      }
      
      // Use the first matching contact's email
      to = contacts[0].properties.email;
      
      if (!to) {
        return {
          success: false,
          description: `Contact "${contactName}" found but has no email address`,
          error: `Contact "${contactName}" exists but doesn't have an email address on file.`
        };
      }
      
      console.log(`Resolved ${contactName} to email: ${to}`);
    }
    
    // Validate required parameters
    if (!to) {
      console.error('Missing "to" parameter in email execution');
      return {
        success: false,
        description: 'Failed to send email: recipient email address is required',
        error: 'Missing "to" parameter - recipient email address is required'
      };
    }
    
    if (!subject) {
      console.error('Missing "subject" parameter in email execution');
      return {
        success: false,
        description: 'Failed to send email: subject is required',
        error: 'Missing "subject" parameter - email subject is required'
      };
    }
    
    if (!body) {
      console.error('Missing "body" parameter in email execution');
      return {
        success: false,
        description: 'Failed to send email: email body is required',
        error: 'Missing "body" parameter - email body is required'
      };
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      return {
        success: false,
        description: `Failed to send email: invalid email format "${to}"`,
        error: `Invalid email format: "${to}"`
      };
    }
    
    // Create task for tracking
    const task = await prisma.task.create({
      data: {
        userId,
        description: `Send email to ${to} - ${subject}`,
        status: 'in_progress',
        context: { to, subject, body, cc, bcc, originalQuery, contactName }
      }
    });

    // Send email via Gmail API (this will use the logged-in user's Gmail account)
    const result = await sendGmailEmail(userId, to, subject, body, cc, bcc);

    console.log('Email sent successfully:', result);

    if (result.id) {
      handleProactiveEvent({
        event: 'email_sent',
        service: 'gmail',
        data: {
          messageId: result.id,
          to,
          subject,
          body,
          contactName,
          timestamp: new Date().toISOString()
        },
        userId
      }).catch(console.error);
    }
    
    // Update task status
    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: 'completed',
        result: `Email sent successfully. Message ID: ${result.id}`
      }
    });

    return {
      success: true,
      description: `Email sent to ${contactName ? `${contactName} (${to})` : to}`,
      data: { messageId: result.id, taskId: task.id, to, contactName }
    };
  } catch (error) {
    console.error('executeSendEmail error:', error);
    
    // Update task to failed status if task was created
    try {
      await prisma.task.updateMany({
        where: {
          userId,
          description: { contains: parameters.to ? `Send email to ${parameters.to}` : 'Send email' },
          status: 'in_progress'
        },
        data: {
          status: 'failed',
          result: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    } catch (taskError) {
      console.error('Failed to update task status:', taskError);
    }

    return {
      success: false,
      description: `Failed to send email${parameters.to ? ` to ${parameters.to}` : ''}`,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function executeCreateCalendarEvent(userId: string, parameters: any, originalQuery: string) {
  try {
    // Handle both 'title' and 'summary' parameters for backward compatibility
    const title = parameters.title || parameters.summary;
    const { start, end, description, attendees, location, date, time, attendee } = parameters;
    
    if (!title) {
      throw new Error('Event title/summary is required');
    }
    
    // Handle different date/time formats
    let eventStart: string;
    let eventEnd: string;
    
    if (start && end) {
      // Use provided start/end times
      eventStart = start;
      eventEnd = end;
    } else if (date && time) {
      // Convert date + time format
      const eventDate = new Date(`${date}T${time}`);
      eventStart = eventDate.toISOString();
      // Default to 1 hour duration if no end time specified
      eventEnd = new Date(eventDate.getTime() + 60 * 60 * 1000).toISOString();
    } else {
      throw new Error('Event start time is required (either start/end or date/time)');
    }
    
    // Handle attendees - could be single attendee or array
    let eventAttendees: string[] = [];
    if (attendees) {
      eventAttendees = Array.isArray(attendees) ? attendees : [attendees];
    } else if (attendee) {
      eventAttendees = [attendee];
    }
    
    // Create task for tracking
    const task = await prisma.task.create({
      data: {
        userId,
        description: `Create calendar event: ${title}`,
        status: 'in_progress',
        context: { title, start: eventStart, end: eventEnd, description, attendees: eventAttendees, location, originalQuery }
      }
    });

    // Create calendar event via Google Calendar API
    const eventData = {
      summary: title, // Google Calendar uses 'summary' for the event title
      description,
      location,
      start: {
        dateTime: eventStart,
        timeZone: 'America/New_York',
      },
      end: {
        dateTime: eventEnd,
        timeZone: 'America/New_York',
      },
      attendees: eventAttendees.map((email: string) => ({ email }))
    };

    const result = await createCalendarEvent(userId, eventData);

    if (result) {
      // Don't await - run in background
      handleProactiveEvent({
        event: 'event_created',
        service: 'calendar',
        data: result,
        userId
      }).catch(console.error)
    }
    // Update task status
    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: 'completed',
        result: `Calendar event created successfully. Event ID: ${result.id}`
      }
    });

    return {
      success: true,
      description: `Calendar event created: ${title}`,
      data: { eventId: result.id, taskId: task.id }
    };
  } catch (error) {
    // Update task to failed status
    const title = parameters.title || parameters.summary || 'Unknown Event';
    await prisma.task.updateMany({
      where: {
        userId,
        description: { contains: `Create calendar event: ${title}` },
        status: 'in_progress'
      },
      data: {
        status: 'failed',
        result: error instanceof Error ? error.message : 'Unknown error'
      }
    });

    return {
      success: false,
      description: `Failed to create calendar event: ${title}`,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function executeSearchContacts(userId: string, parameters: any) {
  try {
    const { query, email, name } = parameters
    
    let hubspotResults = []
    let searchQuery = query || email || name

    // Search in HubSpot using the correct function signature
    if (searchQuery) {
      hubspotResults = await searchHubSpotContact(userId, searchQuery)
    }
    
    // Also search in local database/email data
    const localResults = await prisma.document.findMany({
      where: {
        userId,
        OR: [
          { content: { contains: searchQuery, mode: 'insensitive' } },
          { title: { contains: searchQuery, mode: 'insensitive' } }
        ]
      },
      take: 10
    })

    return {
      success: true,
      description: `Found ${hubspotResults.length} HubSpot contacts and ${localResults.length} local references`,
      data: { hubspotResults, localResults }
    }
  } catch (error) {
    return {
      success: false,
      description: 'Failed to search contacts',
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

async function executeCreateContact(userId: string, parameters: any, originalQuery: string) {
  try {
    const { email, firstName, lastName, company, phone, notes } = parameters
    
    // Create task for tracking
    const task = await prisma.task.create({
      data: {
        userId,
        description: `Create contact: ${firstName} ${lastName} (${email})`,
        status: 'in_progress',
        context: { email, firstName, lastName, company, phone, notes, originalQuery }
      }
    })

    // Create contact in HubSpot using the correct function signature
    const contactData = {
      email,
      firstname: firstName,
      lastname: lastName,
      company,
      phone
    }

    const result = await createHubSpotContact(userId, contactData)

    // Add initial note if provided
    if (notes && result.id) {
      await addHubSpotNote(userId, result.id, notes)
    }

    // Update task status
    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: 'completed',
        result: `Contact created successfully. Contact ID: ${result.id}`
      }
    })

    return {
      success: true,
      description: `Contact created: ${firstName} ${lastName}`,
      data: { contactId: result.id, taskId: task.id }
    }
  } catch (error) {
    // Update task to failed status
    await prisma.task.updateMany({
      where: {
        userId,
        description: { contains: `Create contact: ${parameters.firstName} ${parameters.lastName}` },
        status: 'in_progress'
      },
      data: {
        status: 'failed',
        result: error instanceof Error ? error.message : 'Unknown error'
      }
    })

    return {
      success: false,
      description: `Failed to create contact: ${parameters.firstName} ${parameters.lastName}`,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

async function executeAddContactNote(userId: string, parameters: any, originalQuery: string) {
  try {
    const { contactId, email, note } = parameters
    
    // Create task for tracking
    const task = await prisma.task.create({
      data: {
        userId,
        description: `Add note to contact`,
        status: 'in_progress',
        context: { contactId, email, note, originalQuery }
      }
    })

    let result
    if (contactId) {
      result = await addHubSpotNote(userId, contactId, note)
    } else if (email) {
      // Search for contact by email first
      const contacts = await searchHubSpotContact(userId, email)
      if (contacts.length > 0) {
        result = await addHubSpotNote(userId, contacts[0].id, note)
      } else {
        throw new Error('Contact not found')
      }
    } else {
      throw new Error('No contact identifier provided')
    }

    // Update task status
    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: 'completed',
        result: `Note added successfully. Note ID: ${result.id}`
      }
    })

    return {
      success: true,
      description: 'Note added to contact',
      data: { noteId: result.id, taskId: task.id }
    }
  } catch (error) {
    // Update task to failed status
    await prisma.task.updateMany({
      where: {
        userId,
        description: 'Add note to contact',
        status: 'in_progress'
      },
      data: {
        status: 'failed',
        result: error instanceof Error ? error.message : 'Unknown error'
      }
    })

    return {
      success: false,
      description: 'Failed to add contact note',
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

async function executeGetAvailableTimes(userId: string, parameters: any) {
  try {
    console.log('🕐 Getting available times with parameters:', parameters);
    
    const { date, startDate, endDate, duration = 60, workingHours } = parameters;
    
    // Parse the date parameter if provided
    let targetDate = null;
    if (date) {
      // Handle different date formats
      if (date.toLowerCase() === 'today') {
        targetDate = new Date();
      } else if (date.toLowerCase() === 'tomorrow') {
        targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + 1);
      } else if (/^\d{1,2}(st|nd|rd|th)?\s+\w+(\s+\d{4})?$/i.test(date)) {
        // Handle "16th July" or "16th July 2025" format
        const cleanDate = date.replace(/(st|nd|rd|th)/i, '');
        const currentYear = new Date().getFullYear();
        targetDate = new Date(`${cleanDate} ${currentYear}`);
        
        // If date is in the past, use next year
        if (targetDate < new Date()) {
          targetDate = new Date(`${cleanDate} ${currentYear + 1}`);
        }
      } else {
        // Try general parsing
        targetDate = new Date(date);
      }
      
      if (isNaN(targetDate?.getTime())) {
        targetDate = null;
      }
    }
    
    console.log('📅 Target date parsed:', targetDate);
    
    // Get available time slots from Google Calendar
    const availableSlots = await getAvailableTimeSlots(userId, duration);
    
    console.log('🕐 Raw available slots:', availableSlots);
    
    // Filter slots for the specific date if provided
    let filteredSlots = availableSlots;
    if (targetDate) {
      const targetDateStr = targetDate.toISOString().split('T')[0]; // YYYY-MM-DD format
      filteredSlots = availableSlots.filter((slot: any) => {
        const slotDate = new Date(slot.start || slot.startTime);
        const slotDateStr = slotDate.toISOString().split('T')[0];
        return slotDateStr === targetDateStr;
      });
    }
    
    // Format the availability response
    const formattedAvailability = formatAvailabilityResponse(filteredSlots, targetDate, date);
    
    return {
      success: true,
      description: `Found ${filteredSlots.length} available time slots${targetDate ? ` for ${date}` : ''}`,
      data: { 
        availableSlots: filteredSlots,
        availabilitySummary: formattedAvailability,
        requestedDate: date,
        parsedDate: targetDate,
        totalSlots: filteredSlots.length
      }
    };
  } catch (error) {
    console.error('❌ Error getting available times:', error);
    return {
      success: false,
      description: 'Failed to get available times',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// NEW: Function to format availability response nicely
function formatAvailabilityResponse(slots: any[], targetDate?: Date | null, originalDate?: string): string {
  if (!slots || slots.length === 0) {
    if (targetDate) {
      const dateStr = targetDate.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
      return `❌ **No availability found for ${originalDate || dateStr}**\n\nYou appear to be fully booked on this date. Consider checking adjacent dates or shorter time slots.`;
    } else {
      return `❌ **No availability found**\n\nYour calendar appears to be fully booked. Consider checking specific dates or shorter time slots.`;
    }
  }

  let response = '';
  
  // Add header
  if (targetDate) {
    const dateStr = targetDate.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
    response += `📅 **Your availability for ${originalDate || dateStr}**\n\n`;
  } else {
    response += `📅 **Your upcoming availability**\n\n`;
  }

  // Group slots by date
  const slotsByDate = groupSlotsByDate(slots);
  
  // Format each date group
  Object.entries(slotsByDate).forEach(([dateKey, dateSlots]) => {
    const date = new Date(dateKey);
    const dateStr = date.toLocaleDateString('en-US', { 
      weekday: 'long', 
      month: 'short', 
      day: 'numeric' 
    });
    
    response += `**${dateStr}:**\n`;
    
    // Sort slots by time
    const sortedSlots = (dateSlots as any[]).sort((a, b) => {
      const timeA = new Date(a.start || a.startTime);
      const timeB = new Date(b.start || b.startTime);
      return timeA.getTime() - timeB.getTime();
    });
    
    // Format time slots
    sortedSlots.forEach((slot, index) => {
      const startTime = new Date(slot.start || slot.startTime);
      const endTime = new Date(slot.end || slot.endTime);
      
      const startTimeStr = startTime.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      });
      
      const endTimeStr = endTime.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      });
      
      const duration = Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60)); // minutes
      
      response += `   ${index + 1}. ${startTimeStr} - ${endTimeStr} (${duration} min)\n`;
    });
    
    response += '\n';
  });
  
  // Add summary
  const totalSlots = slots.length;
  const totalDuration = slots.reduce((total, slot) => {
    const start = new Date(slot.start || slot.startTime);
    const end = new Date(slot.end || slot.endTime);
    return total + (end.getTime() - start.getTime()) / (1000 * 60); // minutes
  }, 0);
  
  response += `📊 **Summary:** ${totalSlots} available slot${totalSlots !== 1 ? 's' : ''} totaling ${Math.round(totalDuration)} minutes\n`;
  response += `💡 Ready to schedule a meeting? Just let me know your preferred time!`;
  
  return response;
}

// Helper function to group slots by date
function groupSlotsByDate(slots: any[]): Record<string, any[]> {
  const grouped: Record<string, any[]> = {};
  
  slots.forEach(slot => {
    const date = new Date(slot.start || slot.startTime);
    const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
    
    if (!grouped[dateKey]) {
      grouped[dateKey] = [];
    }
    grouped[dateKey].push(slot);
  });
  
  return grouped;
}


// Check for follow-up actions that might be needed
async function checkFollowUpActions(userId: string, originalQuery: string, toolCalls: any[]) {
  try {
    // Check if any tool calls created tasks that need follow-up
    const pendingTasks = await prisma.task.findMany({
      where: {
        userId,
        status: 'pending',
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } // Last hour
      }
    })

    if (pendingTasks.length > 0) {
      return {
        description: `${pendingTasks.length} tasks awaiting completion`,
        tasks: pendingTasks
      }
    }

    return null
  } catch (error) {
    console.error('Follow-up check failed:', error)
    return null
  }
}

// Handle RAG errors gracefully
function handleRAGError(error: any, query: string): string {
  console.error('RAG Error:', error)
  
  if (error.message?.includes('rate limit')) {
    return "I'm currently experiencing high demand. Please try your request again in a moment."
  }
  
  if (error.message?.includes('context')) {
    return "I'm having trouble accessing the relevant information right now. Could you please rephrase your question or be more specific?"
  }
  
  return "I apologize, but I encountered an error processing your request. Please try again or contact support if the issue persists."
}