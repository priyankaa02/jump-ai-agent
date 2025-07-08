import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  
  if (!code) {
    const validScopes = [
      'crm.objects.contacts.read',
      'crm.objects.contacts.write',
      'crm.objects.companies.read', 
      'crm.objects.deals.read',
      'crm.schemas.contacts.read',
      'oauth',
      'automation'
    ]
    
    const hubspotAuthUrl = `https://app.hubspot.com/oauth/authorize?client_id=${process.env.HUBSPOT_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.APP_URL + '/api/auth/hubspot')}&scope=${validScopes.join('%20')}`
    
    return NextResponse.redirect(hubspotAuthUrl)
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch('https://api.hubapi.com/oauth/v1/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.HUBSPOT_CLIENT_ID!,
        client_secret: process.env.HUBSPOT_CLIENT_SECRET!,
        redirect_uri: process.env.APP_URL + '/api/auth/hubspot',
        code,
      }),
    })

    const tokenData = await tokenResponse.json()

    if (!tokenData.access_token) {
      throw new Error('Failed to get access token: ' + JSON.stringify(tokenData))
    }

    // Get account info
    const accountResponse = await fetch('https://api.hubapi.com/oauth/v1/access-tokens/' + tokenData.access_token)
    const accountData = await accountResponse.json()

    // Update user with HubSpot tokens
    await prisma.user.update({
      where: { email: session.user.email },
      data: {
        hubspotAccessToken: tokenData.access_token,
        hubspotRefreshToken: tokenData.refresh_token,
        hubspotPortalId: accountData.hub_id?.toString(),
      },
    })

    return NextResponse.redirect(`${process.env.APP_URL}/?hubspot=connected`)
  } catch (error) {
    console.error('HubSpot OAuth error:', error)
    return NextResponse.redirect(`${process.env.APP_URL}/?hubspot=error`)
  }
}