// import { prisma } from './prisma'

// export async function getHubSpotClient(userId: string) {
//   const user = await prisma.user.findUnique({
//     where: { id: userId },
//   })

//   if (!user?.hubspotAccessToken) {
//     throw new Error('HubSpot access token not found')
//   }

//   return {
//     accessToken: user.hubspotAccessToken,
//     portalId: user.hubspotPortalId,
//   }
// }

// export async function getHubSpotContacts(userId: string) {
//   const client = await getHubSpotClient(userId)
  
//   const response = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts?limit=100`, {
//     headers: {
//       'Authorization': `Bearer ${client.accessToken}`,
//       'Content-Type': 'application/json',
//     },
//   })

//   const data = await response.json()
//   return data.results || []
// }

// export async function createHubSpotContact(userId: string, contactData: any) {
//   const client = await getHubSpotClient(userId)
  
//   const response = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts`, {
//     method: 'POST',
//     headers: {
//       'Authorization': `Bearer ${client.accessToken}`,
//       'Content-Type': 'application/json',
//     },
//     body: JSON.stringify({
//       properties: contactData,
//     }),
//   })

//   console.log('response', contactData, response)

//   const data = await response.json()
//   return data
// }

// export async function updateHubSpotContact(userId: string, contactId: string, contactData: any) {
//   const client = await getHubSpotClient(userId)
  
//   const response = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
//     method: 'PATCH',
//     headers: {
//       'Authorization': `Bearer ${client.accessToken}`,
//       'Content-Type': 'application/json',
//     },
//     body: JSON.stringify({
//       properties: contactData,
//     }),
//   })

//   const data = await response.json()
//   return data
// }

// export async function addHubSpotNote(userId: string, contactId: string, note: string) {
//   const client = await getHubSpotClient(userId)
  
//   const response = await fetch(`https://api.hubapi.com/crm/v3/objects/notes`, {
//     method: 'POST',
//     headers: {
//       'Authorization': `Bearer ${client.accessToken}`,
//       'Content-Type': 'application/json',
//     },
//     body: JSON.stringify({
//       properties: {
//         hs_note_body: note,
//         hs_timestamp: new Date().toISOString(),
//       },
//       associations: [
//         {
//           to: { id: contactId },
//           types: [
//             {
//               associationCategory: 'HUBSPOT_DEFINED',
//               associationTypeId: 202, // Contact to Note
//             },
//           ],
//         },
//       ],
//     }),
//   })

//   const data = await response.json()
//   return data
// }

// export async function searchHubSpotContact(userId: string, query: string) {
//   const client = await getHubSpotClient(userId)
  
//   const response = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/search`, {
//     method: 'POST',
//     headers: {
//       'Authorization': `Bearer ${client.accessToken}`,
//       'Content-Type': 'application/json',
//     },
//     body: JSON.stringify({
//       query,
//       limit: 10,
//       properties: ['firstname', 'lastname', 'email', 'phone'],
//     }),
//   })

//   console.log('search response', response)

//   const data = await response.json()
//   return data.results || []
// }

import { prisma } from './prisma'

export async function getHubSpotClient(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  })

  if (!user?.hubspotAccessToken) {
    throw new Error('HubSpot access token not found')
  }

  return {
    accessToken: user.hubspotAccessToken,
    portalId: user.hubspotPortalId,
  }
}

export async function getHubSpotContacts(userId: string, options: {
  limit?: number;
  offset?: number;
  properties?: string[];
} = {}) {
  const client = await getHubSpotClient(userId)
  
  const {
    limit = 100,
    offset = 0,
    properties = ['firstname', 'lastname', 'email', 'phone', 'company']
  } = options

  const url = new URL('https://api.hubapi.com/crm/v3/objects/contacts')
  url.searchParams.append('limit', limit.toString())
  url.searchParams.append('offset', offset.toString())
  properties.forEach(prop => url.searchParams.append('properties', prop))

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${client.accessToken}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(`HubSpot API error: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`)
  }

  const data = await response.json()
  console.log('HubSpot contacts response:', data)
  return {
    contacts: data.results || [],
    total: data.total || 0,
    hasMore: data.paging?.next?.after ? true : false
  }
}

