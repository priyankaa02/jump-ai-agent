import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// PATCH - Update instruction
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const userId = session.user.id!
    const instructionId = params.id
    const updates = await req.json()

    // Verify ownership
    const existing = await prisma.ongoingInstruction.findFirst({
      where: { id: instructionId, userId }
    })

    if (!existing) {
      return NextResponse.json({ error: 'Instruction not found' }, { status: 404 })
    }

    // Update instruction
    const updated = await prisma.ongoingInstruction.update({
      where: { id: instructionId },
      data: {
        ...(updates.instruction !== undefined && { instruction: updates.instruction }),
        ...(updates.isActive !== undefined && { isActive: updates.isActive }),
        ...(updates.priority !== undefined && { priority: updates.priority })
      }
    })

    // Log the update
    await prisma.activityLog.create({
      data: {
        userId,
        action: 'instruction_updated',
        service: 'system',
        details: {
          instructionId,
          updates,
          oldValues: {
            instruction: existing.instruction,
            isActive: existing.isActive,
            priority: existing.priority
          }
        }
      }
    })

    return NextResponse.json({ instruction: updated })
  } catch (error) {
    console.error('Error updating instruction:', error)
    return NextResponse.json({ error: 'Failed to update instruction' }, { status: 500 })
  }
}

// DELETE - Delete instruction
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const userId = session.user.id!
    const instructionId = params.id

    // Verify ownership
    const existing = await prisma.ongoingInstruction.findFirst({
      where: { id: instructionId, userId }
    })

    if (!existing) {
      return NextResponse.json({ error: 'Instruction not found' }, { status: 404 })
    }

    // Delete instruction
    await prisma.ongoingInstruction.delete({
      where: { id: instructionId }
    })

    // Log the deletion
    await prisma.activityLog.create({
      data: {
        userId,
        action: 'instruction_deleted',
        service: 'system',
        details: {
          instructionId,
          instruction: existing.instruction
        }
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting instruction:', error)
    return NextResponse.json({ error: 'Failed to delete instruction' }, { status: 500 })
  }
}