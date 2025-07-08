import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: {
        instructions: true,
        tasks: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json(user)
  } catch (error) {
    console.error('User fetch error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { action, data } = await req.json()
    const userId = session.user.id!

    if (action === 'add_instruction') {
      const instruction = await prisma.ongoingInstruction.create({
        data: {
          userId,
          instruction: data.instruction,
        },
      })
      return NextResponse.json(instruction)
    } else if (action === 'remove_instruction') {
      await prisma.ongoingInstruction.delete({
        where: { id: data.id },
      })
      return NextResponse.json({ success: true })
    } else if (action === 'toggle_instruction') {
      const instruction = await prisma.ongoingInstruction.update({
        where: { id: data.id },
        data: { isActive: data.isActive },
      })
      return NextResponse.json(instruction)
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('User update error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}