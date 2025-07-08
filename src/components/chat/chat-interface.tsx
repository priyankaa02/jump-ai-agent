'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Send, User, Bot, Loader2, Calendar, History, Clock, Users, MapPin, Video, Phone } from 'lucide-react'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
  metadata?: any
}

interface Meeting {
  id: string
  title: string
  start: string
  end: string
  status: string
  type: string
  location: string
  attendees: Array<{
    email: string
    name: string
    avatar?: string
  }>
  description?: string
}

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'system-1',
      role: 'system',
      content: "I am your assistant. How can I help you ?",
      createdAt: new Date().toISOString()
    }
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('chat')
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messageIdCounter = useRef(0)

  useEffect(() => {
    loadInitialData()
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const loadInitialData = async () => {
    try {
      const meetingsRes = await fetch('/api/meetings')
      const meetingsData = await meetingsRes.json()
      setMeetings(meetingsData)
      
      const messagesRes = await fetch('/api/messages')
      const messagesData = await messagesRes.json()
      setMessages(prev => [...prev, ...messagesData])
    } catch (error) {
      console.error('Error loading initial data:', error)
    }
  }

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage = input.trim()
    setInput('')
    setIsLoading(true)

    const newUserMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userMessage,
      createdAt: new Date().toISOString(),
    }
    setMessages(prev => [...prev, newUserMessage])

    try {
      const response = await fetch('/api/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: userMessage,
          conversationHistory: messages.slice(-10).map(m => ({
            role: m.role,
            content: m.content,
          })),
        }),
      })

      const data = await response.json()
      
      if (data.response) {
        const assistantMessage: Message = {
          id: `assistant-${Date.now()}-${++messageIdCounter.current}`,
          role: 'assistant',
          content: data.response,
          createdAt: new Date().toISOString(),
          metadata: data.metadata
        }
        setMessages(prev => [...prev, assistantMessage])
        
        if (data.metadata?.meetings) {
          setMeetings(data.metadata.meetings)
        }
      }
    } catch (error) {
      console.error('Error sending message:', error)
      const errorMessage: Message = {
        id: `error-${Date.now()}-${++messageIdCounter.current}`,
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your request.',
        createdAt: new Date().toISOString(),
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const clearChat = async () => {
    try {
      await fetch('/api/messages', { method: 'DELETE' })
      setMessages([{
        id: 'system-1',
        role: 'system',
        content: "I am your assistant. How can I help you ?",
        createdAt: new Date().toISOString()
      }])
    } catch (error) {
      console.error('Error clearing chat:', error)
    }
  }

  const handleMeetingAction = async (action: string, meetingId: string) => {
    setIsLoading(true)
    try {
      let query = ''
      switch (action) {
        case 'summarize':
          query = `Summarize meeting ${meetingId}`
          break
        case 'followup':
          query = `Schedule a follow up for meeting ${meetingId}`
          break
        case 'details':
          query = `Show details for meeting ${meetingId}`
          break
      }

      const response = await fetch('/api/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          conversationHistory: messages.slice(-10).map(m => ({
            role: m.role,
            content: m.content,
          })),
        }),
      })

      const data = await response.json()
      if (data.response) {
        const assistantMessage: Message = {
          id: `assistant-${Date.now()}-${++messageIdCounter.current}`,
          role: 'assistant',
          content: data.response,
          createdAt: new Date().toISOString(),
          metadata: data.metadata
        }
        setMessages(prev => [...prev, assistantMessage])
      }
    } catch (error) {
      console.error('Error handling meeting action:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'upcoming': return 'bg-blue-100 text-blue-800'
      case 'ongoing': return 'bg-green-100 text-green-800'
      case 'completed': return 'bg-gray-100 text-gray-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'video': return <Video className="w-4 h-4" />
      case 'phone': return <Phone className="w-4 h-4" />
      case 'in-person': return <MapPin className="w-4 h-4" />
      default: return <Calendar className="w-4 h-4" />
    }
  }


  const MeetingCard = ({ meeting }: { meeting: Meeting }) => (
    <Card className="hover:shadow-md transition-shadow duration-200 border-l-4 border-l-blue-500">
      <CardContent className="p-6">
        <div className="flex justify-between items-start mb-4">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">{meeting.title}</h3>
            <div className="flex items-center gap-4 text-sm text-gray-600">
              <div className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {formatTime(meeting.start)} - {formatTime(meeting.end)}
              </div>
              <div className="flex items-center gap-1">
                {getTypeIcon(meeting.type || 'video')}
                {meeting.location || 'Online'}
              </div>
            </div>
          </div>
          <Badge className={`${getStatusColor(meeting.status || 'upcoming')} border-0`}>
            {meeting.status || 'upcoming'}
          </Badge>
        </div>

        {meeting.description && (
          <p className="text-sm text-gray-600 mb-4">{meeting.description}</p>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-gray-500" />
            <div className="flex -space-x-2">
              {meeting.attendees.slice(0, 4).map((attendee, index) => (
                <Avatar key={index} className="w-8 h-8 border-2 border-white">
                  <AvatarImage src={attendee.avatar} />
                  <AvatarFallback className="text-xs bg-gradient-to-br from-blue-500 to-purple-600 text-white">
                    {attendee.name?.charAt(0) || attendee.email?.charAt(0)}
                  </AvatarFallback>
                </Avatar>
              ))}
              {meeting.attendees.length > 4 && (
                <div className="w-8 h-8 rounded-full bg-gray-200 border-2 border-white flex items-center justify-center">
                  <span className="text-xs font-medium text-gray-600">
                    +{meeting.attendees.length - 4}
                  </span>
                </div>
              )}
            </div>
            <span className="text-sm text-gray-500 ml-2">
              {meeting.attendees.length} attendee{meeting.attendees.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )


  return (
    <div className="h-[600px] flex flex-col bg-white border rounded-lg">
      <div className="p-4 border-b flex flex-row items-center justify-between bg-white rounded-t-lg">
        <h2 className="text-lg font-semibold">Ask Anything</h2>
        <Button variant="ghost" size="sm" onClick={clearChat}>
          <History className="w-4 h-4 mr-2" />
          New Thread
        </Button>
      </div>
      
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="rounded-none border-b bg-gray-50 px-4 flex-shrink-0">
          <TabsTrigger value="chat" className="flex items-center gap-2">
            <Bot className="w-4 h-4" /> Chat
          </TabsTrigger>
          <TabsTrigger value="meetings" className="flex items-center gap-2">
            <Calendar className="w-4 h-4" /> Meetings
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="chat" className="flex-1 flex flex-col min-h-0 m-0">
          <div className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-4">
                {messages.map((message, index) => (
                  <div
                     key={`${message.id}-${index}`}
                    className={`flex ${
                      message.role === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg p-3 shadow-sm ${
                        message.role === 'user'
                          ? 'bg-blue-500 text-white ml-4'
                          : 'bg-gray-100 text-gray-900 mr-4'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-shrink-0 mt-0.5">
                          {message.role === 'user' ? (
                            <User className="w-4 h-4" />
                          ) : (
                            <Bot className="w-4 h-4" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
                          {message.metadata?.meetings && (
                            <div className="mt-2 space-y-2">
                              {message.metadata.meetings.map((meeting: Meeting, index: number) => (
                                <div key={`msg-${message.id}-meeting-${meeting.id}-${index}`}>
                                  <MeetingCard meeting={meeting} />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="bg-gray-100 rounded-lg p-3 shadow-sm mr-4">
                      <div className="flex items-center gap-2">
                        <Bot className="w-4 h-4 text-gray-600" />
                        <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                        <span className="text-sm text-gray-600">Thinking...</span>
                      </div>
                    </div>
                  </div>
                )}
                
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>
          </div>
        </TabsContent>
        
        <TabsContent value="meetings" className="flex-1 flex flex-col min-h-0 m-0">
          <div className="flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="p-4 space-y-4">
                {meetings.length === 0 ? (
                  <div className="text-center text-gray-500 py-8">
                    <Calendar className="mx-auto w-12 h-12 mb-4 text-gray-400" />
                    <p>No meetings found</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {meetings.map((meeting, index) => (
                      <div key={`tab-meeting-${meeting.id}-${index}`}>
                        <MeetingCard meeting={meeting} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </TabsContent>
      </Tabs>
      
      {activeTab === 'chat' && (
  <div className="p-4 border-t bg-gray-50 flex-shrink-0">
    <div className="flex gap-2">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            sendMessage(e)
          }
        }}
        placeholder="How can I help you today?"
        className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        disabled={isLoading}
      />
      <Button 
        onClick={sendMessage}
        disabled={isLoading || !input.trim()}
      >
        <Send className="w-4 h-4" />
      </Button>
    </div>
  </div>)}
    </div>
  )
}