export async function createHubSpotContact(userId: string, contactData: any) {
  const client = await getHubSpotClient(userId)
  
  const response = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${client.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: contactData,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(`HubSpot API error: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`)
  }

  console.log('HubSpot contact created:', contactData)
  const data = await response.json()
  return data
}

export async function updateHubSpotContact(userId: string, contactId: string, contactData: any) {
  const client = await getHubSpotClient(userId)
  
  const response = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${client.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: contactData,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(`HubSpot API error: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`)
  }

  const data = await response.json()
  return data
}

export async function addHubSpotNote(userId: string, contactId: string, note: string) {
  const client = await getHubSpotClient(userId)
  
  const response = await fetch(`https://api.hubapi.com/crm/v3/objects/notes`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${client.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        hs_note_body: note,
        hs_timestamp: new Date().toISOString(),
      },
      associations: [
        {
          to: { id: contactId },
          types: [
            {
              associationCategory: 'HUBSPOT_DEFINED',
              associationTypeId: 202, // Contact to Note
            },
          ],
        },
      ],
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(`HubSpot API error: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`)
  }

  const data = await response.json()
  return data
}

export async function searchHubSpotContact(userId: string, query: string) {
  const client = await getHubSpotClient(userId)
  
  const response = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/search`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${client.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      limit: 10,
      properties: ['firstname', 'lastname', 'email', 'phone'],
    }),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(`HubSpot API error: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`)
  }

  console.log('HubSpot contact search for:', query)
  const data = await response.json()
  return data.results || []
}

export async function getHubSpotContactById(userId: string, contactId: string) {
  const client = await getHubSpotClient(userId)
  
  const url = new URL(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`)
  const properties = ['firstname', 'lastname', 'email', 'phone', 'company', 'createdate', 'lastmodifieddate']
  properties.forEach(prop => url.searchParams.append('properties', prop))

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${client.accessToken}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(`HubSpot API error: ${response.status} ${response.statusText} - ${JSON.stringify(errorData)}`)
  }

  const data = await response.json()
  console.log('HubSpot contact by ID:', data)
  return data
}

export async function getHubSpotContactNotes(userId: string, contactId: string) {
  const client = await getHubSpotClient(userId)
  
  try {
    const response = await fetch(`https://api.hubapi.com/crm/v3/objects/notes/search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${client.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filterGroups: [{
          filters: [{
            propertyName: 'associations.contact',
            operator: 'EQ',
            value: contactId
          }]
        }],
        properties: ['hs_note_body', 'hs_created_by_user_id', 'createdate'],
        sorts: [{
          propertyName: 'createdate',
          direction: 'DESCENDING'
        }],
        limit: 100
      })
    })

    if (!response.ok) {
      console.warn('Notes search failed, trying associations API...')
      return await getHubSpotContactNotesViaAssociations(userId, contactId)
    }

    const data = await response.json()
    console.log('HubSpot contact notes:', data)
    return data.results || []
    
  } catch (error) {
    console.error('Error getting contact notes:', error)
    return await getHubSpotContactNotesViaAssociations(userId, contactId)
  }
}

async function getHubSpotContactNotesViaAssociations(userId: string, contactId: string) {
  const client = await getHubSpotClient(userId)
  
  try {
    const response = await fetch(`https://api.hubapi.com/crm/v4/objects/contacts/${contactId}/associations/notes`, {
      headers: {
        'Authorization': `Bearer ${client.accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      console.warn('Associations API also failed, returning empty notes')
      return []
    }

    const associationsData = await response.json()
    const noteIds = associationsData.results?.map((assoc: any) => assoc.toObjectId) || []

    if (noteIds.length === 0) {
      return []
    }

    const notePromises = noteIds.map(async (noteId: string) => {
      try {
        const noteResponse = await fetch(`https://api.hubapi.com/crm/v3/objects/notes/${noteId}?properties=hs_note_body,hs_created_by_user_id,createdate`, {
          headers: {
            'Authorization': `Bearer ${client.accessToken}`,
            'Content-Type': 'application/json',
          },
        })

        if (noteResponse.ok) {
          return await noteResponse.json()
        }
        return null
      } catch (error) {
        console.error(`Error getting note ${noteId}:`, error)
        return null
      }
    })

    const notes = await Promise.all(notePromises)
    return notes.filter(note => note !== null)
    
  } catch (error) {
    console.error('Error getting contact notes via associations:', error)
    return []
  }
}
