'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ExternalLink, CheckCircle, AlertCircle } from 'lucide-react'

interface HubSpotConnectionProps {
  onConnectionChange: (connected: boolean) => void
  isConnected: boolean
}

export function HubSpotConnection({ onConnectionChange, isConnected }: HubSpotConnectionProps) {
  const [isConnecting, setIsConnecting] = useState(false)

  const connectHubSpot = async () => {
    setIsConnecting(true)
    try {
      window.location.href = '/api/auth/hubspot'
    } catch (error) {
      console.error('Error connecting to HubSpot:', error)
      setIsConnecting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <span>HubSpot Integration</span>
          {isConnected ? (
            <CheckCircle className="w-5 h-5 text-green-500" />
          ) : (
            <AlertCircle className="w-5 h-5 text-yellow-500" />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isConnected ? (
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span>Connected - CRM access enabled</span>
            </div>
            <p className="text-sm text-gray-600">
              Your HubSpot CRM is connected. The AI can now access your contacts, deals, and notes.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-gray-600">
              Connect your HubSpot CRM to allow the AI to access your contacts, deals, and notes.
            </p>
            <Button 
              onClick={connectHubSpot}
              disabled={isConnecting}
              className="w-full"
            >
              {isConnecting ? (
                'Connecting...'
              ) : (
                <>
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Connect HubSpot
                </>
              )}
            </Button>
            <p className="text-xs text-gray-500">
              You'll be redirected to HubSpot to authorize the connection.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}