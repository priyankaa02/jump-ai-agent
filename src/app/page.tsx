'use client'

import { useSession, signIn, signOut } from 'next-auth/react'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ChatInterface } from '@/components/chat/chat-interface'
import { HubSpotConnection } from '@/components/hubspot-connection'
import { DataSync } from '@/components/data-sync'
import WebhookSettings from '@/components/webhook-settings'
import NotificationCenter from '@/components/notification-center'
import InstructionManager from '@/components/instruction-manager'
import { useWebhookUpdates } from '@/hooks/useWebhooks'
import { toast } from 'react-hot-toast'
import { Separator } from '@/components/ui/separator'

export default function Home() {
  const { data: session, status } = useSession()
  const [hubspotConnected, setHubspotConnected] = useState(false)

  useEffect(() => {
    if (session?.user?.email) {
      checkHubSpotConnection()
    }
  }, [session])

  // Listen for webhook updates
  useWebhookUpdates((data) => {
    console.log('Webhook update received:', data)
    
    // Show notification based on service
    switch (data.service) {
      case 'gmail':
        toast('New email received!', { icon: '📧' })
        break
      case 'calendar':
        toast('Calendar updated', { icon: '📅' })
        break
      case 'hubspot':
        toast('CRM update received', { icon: '🤝' })
        break
    }
  })

  const checkHubSpotConnection = async () => {
    try {
      const response = await fetch('/api/user')
      const userData = await response.json()
      setHubspotConnected(!!userData.hubspotAccessToken)
    } catch (error) {
      console.error('Error checking HubSpot connection:', error)
    }
  }

  if (status === 'loading') {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Card className="w-96">
          <CardHeader>
            <CardTitle>Financial Advisor AI Agent</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-4">
              Connect your Gmail, Calendar, and HubSpot to get started with your AI assistant.
            </p>
            <Button onClick={() => signIn('google')} className="w-full cursor-pointer">
              Sign in with Google
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <h1 className="text-2xl font-bold text-gray-900">Financial Advisor AI</h1>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">
                {session.user?.email}
              </span>
              <NotificationCenter />
              <div className="h-6 w-px bg-gray-300" />
              <Button variant="outline" onClick={() => signOut()}>
                Sign out
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs defaultValue="chat" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="instructions">Instructions</TabsTrigger>
            <TabsTrigger value="connections">Connections</TabsTrigger>
            <TabsTrigger value="data">Data Sync</TabsTrigger>
          </TabsList>

          <TabsContent value="chat" className="mt-6">
            <ChatInterface />
          </TabsContent>

          <TabsContent value="instructions" className="mt-6">
            <InstructionManager />
          </TabsContent>

          <TabsContent value="connections" className="mt-6 space-y-6">
            {/* Service Connections Section */}
            <div>
              <h2 className="text-xl font-semibold mb-4">Service Connections</h2>
              <div className="grid gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Google Integration</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      <span>Connected - Gmail and Calendar access enabled</span>
                    </div>
                  </CardContent>
                </Card>

                <HubSpotConnection 
                  onConnectionChange={setHubspotConnected}
                  isConnected={hubspotConnected}
                />
              </div>
            </div>

            <Separator className="my-8" />

            {/* Real-time Sync Section */}
            <div>
              <h2 className="text-xl font-semibold mb-2">Real-time Synchronization</h2>
              <p className="text-gray-600 mb-6">
                Enable webhooks to receive instant updates when your data changes
              </p>
              <WebhookSettings />
            </div>
          </TabsContent>

          <TabsContent value="data" className="mt-6">
            <DataSync hubspotConnected={hubspotConnected} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}