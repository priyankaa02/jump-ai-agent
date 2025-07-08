import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { 
  Trash2, 
  Plus, 
  Bot, 
  Zap, 
  Clock, 
  CheckCircle2,
  AlertCircle,
  Edit,
  Save,
  X
} from 'lucide-react'

interface OngoingInstruction {
  id: string
  instruction: string
  isActive: boolean
  priority?: string
  createdAt: string
  updatedAt: string
  executionCount?: number
  lastExecuted?: string
}

export default function InstructionManager() {
  const [instructions, setInstructions] = useState<OngoingInstruction[]>([])
  const [newInstruction, setNewInstruction] = useState('')
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')

  useEffect(() => {
    fetchInstructions()
  }, [])

  const fetchInstructions = async () => {
    try {
      const response = await fetch('/api/instructions')
      const data = await response.json()
      setInstructions(data.instructions || [])
    } catch (error) {
      console.error('Error fetching instructions:', error)
    }
  }

  const addInstruction = async () => {
    if (!newInstruction.trim()) return

    setLoading(true)
    try {
      const response = await fetch('/api/instructions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: newInstruction })
      })

      if (response.ok) {
        setNewInstruction('')
        await fetchInstructions()
      }
    } catch (error) {
      console.error('Error adding instruction:', error)
    } finally {
      setLoading(false)
    }
  }

  const toggleInstruction = async (id: string, isActive: boolean) => {
    try {
      await fetch(`/api/instructions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive })
      })

      setInstructions(prev =>
        prev.map(inst => inst.id === id ? { ...inst, isActive } : inst)
      )
    } catch (error) {
      console.error('Error toggling instruction:', error)
    }
  }

  const deleteInstruction = async (id: string) => {
    if (!confirm('Are you sure you want to delete this instruction?')) return

    try {
      await fetch(`/api/instructions/${id}`, { method: 'DELETE' })
      setInstructions(prev => prev.filter(inst => inst.id !== id))
    } catch (error) {
      console.error('Error deleting instruction:', error)
    }
  }

  const startEditing = (instruction: OngoingInstruction) => {
    setEditingId(instruction.id)
    setEditingText(instruction.instruction)
  }

  const saveEdit = async () => {
    if (!editingId || !editingText.trim()) return

    try {
      await fetch(`/api/instructions/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: editingText })
      })

      setInstructions(prev =>
        prev.map(inst => 
          inst.id === editingId ? { ...inst, instruction: editingText } : inst
        )
      )
      setEditingId(null)
      setEditingText('')
    } catch (error) {
      console.error('Error updating instruction:', error)
    }
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditingText('')
  }

  const getInstructionIcon = (instruction: string) => {
    const lower = instruction.toLowerCase()
    if (lower.includes('email')) return '📧'
    if (lower.includes('contact')) return '👤'
    if (lower.includes('meeting') || lower.includes('calendar')) return '📅'
    if (lower.includes('hubspot')) return '🤝'
    return '🤖'
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    
    if (diff < 86400000) { // Less than 24 hours
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
      return `${Math.floor(diff / 3600000)}h ago`
    }
    return date.toLocaleDateString()
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5" />
            Ongoing Instructions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="bg-blue-50 p-4 rounded-lg">
              <h4 className="font-medium text-sm mb-2">Example Instructions:</h4>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• When someone emails me that is not in HubSpot, create a contact with a note</li>
                <li>• When I create a contact in HubSpot, send them a welcome email</li>
                <li>• When I add an event in my calendar, send reminders to all attendees</li>
                <li>• If someone asks about our next meeting, check my calendar and respond</li>
              </ul>
            </div>

            <div className="flex gap-2">
              <Textarea
                placeholder="Enter your instruction... (e.g., 'When someone emails me...')"
                value={newInstruction}
                onChange={(e) => setNewInstruction(e.target.value)}
                className="flex-1"
                rows={3}
              />
              <Button
                onClick={addInstruction}
                disabled={loading || !newInstruction.trim()}
                className="self-end"
              >
                <Plus className="w-4 h-4 mr-1" />
                Add
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Active Instructions ({instructions.length})</CardTitle>
            <Badge variant="secondary" className="flex items-center gap-1">
              <Zap className="w-3 h-3" />
              {instructions.filter(i => i.isActive).length} Active
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {instructions.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Bot className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>No instructions yet. Add one above to get started!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {instructions.map((instruction) => (
                <div
                  key={instruction.id}
                  className={`p-4 rounded-lg border transition-all ${
                    instruction.isActive 
                      ? 'bg-white border-green-200' 
                      : 'bg-gray-50 border-gray-200 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-start gap-2">
                        <span className="text-2xl mt-1">{getInstructionIcon(instruction.instruction)}</span>
                        <div className="flex-1">
                          {editingId === instruction.id ? (
                            <div className="space-y-2">
                              <Textarea
                                value={editingText}
                                onChange={(e) => setEditingText(e.target.value)}
                                className="w-full"
                                rows={2}
                              />
                              <div className="flex gap-2">
                                <Button size="sm" onClick={saveEdit}>
                                  <Save className="w-3 h-3 mr-1" />
                                  Save
                                </Button>
                                <Button size="sm" variant="outline" onClick={cancelEdit}>
                                  <X className="w-3 h-3 mr-1" />
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="font-medium">{instruction.instruction}</p>
                              <div className="flex items-center gap-4 text-xs text-gray-500">
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  Created {formatDate(instruction.createdAt)}
                                </span>
                                {instruction.executionCount && instruction.executionCount > 0 && (
                                  <span className="flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" />
                                    Executed {instruction.executionCount} times
                                  </span>
                                )}
                                {instruction.lastExecuted && (
                                  <span className="flex items-center gap-1">
                                    <Zap className="w-3 h-3" />
                                    Last run {formatDate(instruction.lastExecuted)}
                                  </span>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Switch
                        checked={instruction.isActive}
                        onCheckedChange={(checked) => toggleInstruction(instruction.id, checked)}
                      />
                      {editingId !== instruction.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => startEditing(instruction)}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteInstruction(instruction.id)}
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    </div>
                  </div>

                  {instruction.isActive && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-green-600">
                      <AlertCircle className="w-3 h-3" />
                      <span>Active - monitoring for matching events</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}