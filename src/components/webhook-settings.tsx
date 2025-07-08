'use client'

import React from 'react'
import { useWebhooks } from '@/hooks/useWebhooks'
import { AlertCircle, CheckCircle, Clock, Loader2, RefreshCw } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function WebhookSettings() {
  const {
    statuses,
    loading,
    registering,
    toggleWebhook,
    refresh,
    isExpiringSoon
  } = useWebhooks()

  const serviceInfo = {
    gmail: {
      name: 'Gmail',
      description: 'Real-time email notifications',
      icon: '📧'
    },
    calendar: {
      name: 'Google Calendar',
      description: 'Calendar event updates',
      icon: '📅'
    },
    hubspot: {
      name: 'HubSpot',
      description: 'CRM contact and deal updates',
      icon: '🤝'
    }
  }

  const formatExpiryTime = (expiresAt: Date | null | undefined) => {
    if (!expiresAt) return 'No expiration'
    
    const expiry = new Date(expiresAt)
    const now = new Date()
    const hoursLeft = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60))
    
    if (hoursLeft < 0) return 'Expired'
    if (hoursLeft < 24) return `Expires in ${hoursLeft} hours`
    
    const daysLeft = Math.floor(hoursLeft / 24)
    return `Expires in ${daysLeft} days`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Webhook Settings</h3>
          <p className="text-sm text-gray-600 mt-1">
            Manage real-time updates from your connected services
          </p>
        </div>
        <Button
          onClick={refresh}
          disabled={loading}
          variant="outline"
          size="sm"
          className="flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {loading && statuses.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="grid gap-4">
          {statuses.map(status => {
            const info = serviceInfo[status.service as keyof typeof serviceInfo]
            const isActive = status.active
            const expiringSoon = isExpiringSoon(status.expiresAt)
            
            return (
              <Card key={status.service} className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="text-3xl">{info.icon}</div>
                    <div>
                      <h4 className="font-semibold flex items-center gap-2">
                        {info.name}
                        {isActive ? (
                          <CheckCircle className="w-5 h-5 text-green-500" />
                        ) : (
                          <AlertCircle className="w-5 h-5 text-gray-400" />
                        )}
                      </h4>
                      <p className="text-sm text-gray-600 mt-1">{info.description}</p>
                      
                      {isActive && (
                        <div className="mt-2 flex items-center gap-4 text-sm">
                          <span className={`flex items-center gap-1 ${expiringSoon ? 'text-orange-600' : 'text-gray-500'}`}>
                            <Clock className="w-4 h-4" />
                            {formatExpiryTime(status.expiresAt)}
                          </span>
                          {status.lastUpdate && (
                            <span className="text-gray-500">
                              Last updated: {new Date(status.lastUpdate).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <Button
                    onClick={() => toggleWebhook(status.service)}
                    disabled={registering === status.service}
                    variant={isActive ? "outline" : "default"}
                    size="sm"
                  >
                    {registering === status.service ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : isActive ? (
                      'Disconnect'
                    ) : (
                      'Connect'
                    )}
                  </Button>
                </div>
                
                {expiringSoon && isActive && (
                  <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-md">
                    <p className="text-sm text-orange-800">
                      This webhook will expire soon. It will be automatically renewed.
                    </p>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <Card className="p-4 bg-gray-50">
        <h4 className="font-semibold text-gray-700 mb-2">About Webhooks</h4>
        <p className="text-sm text-gray-600">
          Webhooks enable real-time synchronization with your connected services. 
          When enabled, you'll receive instant updates when emails arrive, calendar 
          events change, or CRM contacts are updated. This ensures your AI assistant 
          always has the latest information.
        </p>
      </Card>
    </div>
  )
}