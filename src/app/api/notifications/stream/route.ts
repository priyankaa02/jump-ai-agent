import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  
  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 })
  }

  const userId = session.user.id!
  
  // Set up SSE headers
  const headers = new Headers({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  // Create a readable stream
  const stream = new ReadableStream({
    async start(controller) {
      // Send initial connection message
      controller.enqueue(`data: ${JSON.stringify({ type: 'connected' })}\n\n`)

      // Set up periodic heartbeat
      const heartbeat = setInterval(() => {
        controller.enqueue(': heartbeat\n\n')
      }, 30000)

      // Subscribe to notification events for this user
      // This is a simplified example - in production, you'd use Redis pub/sub or similar
      const notificationListener = (notification: any) => {
        if (notification.userId === userId) {
          controller.enqueue(`data: ${JSON.stringify({
            type: 'notification',
            notification
          })}\n\n`)
        }
      }

      // Clean up on close
      req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat)
        controller.close()
      })
    }
  })

  return new Response(stream, { headers })
}