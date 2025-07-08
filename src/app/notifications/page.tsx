// app/notifications/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Bell, X, Mail, Users, Calendar, AlertCircle, Filter, Search, ChevronLeft, Trash2 } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'

// Types
interface Notification {
  id: string
  title: string
  message: string
  type: string
  service: string
  read: boolean
  createdAt: string
  data?: any
}

interface NotificationResponse {
  notifications: Notification[]
  totalCount: number
  unreadCount: number
  hasMore: boolean
}

export default function NotificationsPage() {
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [filteredNotifications, setFilteredNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [filters, setFilters] = useState({
    search: '',
    service: 'all',
    type: 'all',
    status: 'all'
  })
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    hasMore: false
  })

  useEffect(() => {
    fetchNotifications()
  }, [pagination.page])

  useEffect(() => {
    applyFilters()
  }, [notifications, filters])

  const fetchNotifications = async () => {
    try {
      setLoading(true)
      const offset = (pagination.page - 1) * pagination.limit
      const response = await fetch(`/api/notifications?limit=${pagination.limit}&offset=${offset}`)
      const data: NotificationResponse = await response.json()
      
      setNotifications(data.notifications || [])
      setPagination(prev => ({
        ...prev,
        total: data.totalCount || 0,
        hasMore: data.hasMore || false
      }))
    } catch (error) {
      console.error('Error fetching notifications:', error)
    } finally {
      setLoading(false)
    }
  }

  const applyFilters = () => {
    let filtered = [...notifications]

    // Search filter
    if (filters.search) {
      filtered = filtered.filter(n => 
        n.title.toLowerCase().includes(filters.search.toLowerCase()) ||
        n.message.toLowerCase().includes(filters.search.toLowerCase())
      )
    }

    // Service filter
    if (filters.service !== 'all') {
      filtered = filtered.filter(n => n.service === filters.service)
    }

    // Type filter
    if (filters.type !== 'all') {
      filtered = filtered.filter(n => n.type === filters.type)
    }

    // Status filter
    if (filters.status === 'read') {
      filtered = filtered.filter(n => n.read)
    } else if (filters.status === 'unread') {
      filtered = filtered.filter(n => !n.read)
    }

    setFilteredNotifications(filtered)
  }

  const markAsRead = async (notificationIds: string[]) => {
    try {
      await Promise.all(
        notificationIds.map(id => 
          fetch(`/api/notifications/${id}/read`, { method: 'PATCH' })
        )
      )
      
      setNotifications(prev =>
        prev.map(n => 
          notificationIds.includes(n.id) ? { ...n, read: true } : n
        )
      )
      setSelectedIds(new Set())
    } catch (error) {
      console.error('Error marking notifications as read:', error)
    }
  }

  const deleteNotifications = async (notificationIds: string[]) => {
    try {
      await Promise.all(
        notificationIds.map(id => 
          fetch(`/api/notifications/${id}`, { method: 'DELETE' })
        )
      )
      
      setNotifications(prev => prev.filter(n => !notificationIds.includes(n.id)))
      setSelectedIds(new Set())
    } catch (error) {
      console.error('Error deleting notifications:', error)
    }
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredNotifications.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredNotifications.map(n => n.id)))
    }
  }

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
  }

  const getIcon = (type: string) => {
    switch (type) {
      case 'contact_created':
        return <Users className="w-4 h-4" />
      case 'email':
        return <Mail className="w-4 h-4" />
      case 'calendar':
        return <Calendar className="w-4 h-4" />
      default:
        return <AlertCircle className="w-4 h-4" />
    }
  }

  const getNotificationColor = (service: string) => {
    switch (service) {
      case 'hubspot':
        return 'bg-orange-100 text-orange-600'
      case 'gmail':
        return 'bg-blue-100 text-blue-600'
      case 'calendar':
        return 'bg-green-100 text-green-600'
      default:
        return 'bg-gray-100 text-gray-600'
    }
  }

  const formatTime = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diff = now.getTime() - date.getTime()

    if (diff < 60000) return 'just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return date.toLocaleDateString()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-4">
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => router.back()}
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
              <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
            </div>
            
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                {pagination.total} total
              </Badge>
              <Badge variant="default">
                {notifications.filter(n => !n.read).length} unread
              </Badge>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-col lg:flex-row gap-4">
              {/* Search */}
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder="Search notifications..."
                    value={filters.search}
                    onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                    className="pl-10"
                  />
                </div>
              </div>

              {/* Service Filter */}
              <Select
                value={filters.service}
                onValueChange={(value) => setFilters(prev => ({ ...prev, service: value }))}
              >
                <SelectTrigger className="w-full lg:w-[180px]">
                  <SelectValue placeholder="All Services" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Services</SelectItem>
                  <SelectItem value="hubspot">HubSpot</SelectItem>
                  <SelectItem value="gmail">Gmail</SelectItem>
                  <SelectItem value="calendar">Calendar</SelectItem>
                </SelectContent>
              </Select>

              {/* Type Filter */}
              <Select
                value={filters.type}
                onValueChange={(value) => setFilters(prev => ({ ...prev, type: value }))}
              >
                <SelectTrigger className="w-full lg:w-[180px]">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="contact_created">Contact Created</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="calendar">Calendar</SelectItem>
                </SelectContent>
              </Select>

              {/* Status Filter */}
              <Select
                value={filters.status}
                onValueChange={(value) => setFilters(prev => ({ ...prev, status: value }))}
              >
                <SelectTrigger className="w-full lg:w-[180px]">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="unread">Unread</SelectItem>
                  <SelectItem value="read">Read</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Bulk Actions */}
        {selectedIds.size > 0 && (
          <Card className="mb-4">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">
                  {selectedIds.size} selected
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => markAsRead(Array.from(selectedIds))}
                  >
                    Mark as Read
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => deleteNotifications(Array.from(selectedIds))}
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Delete
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Notifications List */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-gray-500">
                Loading notifications...
              </div>
            ) : filteredNotifications.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <Bell className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                <p>No notifications found</p>
              </div>
            ) : (
              <>
                {/* Select All */}
                <div className="px-4 py-3 border-b bg-gray-50">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={selectedIds.size === filteredNotifications.length && filteredNotifications.length > 0}
                      onCheckedChange={toggleSelectAll}
                    />
                    <span className="text-sm font-medium">Select All</span>
                  </label>
                </div>

                {/* Notifications */}
                <div className="divide-y">
                  {filteredNotifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`p-4 hover:bg-gray-50 transition-colors ${
                        !notification.read ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="flex gap-3">
                        {/* Checkbox */}
                        <div className="flex items-start pt-1">
                          <Checkbox
                            checked={selectedIds.has(notification.id)}
                            onCheckedChange={() => toggleSelect(notification.id)}
                          />
                        </div>

                        {/* Icon */}
                        <div className={`p-2 rounded-lg ${getNotificationColor(notification.service)}`}>
                          {getIcon(notification.type)}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <p className="font-medium text-sm">{notification.title}</p>
                              <p className="text-sm text-gray-600 mt-1">
                                {notification.message}
                              </p>

                              {notification.type === 'contact_created' && notification.data && (
                                <div className="mt-2 p-2 bg-gray-100 rounded text-xs space-y-1">
                                  <p>
                                    <span className="font-medium">Contact:</span>{' '}
                                    {notification.data.name}
                                  </p>
                                  <p>
                                    <span className="font-medium">Email:</span>{' '}
                                    {notification.data.email}
                                  </p>
                                  {notification.data.emailContext?.emailSubject && (
                                    <p>
                                      <span className="font-medium">From email:</span>{' '}
                                      {notification.data.emailContext.emailSubject}
                                    </p>
                                  )}
                                </div>
                              )}

                              <div className="flex items-center gap-2 mt-2">
                                <span className="text-xs text-gray-500">
                                  {formatTime(notification.createdAt)}
                                </span>
                                <span className="text-xs text-gray-400">•</span>
                                <span className="text-xs text-gray-500 capitalize">
                                  {notification.service}
                                </span>
                                {!notification.read && (
                                  <>
                                    <span className="text-xs text-gray-400">•</span>
                                    <Badge variant="secondary" className="text-xs">
                                      Unread
                                    </Badge>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-2 ml-4">
                              {!notification.read && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => markAsRead([notification.id])}
                                >
                                  Mark as read
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => deleteNotifications([notification.id])}
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                {pagination.hasMore && (
                  <div className="p-4 border-t">
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                    >
                      Load More
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}