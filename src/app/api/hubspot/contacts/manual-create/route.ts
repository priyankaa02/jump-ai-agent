import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const userId = session.user.id!
    const { email, firstName, lastName, company, jobTitle, phone } = await req.json()

    // Get user's HubSpot credentials
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { hubspotAccessToken: true }
    })

    if (!user?.hubspotAccessToken) {
      return NextResponse.json({ error: 'HubSpot not connected' }, { status: 400 })
    }

    // Check if contact already exists
    const searchResponse = await fetch(
      `https://api.hubapi.com/crm/v3/objects/contacts/search`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${user.hubspotAccessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                {
                  propertyName: 'email',
                  operator: 'EQ',
                  value: email
                }
              ]
            }
          ],
          properties: ['email', 'firstname', 'lastname'],
          limit: 1
        })
      }
    )

    if (!searchResponse.ok) {
      throw new Error(`HubSpot search failed: ${searchResponse.statusText}`)
    }

    const searchResult = await searchResponse.json()
    
    if (searchResult.total > 0) {
      return NextResponse.json({ 
        error: 'Contact already exists',
        existingContact: searchResult.results[0]
      }, { status: 409 })
    }

    // Create new contact
    const contactData = {
      properties: {
        email: email,
        ...(firstName && { firstname: firstName }),
        ...(lastName && { lastname: lastName }),
        ...(company && { company: company }),
        ...(jobTitle && { jobtitle: jobTitle }),
        ...(phone && { phone: phone }),
        lifecyclestage: 'lead',
        hs_lead_status: 'NEW',
        email_source: 'manual_creation'
      }
    }

    const createResponse = await fetch(
      'https://api.hubapi.com/crm/v3/objects/contacts',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${user.hubspotAccessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(contactData)
      }
    )

    if (!createResponse.ok) {
      const errorData = await createResponse.json()
      throw new Error(`HubSpot contact creation failed: ${createResponse.statusText}`)
    }

    const newContact = await createResponse.json()

    // Create document record
    await prisma.document.create({
      data: {
        userId,
        title: `${firstName || ''} ${lastName || ''}`.trim() || email,
        content: formatContactContent(contactData.properties),
        source: 'hubspot',
        sourceId: `contact-${newContact.id}`,
        metadata: {
          ...newContact.properties,
          objectType: 'contact',
          hubspotId: newContact.id,
          createdFrom: 'manual_creation',
          lastModified: new Date()
        }
      }
    })

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId,
        action: 'contact_created',
        service: 'hubspot',
        details: {
          contactId: newContact.id,
          email: email,
          name: `${firstName || ''} ${lastName || ''}`.trim() || email,
          source: 'manual_creation'
        }
      }
    })

    // Create notification
    await prisma.notification.create({
      data: {
        userId,
        type: 'contact_created',
        service: 'hubspot',
        title: 'Contact Created',
        message: `Manual contact "${`${firstName || ''} ${lastName || ''}`.trim() || email}" created successfully`,
        data: {
          contactId: newContact.id,
          email: email,
          name: `${firstName || ''} ${lastName || ''}`.trim() || email,
          source: 'manual_creation'
        },
        read: false
      }
    })

    return NextResponse.json({
      success: true,
      contact: newContact,
      message: 'Contact created successfully'
    })

  } catch (error) {
    console.error('Error creating contact:', error)
    return NextResponse.json({ error: 'Failed to create contact' }, { status: 500 })
  }
}

function formatContactContent(properties: any): string {
  const parts = []
  
  if (properties.email) parts.push(`Email: ${properties.email}`)
  if (properties.firstname) parts.push(`First Name: ${properties.firstname}`)
  if (properties.lastname) parts.push(`Last Name: ${properties.lastname}`)
  if (properties.company) parts.push(`Company: ${properties.company}`)
  if (properties.jobtitle) parts.push(`Job Title: ${properties.jobtitle}`)
  if (properties.phone) parts.push(`Phone: ${properties.phone}`)
  if (properties.lifecyclestage) parts.push(`Lifecycle Stage: ${properties.lifecyclestage}`)
  if (properties.hs_lead_status) parts.push(`Lead Status: ${properties.hs_lead_status}`)
  if (properties.email_source) parts.push(`Source: ${properties.email_source}`)
  
  return parts.join('\n')
}