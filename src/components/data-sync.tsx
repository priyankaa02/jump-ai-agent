'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  RefreshCw, 
  Calendar, 
  Mail, 
  Users, 
  CheckCircle, 
  AlertCircle,
  Clock,
  Download,
  Database
} from 'lucide-react'

interface DataSyncProps {
  hubspotConnected: boolean
}

interface SyncStatus {
  gmail: {
    lastSync: string | null
    status: 'idle' | 'syncing' | 'success' | 'error'
    count: number
    error?: string
  }
  hubspot: {
    lastSync: string | null
    status: 'idle' | 'syncing' | 'success' | 'error'
    count: number
    error?: string
  }
}

export function DataSync({ hubspotConnected }: DataSyncProps) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    gmail: { lastSync: null, status: 'idle', count: 0 },
    hubspot: { lastSync: null, status: 'idle', count: 0 }
  })
  const [syncProgress, setSyncProgress] = useState(0)
  const [recentMessages, setRecentMessages] = useState<any[]>([])
  const [userData, setUserData] = useState<any>(null)

  useEffect(() => {
    loadUserData()
    loadRecentMessages()
  }, [])

  const loadUserData = async () => {
    try {
      const response = await fetch('/api/user')
      const data = await response.json()
      setUserData(data)
      
      // Set initial sync status based on existing data
      setSyncStatus(prev => ({
        ...prev,
        gmail: {
          ...prev.gmail,
          lastSync: data.lastGmailSync || null
        },
        hubspot: {
          ...prev.hubspot,
          lastSync: data.lastHubspotSync || null
        }
      }))
    } catch (error) {
      console.error('Error loading user data:', error)
    }
  }

  const loadRecentMessages = async () => {
    try {
      const response = await fetch('/api/messages')
      const messages = await response.json()
      setRecentMessages(messages.slice(-10)) // Get last 10 messages
    } catch (error) {
      console.error('Error loading messages:', error)
    }
  }

  const embedData = async (source: 'gmail' | 'hubspot') => {
    setSyncStatus(prev => ({
      ...prev,
      [source]: { ...prev[source], status: 'syncing', error: undefined }
    }))

    setSyncProgress(0)
    const progressInterval = setInterval(() => {
      setSyncProgress(prev => Math.min(prev + 15, 90))
    }, 1000)

    try {
      const response = await fetch('/api/embed', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ source })
      })
      
      if (response.ok) {
        setSyncStatus(prev => ({
          ...prev,
          [source]: {
            lastSync: new Date().toISOString(),
            status: 'success',
            count: prev[source].count + 1
          }
        }))
        
        // Reload user data to get updated info
        await loadUserData()
      } else {
        const error = await response.json()
        throw new Error(error.error || 'Embedding failed')
      }
    } catch (error) {
      setSyncStatus(prev => ({
        ...prev,
        [source]: {
          ...prev[source],
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      }))
    } finally {
      clearInterval(progressInterval)
      setSyncProgress(100)
      setTimeout(() => setSyncProgress(0), 1000)
    }
  }

  const embedAllData = async () => {
    await embedData('gmail')
    if (hubspotConnected) {
      await embedData('hubspot')
    }
  }

  const clearChatHistory = async () => {
    try {
      const response = await fetch('/api/messages', {
        method: 'DELETE'
      })
      
      if (response.ok) {
        setRecentMessages([])
      }
    } catch (error) {
      console.error('Error clearing chat history:', error)
    }
  }

  const exportChatHistory = async () => {
    try {
      const response = await fetch('/api/messages')
      const messages = await response.json()
      
      const dataStr = JSON.stringify(messages, null, 2)
      const dataBlob = new Blob([dataStr], { type: 'application/json' })
      const url = URL.createObjectURL(dataBlob)
      const link = document.createElement('a')
      link.href = url
      link.download = `chat-history-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Error exporting chat history:', error)
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'syncing':
        return <RefreshCw className="h-4 w-4 animate-spin" />
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />
      default:
        return <Clock className="h-4 w-4 text-gray-400" />
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'syncing':
        return <Badge variant="outline">Processing</Badge>
      case 'success':
        return <Badge className="bg-green-100 text-green-800">Ready</Badge>
      case 'error':
        return <Badge variant="destructive">Error</Badge>
      default:
        return <Badge variant="secondary">Not Processed</Badge>
    }
  }

  console.log(
    'syncStatus.gmail', syncStatus.gmail
  )
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Data Management</h2>
        <div className="flex items-center space-x-4">
          <Button onClick={embedAllData} disabled={!hubspotConnected}>
            <Database className="h-4 w-4 mr-2" />
            Process All Data
          </Button>
        </div>
      </div>

      {syncProgress > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Processing data for AI context...</span>
              <span className="text-sm text-gray-500">{syncProgress}%</span>
            </div>
            <Progress value={syncProgress} className="w-full" />
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="sources" className="w-full">
        <TabsList>
          <TabsTrigger value="sources">Data Sources</TabsTrigger>
          <TabsTrigger value="activity">Recent Activity</TabsTrigger>
          <TabsTrigger value="export">Export & Manage</TabsTrigger>
        </TabsList>

        <TabsContent value="sources" className="space-y-4">
          {/* Gmail Data Processing */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base font-medium flex items-center">
                <Mail className="h-5 w-5 mr-2" />
                Gmail Data Processing
              </CardTitle>
              {getStatusBadge(syncStatus.gmail.status)}
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm text-gray-600">
                    Last processed: {syncStatus.gmail.lastSync ? 
                      new Date(syncStatus.gmail.lastSync).toLocaleString() : 'Never'}
                  </p>
                  <p className="text-sm text-gray-600">
                    Processes your Gmail emails to provide context for AI responses
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  {getStatusIcon(syncStatus.gmail.status)}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => embedData('gmail')}
                    disabled={syncStatus.gmail.status === 'syncing'}
                  >
                    {syncStatus.gmail.status === 'success' ? 'Re-process' : 'Process Now'}
                  </Button>
                </div>
              </div>
              {syncStatus.gmail.error && (
                <Alert className="mt-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{syncStatus.gmail.error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* HubSpot Data Processing */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base font-medium flex items-center">
                <Users className="h-5 w-5 mr-2" />
                HubSpot Data Processing
              </CardTitle>
              {hubspotConnected ? 
                getStatusBadge(syncStatus.hubspot.status) : 
                <Badge variant="secondary">Not Connected</Badge>
              }
            </CardHeader>
            <CardContent>
              {hubspotConnected ? (
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm text-gray-600">
                      Last processed: {syncStatus.hubspot.lastSync ? 
                        new Date(syncStatus.hubspot.lastSync).toLocaleString() : 'Never'}
                    </p>
                    <p className="text-sm text-gray-600">
                      Processes your HubSpot contacts to provide context for AI responses
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    {getStatusIcon(syncStatus.hubspot.status)}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => embedData('hubspot')}
                      disabled={syncStatus.hubspot.status === 'syncing'}
                    >
                      {syncStatus.hubspot.status === 'success' ? 'Re-process' : 'Process Now'}
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-600">
                  Connect HubSpot in the Connections tab to enable data processing
                </p>
              )}
              {syncStatus.hubspot.error && (
                <Alert className="mt-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{syncStatus.hubspot.error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* User Instructions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">AI Instructions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {userData?.instructions?.length > 0 ? (
                  userData.instructions.map((instruction: any) => (
                    <div key={instruction.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <span className="text-sm">{instruction.instruction}</span>
                      <Badge variant={instruction.isActive ? "default" : "secondary"}>
                        {instruction.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500">No custom instructions set</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Chat Messages</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {recentMessages.length > 0 ? (
                  recentMessages.map((message, index) => (
                    <div key={index} className="flex items-start space-x-3 py-2 border-b">
                      <div className="flex-shrink-0">
                        {message.role === 'user' ? (
                          <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center">
                            <span className="text-xs font-medium text-blue-600">U</span>
                          </div>
                        ) : (
                          <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center">
                            <span className="text-xs font-medium text-green-600">AI</span>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900 truncate">
                          {message.content.length > 100 
                            ? message.content.substring(0, 100) + '...' 
                            : message.content}
                        </p>
                        <p className="text-xs text-gray-500">
                          {new Date(message.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500">No recent messages</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Recent Tasks */}
          <Card>
            <CardHeader>
              <CardTitle>Recent AI Tasks</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {userData?.tasks?.length > 0 ? (
                  userData.tasks.map((task: any) => (
                    <div key={task.id} className="flex items-center justify-between py-2 border-b">
                      <div className="flex items-center space-x-3">
                        {task.status === 'completed' ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-red-500" />
                        )}
                        <div>
                          <p className="text-sm font-medium">{task.description}</p>
                          <p className="text-xs text-gray-500">
                            {new Date(task.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <Badge variant={task.status === 'completed' ? "default" : "destructive"}>
                        {task.status}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500">No recent tasks</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="export" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Export Chat History</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-600">
                Export your chat history with the AI assistant for backup or analysis purposes.
              </p>
              <div className="flex items-center space-x-4">
                <Button onClick={exportChatHistory} className="flex items-center">
                  <Download className="h-4 w-4 mr-2" />
                  Export Messages
                </Button>
                <div className="text-xs text-gray-500">
                  Data will be exported as JSON format
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Clear Chat History</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-600">
                Clear all chat messages. This action cannot be undone.
              </p>
              <Button 
                onClick={clearChatHistory} 
                variant="destructive"
                className="flex items-center"
              >
                <AlertCircle className="h-4 w-4 mr-2" />
                Clear All Messages
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}