import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getCalendarEvents } from '@/lib/google'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const events = await getCalendarEvents(session.user.id, 50)
    
    const meetings = events.map(event => ({
      id: event.id,
      title: event.summary || 'Untitled Meeting',
      start: event.start?.dateTime || event.start?.date,
      end: event.end?.dateTime || event.end?.date,
      description: event.description,
      attendees: event.attendees?.map(attendee => ({
        email: attendee.email,
        name: attendee.displayName || attendee.email,
        avatar: (attendee as any).photoUrl,
      })) || [],
      metadata: event
    }))

    return NextResponse.json(meetings)
  } catch (error) {
    console.error('Error fetching meetings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch meetings' },
      { status: 500 }
    )
  }
}