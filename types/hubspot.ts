interface HubSpotContact {
    id: string;
    properties: {
      firstname?: string;
      lastname?: string;
      email?: string;
      phone?: string;
      company?: string;
      createdate?: string;
      lastmodifieddate?: string;
    };
    createdAt?: string;
    updatedAt?: string;
  }
  
  interface HubSpotNote {
    id: string;
    properties?: {
      hs_note_body?: string;
      createdate?: string;
      hs_created_by_user_id?: string;
    };
    createdAt?: string;
  }
  
  interface ContactWithNotes {
    id: string;
    name: string;
    email: string;
    phone: string;
    company: string;
    createdAt?: string;
    lastModified?: string;
    notes: {
      id: string;
      content: string;
      createdAt?: string;
      createdBy?: string;
    }[];
    notesCount: number;
    notesError?: string;
  }
  
  interface GetContactsParameters {
    limit?: number;
    offset?: number;
    includeContactsWithoutNotes?: boolean;
  }
  
  interface HubSpotContactsResult {
    contacts: HubSpotContact[];
    total: number;
    hasMore: boolean;
  }
  
  interface ToolExecutionResult {
    success: boolean;
    description: string;
    data?: {
      contacts: ContactWithNotes[];
      contactsWithNotes: ContactWithNotes[];
      contactsWithoutNotes: ContactWithNotes[];
      contactsSummary: string;
      totalCount: number;
      notesCount: number;
      contactsWithNotesCount: number;
      contactsWithoutNotesCount: number;
      hasMore: boolean;
    };
    error?: string;
  }
  