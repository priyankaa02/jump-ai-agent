import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(
  req: NextRequest,
  context: { params: Record<string, string> }
) {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const userId = session.user.id!;
    const instructionId = context.params.id;
    const updates = await req.json();

    const existing = await prisma.ongoingInstruction.findFirst({
      where: { id: instructionId, userId },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Instruction not found' }, { status: 404 });
    }

    const updated = await prisma.ongoingInstruction.update({
      where: { id: instructionId },
      data: {
        ...(updates.instruction !== undefined && { instruction: updates.instruction }),
        ...(updates.isActive !== undefined && { isActive: updates.isActive }),
        ...(updates.priority !== undefined && { priority: updates.priority }),
      },
    });

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
            priority: existing.priority,
          },
        },
      },
    });

    return NextResponse.json({ instruction: updated });
  } catch (error) {
    console.error('Error updating instruction:', error);
    return NextResponse.json({ error: 'Failed to update instruction' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Record<string, string> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const userId = session.user.id!;
    const instructionId = context.params.id;

    const existing = await prisma.ongoingInstruction.findFirst({
      where: { id: instructionId, userId },
    });

    if (!existing) {
      return NextResponse.json({ error: 'Instruction not found' }, { status: 404 });
    }

    await prisma.ongoingInstruction.delete({
      where: { id: instructionId },
    });

    await prisma.activityLog.create({
      data: {
        userId,
        action: 'instruction_deleted',
        service: 'system',
        details: {
          instructionId,
          instruction: existing.instruction,
        },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting instruction:', error);
    return NextResponse.json({ error: 'Failed to delete instruction' }, { status: 500 });
  }
}
