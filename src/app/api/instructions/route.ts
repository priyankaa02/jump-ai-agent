import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET - Fetch all instructions
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const userId = session.user.id!
    
    const instructions = await prisma.ongoingInstruction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    })

    // Get execution stats for each instruction
    const instructionsWithStats = await Promise.all(
      instructions.map(async (instruction) => {
        const executionCount = await prisma.activityLog.count({
          where: {
            userId,
            action: 'proactive_action_executed',
            details: {
              path: ['instruction'],
              equals: instruction.instruction
            }
          }
        })

        const lastExecution = await prisma.activityLog.findFirst({
          where: {
            userId,
            action: 'proactive_action_executed',
            details: {
              path: ['instruction'],
              equals: instruction.instruction
            }
          },
          orderBy: { createdAt: 'desc' }
        })

        return {
          ...instruction,
          executionCount,
          lastExecuted: lastExecution?.createdAt
        }
      })
    )

    return NextResponse.json({ instructions: instructionsWithStats })
  } catch (error) {
    console.error('Error fetching instructions:', error)
    return NextResponse.json({ error: 'Failed to fetch instructions' }, { status: 500 })
  }
}

// POST - Create new instruction
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const userId = session.user.id!
    const { instruction } = await req.json()

    if (!instruction || instruction.trim().length === 0) {
      return NextResponse.json({ error: 'Instruction text is required' }, { status: 400 })
    }

    const newInstruction = await prisma.ongoingInstruction.create({
      data: {
        userId,
        instruction: instruction.trim(),
        isActive: true,
        priority: 'normal'
      }
    })

    // Log the creation
    await prisma.activityLog.create({
      data: {
        userId,
        action: 'instruction_created',
        service: 'system',
        details: {
          instructionId: newInstruction.id,
          instruction: newInstruction.instruction
        }
      }
    })

    return NextResponse.json({ instruction: newInstruction })
  } catch (error) {
    console.error('Error creating instruction:', error)
    return NextResponse.json({ error: 'Failed to create instruction' }, { status: 500 })
  }
}