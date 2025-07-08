import { pipeline } from '@xenova/transformers';
import { prisma } from './prisma';
import { Prisma } from '@prisma/client';

// Initialize the embedding model (free, runs locally)
let embedder: any = null;

async function initializeEmbedder() {
  if (!embedder) {
    console.log('Loading embedding model...');
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('Embedding model loaded!');
  }
  return embedder;
}

// Generate embeddings using Transformers.js (completely free)
async function generateEmbedding(text: string): Promise<number[]> {
  const model = await initializeEmbedder();
  const output = await model(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

// Enhanced Multi-provider LLM client with better error handling
class LLMClient {
  private providers: {
    name: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    headers: Record<string, string>;
  }[];

  constructor() {
    const potentialProviders = [
      {
        name: 'groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKey: process.env.GROQ_API_KEY || '',
        model: 'llama3-8b-8192',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        }
      },
      {
        name: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY || '',
        model: 'meta-llama/llama-3.1-8b-instruct:free',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
          'X-Title': 'Financial Advisor RAG'
        }
      },
    ];

    //@ts-ignore
    this.providers = potentialProviders.filter(provider => provider.apiKey && provider.apiKey.length > 0);
    
    if (this.providers.length === 0) {
      console.warn('No LLM providers configured! Please set API keys in environment variables.');
    }
  }

  async generateResponse(messages: any[], temperature: number = 0.7): Promise<string> {
    if (this.providers.length === 0) {
      throw new Error('No LLM providers available. Please configure API keys.');
    }

    const errors: string[] = [];

    for (const provider of this.providers) {
      try {
        console.log(`Trying ${provider.name}...`);
        
        const response = await fetch(`${provider.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: provider.headers,
          body: JSON.stringify({
            model: provider.model,
            messages: messages.map(msg => ({
              role: msg.role,
              content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
            })),
            max_tokens: 3000,
            temperature: Math.max(0.1, Math.min(1.0, temperature)),
            stream: false
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`${provider.name} API error:`, response.status, errorText);
          throw new Error(`${provider.name} API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        
        if (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
          console.log(`✅ Success with ${provider.name}`);
          return data.choices[0].message.content;
        } else {
          console.error(`Invalid response format from ${provider.name}:`, data);
          throw new Error(`Invalid response format from ${provider.name}`);
        }

      } catch (error) {
        const errorMsg = `${provider.name} failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(errorMsg);
        errors.push(errorMsg);
        continue;
      }
    }

    throw new Error(`All LLM providers failed:\n${errors.join('\n')}`);
  }

  getActiveProvider(): string {
    return this.providers.length > 0 ? this.providers[0].name : 'none';
  }
}

const llmClient = new LLMClient();

// Enhanced document embedding with better metadata extraction
export async function embedDocument(
  userId: string, 
  title: string, 
  content: string, 
  source: string, 
  sourceId: string, 
  metadata?: any
) {
  try {
    // Validate inputs
    if (!userId || !title || !content) {
      throw new Error('Missing required parameters for document embedding');
    }

    // Extract enhanced metadata safely
    const enhancedMetadata = {
      ...metadata,
      emails: extractEmails(content),
      contactIds: extractContactIds(content),
      names: extractNames(content),
      dates: extractDates(content),
      keywords: extractKeywords(content),
      sentiment: await analyzeSentiment(content),
      topics: await extractTopics(content),
      timestamp: new Date().toISOString(),
      contentLength: content.length,
      source: source
    };

    // Create document with enhanced metadata
    const document = await prisma.document.create({
      data: {
        userId,
        title,
        content,
        source,
        sourceId,
        metadata: enhancedMetadata,
      },
    });

    // Smart chunking based on content type
    const chunks = smartChunkContent(content, source, 1000);
    
    console.log(`Processing ${chunks.length} chunks for document: ${title}`);
    
    // Process chunks in batches to avoid overwhelming the system
    const batchSize = 5;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (chunk, index) => {
        const chunkIndex = i + index;
        console.log(`Processing chunk ${chunkIndex + 1}/${chunks.length}`);
        
        try {
          const embedding = await generateEmbedding(chunk.content);
          
          // Check if metadata column exists and insert accordingly
          const hasMetadataColumn = await checkMetadataColumn();
          
          if (hasMetadataColumn) {
            await prisma.$executeRaw`
              INSERT INTO vectors (id, "documentId", content, embedding, metadata)
              VALUES (${generateId()}, ${document.id}, ${chunk.content}, ${embedding}::vector, ${JSON.stringify(chunk.metadata)})
            `;
          } else {
            await prisma.$executeRaw`
              INSERT INTO vectors (id, "documentId", content, embedding)
              VALUES (${generateId()}, ${document.id}, ${chunk.content}, ${embedding}::vector)
            `;
          }
        } catch (error) {
          console.error(`Failed to process chunk ${chunkIndex + 1}:`, error);
          // Continue processing other chunks
        }
      }));
    }

    console.log(`Document embedded successfully: ${title}`);
    return document;
  } catch (error) {
    console.error('Document embedding failed:', error);
    throw error;
  }
}

// Enhanced search with multiple strategies - FIXED VERSION
export async function searchSimilarDocuments(
  userId: string, 
  query: string, 
  limit = 10,
  filters?: {
    source?: string;
    dateRange?: { start: Date; end: Date };
    contentType?: string;
    keywords?: string[];
  }
) {
  try {
    // Generate query embedding
    const queryEmbedding = await generateEmbedding(query);
    
    // Check if metadata column exists first
    const hasMetadataColumn = await checkMetadataColumn();

    // Build WHERE conditions properly
    let whereConditions = `d."userId" = ${userId}`;
    
    if (filters?.source) {
      whereConditions += ` AND d.source = '${filters.source}'`;
    }
    
    if (filters?.dateRange) {
      whereConditions += ` AND d."createdAt" BETWEEN '${filters.dateRange.start.toISOString()}' AND '${filters.dateRange.end.toISOString()}'`;
    }

    // Hybrid search: semantic + keyword + metadata (conditional)
    const results = hasMetadataColumn 
      ? await prisma.$queryRaw(
          Prisma.sql`
            SELECT 
              v.content, 
              v."documentId", 
              v.metadata as chunk_metadata,
              d.title, 
              d.source, 
              d.metadata as doc_metadata,
              d."createdAt",
              d."sourceId",
              (1 - (v.embedding <=> ${queryEmbedding}::vector)) as similarity,
              CASE 
                WHEN d.content ILIKE ${`%${query}%`} THEN 0.1
                ELSE 0 
              END as keyword_boost
            FROM vectors v
            JOIN documents d ON v."documentId" = d.id
            WHERE d."userId" = ${userId}
              ${filters?.source ? Prisma.sql`AND d.source = ${filters.source}` : Prisma.empty}
              ${filters?.dateRange ? Prisma.sql`AND d."createdAt" BETWEEN ${filters.dateRange.start} AND ${filters.dateRange.end}` : Prisma.empty}
            ORDER BY 
              (1 - (v.embedding <=> ${queryEmbedding}::vector)) + 
              CASE 
                WHEN d.content ILIKE ${`%${query}%`} THEN 0.1
                ELSE 0 
              END DESC
            LIMIT ${limit}
          `
        )
      : await prisma.$queryRaw(
          Prisma.sql`
            SELECT 
              v.content, 
              v."documentId", 
              NULL as chunk_metadata,
              d.title, 
              d.source, 
              d.metadata as doc_metadata,
              d."createdAt",
              d."sourceId",
              (1 - (v.embedding <=> ${queryEmbedding}::vector)) as similarity,
              CASE 
                WHEN d.content ILIKE ${`%${query}%`} THEN 0.1
                ELSE 0 
              END as keyword_boost
            FROM vectors v
            JOIN documents d ON v."documentId" = d.id
            WHERE d."userId" = ${userId}
              ${filters?.source ? Prisma.sql`AND d.source = ${filters.source}` : Prisma.empty}
              ${filters?.dateRange ? Prisma.sql`AND d."createdAt" BETWEEN ${filters.dateRange.start} AND ${filters.dateRange.end}` : Prisma.empty}
            ORDER BY 
              (1 - (v.embedding <=> ${queryEmbedding}::vector)) + 
              CASE 
                WHEN d.content ILIKE ${`%${query}%`} THEN 0.1
                ELSE 0 
              END DESC
            LIMIT ${limit}
          `
        );

    return results as Array<{
      content: string;
      documentId: string;
      chunk_metadata: any;
      title: string;
      source: string;
      doc_metadata: any;
      createdAt: Date;
      sourceId: string;
      similarity: number;
      keyword_boost: number;
    }>;
  } catch (error) {
    console.error('Search failed:', error);
    return [];
  }
}

// Check if metadata column exists in vectors table
async function checkMetadataColumn(): Promise<boolean> {
  try {
    await prisma.$queryRaw`
      SELECT metadata FROM vectors LIMIT 1
    `;
    return true;
  } catch (error) {
    console.log('Metadata column does not exist in vectors table');
    return false;
  }
}

// export async function generateRAGResponse(
//   userId: string, 
//   query: string, 
//   conversationHistory: any[] = [],
//   context?: {
//     triggerEvent?: string;
//     triggerData?: any;
//     isProactive?: boolean;
//   }
// ) {
//   try {
//     console.log('🚀 Starting RAG response generation for query:', query);
    
//     // Analyze query intent with enhanced detection
//     const intent = await analyzeQueryIntent(query);
//     console.log('📊 Query intent analysis:', intent);

//     // Search for relevant documents with intent-based filtering
//     const relevantDocs = await searchRelevantContext(userId, query, intent);
//     console.log('📄 Found relevant documents:', relevantDocs.length);
    
//     // Get ongoing instructions
//     const instructions = await prisma.ongoingInstruction.findMany({
//       where: { userId, isActive: true },
//       orderBy: { createdAt: 'desc' }
//     });

//     // Get recent conversation context
//     const recentMessages = await prisma.message.findMany({
//       where: { userId },
//       orderBy: { createdAt: 'desc' },
//       take: 10
//     });

//     // Get pending tasks
//     const pendingTasks = await prisma.task.findMany({
//       where: { 
//         userId, 
//         status: { in: ['pending', 'in_progress'] }
//       },
//       orderBy: { createdAt: 'desc' }
//     });

//     // Build comprehensive context
//     const contextSections = buildContextSections(relevantDocs, instructions, recentMessages, pendingTasks, context);

//     // Generate response with enhanced prompting
//     const systemPrompt = buildEnhancedSystemPrompt(contextSections, intent);
//     console.log('📝 System prompt created (length):', systemPrompt.length);
    
//     const messages = [
//       { role: 'system', content: systemPrompt },
//       ...conversationHistory.slice(-5), // Keep recent history
//       { role: 'user', content: query }
//     ];

//     console.log('💬 Sending messages to LLM...');
    
//     // Generate response with appropriate temperature based on intent
//     const temperature = intent.type === 'creative' ? 0.9 : 0.3;
//     const response = await llmClient.generateResponse(messages, temperature);
    
//     console.log('🤖 LLM response received (length):', response.length);
//     console.log('🤖 LLM response preview:', response.substring(0, 500) + '...');
    
//     // Parse and validate tool calls
//     const toolCalls = parseEnhancedToolCalls(response, intent);
//     console.log('🔧 Parsed tool calls:', toolCalls.length);
    
//     // Handle multi-step tool calls
//     const validatedToolCalls = await validateToolCalls(toolCalls, relevantDocs);
//     console.log('✅ Validated tool calls:', validatedToolCalls.length);
    
//     return {
//       content: response,
//       toolCalls: validatedToolCalls,
//       provider: llmClient.getActiveProvider(),
//       intent,
//       contextUsed: contextSections.summary
//     };

//   } catch (error) {
//     console.error('❌ RAG response generation failed:', error);
//     return {
//       content: "I apologize, but I'm having trouble processing your request right now. Please try again later.",
//       toolCalls: [],
//       provider: 'none',
//       intent: { type: 'unknown', confidence: 0 }
//     };
//   }
// }

export async function generateRAGResponse(
  userId: string, 
  query: string, 
  conversationHistory: any[] = [],
  context?: {
    triggerEvent?: string;
    triggerData?: any;
    isProactive?: boolean;
  }
) {
  try {
    console.log('🚀 Starting RAG response generation for query:', query);
    
    const intent = await analyzeQueryIntent(query);
    console.log('📊 Query intent analysis:', intent);

    const relevantDocs = await searchRelevantContext(userId, query, intent);
    console.log('📄 Found relevant documents:', relevantDocs.length);
    
    const instructions = await prisma.ongoingInstruction.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' }
    });

    const recentMessages = await prisma.message.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    const pendingTasks = await prisma.task.findMany({
      where: { 
        userId, 
        status: { in: ['pending', 'in_progress'] }
      },
      orderBy: { createdAt: 'desc' }
    });

    const contextSections = buildContextSections(relevantDocs, instructions, recentMessages, pendingTasks, context);

    const systemPrompt = buildEnhancedSystemPrompt(contextSections, intent);
    console.log('📝 System prompt created (length):', systemPrompt.length);
    
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.slice(-5),
      { role: 'user', content: query }
    ];

    console.log('💬 Sending messages to LLM...');
    
    const temperature = intent.type === 'creative' ? 0.9 : 0.3;
    const response = await llmClient.generateResponse(messages, temperature);
    
    console.log('🤖 LLM response received (length):', response.length);
    console.log('🤖 LLM response preview:', response.substring(0, 500) + '...');
    
    const toolCalls = parseEnhancedToolCalls(response, intent, query);
    console.log('🔧 Parsed tool calls:', toolCalls.length);
    
    const validatedToolCalls = await validateToolCalls(toolCalls, relevantDocs);
    console.log('✅ Validated tool calls:', validatedToolCalls.length);
    
    return {
      content: response,
      toolCalls: validatedToolCalls,
      provider: llmClient.getActiveProvider(),
      intent,
      contextUsed: contextSections.summary
    };

  } catch (error) {
    console.error('❌ RAG response generation failed:', error);
    return {
      content: "I apologize, but I'm having trouble processing your request right now. Please try again later.",
      toolCalls: [],
      provider: 'none',
      intent: { type: 'unknown', confidence: 0 }
    };
  }
}

// Analyze query intent for better response generation
async function analyzeQueryIntent(query: string) {
  const intentKeywords = {
    question: ['who', 'what', 'when', 'where', 'why', 'how', 'which', '?'],
    action: ['schedule', 'send', 'create', 'add', 'update', 'delete', 'call', 'email', 'book'],
    search: ['find', 'search', 'lookup', 'show', 'list', 'get', 'all', 'contacts', 'display', 'view'],
    analysis: ['analyze', 'compare', 'review', 'summarize', 'report'],
    creative: ['write', 'compose', 'draft', 'generate'],
    meeting: ['meeting', 'schedule', 'calendar', 'appointment', 'book', 'call', 'meet'],
    instruction: ['when', 'if', 'whenever', 'every time', 'please always', 'from now on', 'in the future', 'going forward'],
    notes: ['notes', 'note', 'history', 'details', 'information about', 'tell me about', 'what do you know about'],
    all_contacts_notes: ['all contacts notes', 'show all contacts notes', 'contacts with notes', 'all notes', 'everyone notes']
  };

  const queryLower = query.toLowerCase();
  const scores: any = {};

  for (const [type, keywords] of Object.entries(intentKeywords)) {
    scores[type] = keywords.filter(keyword => queryLower.includes(keyword)).length;
  }

  // Boost instruction score if it contains conditional patterns
  const conditionalPatterns = [
    /when\s+someone\s+emails/i,
    /if\s+.*\s+emails/i,
    /whenever\s+.*\s+contact/i,
    /every\s+time\s+.*\s+happens/i,
    /please\s+(always|create|add)/i,
    /from\s+now\s+on/i
  ];

  if (conditionalPatterns.some(pattern => pattern.test(query))) {
    scores.instruction = (scores.instruction || 0) + 5;
    console.log('📋 Conditional instruction pattern detected');
  }

  // Enhanced contact detection with more specific patterns
  const contactQueries = [
    'all contacts', 'show contacts', 'list contacts', 'get contacts',
    'display contacts', 'view contacts', 'show all contacts', 'list all contacts',
    'get all contacts', 'display all contacts', 'view all contacts',
    'contacts list', 'contact list', 'my contacts', 'hubspot contacts',
    'show me contacts', 'show me all contacts', 'list my contacts',
    'get my contacts', 'display my contacts', 'view my contacts'
  ];

  const isContactQuery = contactQueries.some(phrase => queryLower.includes(phrase));
  
  if (isContactQuery) {
    scores.search += 5; // Higher boost for contact queries
    console.log('🔍 Contact query detected:', query);
  }

  const contactNoteQueries = [
    'show notes for', 'get notes for', 'notes for', 'contact notes',
    'tell me about', 'what do you know about', 'information about',
    'history for', 'details for', 'show details for'
  ];
  
  const isContactNoteQuery = contactNoteQueries.some(phrase => queryLower.includes(phrase));
  
  if (isContactNoteQuery) {
    scores.notes += 3;
    console.log('📝 Contact notes query detected:', query);
  }

  const allContactsNotesQueries = [
    'all contacts notes', 'show all contacts notes', 'all contacts with notes',
    'contacts with notes', 'show me all notes', 'get all notes',
    'list all contacts notes', 'display all contacts notes',
    'show all notes for contacts', 'get notes for all contacts'
  ];
  
  const isAllContactsNotesQuery = allContactsNotesQueries.some(phrase => queryLower.includes(phrase));
  
  if (isAllContactsNotesQuery) {
    scores.all_contacts_notes += 5;
    console.log('📝 All contacts notes query detected:', query);
  }

  const meetingWithRegex = /(meet|schedule|book).*with.*\b([a-z]+ [a-z]+)\b/i;
  const meetingWithMatch = query.match(meetingWithRegex);
  
  if (meetingWithMatch) {
    scores.meeting += 3; // Big boost for "meet with [name]" patterns
    console.log('🤝 Meeting with contact detected:', meetingWithMatch[2]);
  }

  //@ts-ignore
  const maxScore = Math.max(...Object.values(scores));
  const intentType = Object.keys(scores).find(key => scores[key] === maxScore) || 'general';

  const result = {
    type: intentType,
    confidence: maxScore > 0 ? maxScore / queryLower.split(' ').length : 0.1,
    //@ts-ignore
    keywords: intentKeywords[intentType] || [],
    isContactQuery, // Add this flag
    contactQueryType: isContactQuery ? 'get_all_contacts' : null,
    isConditionalInstruction: intentType === 'instruction' // Add this flag
  };

  console.log('📊 Intent analysis result:', result);
  return result;
}

// Search for relevant context based on query and intent
async function searchRelevantContext(userId: string, query: string, intent: any) {
  const searches = [];

  // Always do semantic search
  searches.push(searchSimilarDocuments(userId, query, 5));

  // Add intent-specific searches
  if (intent.type === 'question') {
    // For questions, search more broadly
    searches.push(searchSimilarDocuments(userId, query, 3, { source: 'email' }));
    searches.push(searchSimilarDocuments(userId, query, 3, { source: 'hubspot' }));
  } else if (intent.type === 'action') {
    // For actions, focus on recent contacts and calendar
    searches.push(searchSimilarDocuments(userId, query, 5, { 
      dateRange: { start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), end: new Date() }
    }));
  } else if (intent.type === 'search') {
    // For search queries, especially contact-related ones
    searches.push(searchSimilarDocuments(userId, query, 3, { source: 'hubspot' }));
  }

  const results = await Promise.all(searches);
  return results.flat().slice(0, 15); // Limit total results
}

// Build context sections for the prompt
function buildContextSections(relevantDocs: any[], instructions: any[], recentMessages: any[], pendingTasks: any[], context?: any) {
  const sections = {
    documents: relevantDocs.map(doc => ({
      source: doc.source,
      title: doc.title,
      content: doc.content,
      metadata: doc.doc_metadata,
      similarity: doc.similarity,
      created: doc.createdAt
    })),
    instructions: instructions.map(inst => ({
      instruction: inst.instruction,
      created: inst.createdAt,
      priority: inst.priority || 'normal'
    })),
    recentContext: recentMessages.slice(0, 5).map(msg => ({
      role: msg.role,
      content: msg.content.substring(0, 200), // Limit length
      timestamp: msg.createdAt
    })),
    pendingTasks: pendingTasks.map(task => ({
      description: task.description,
      status: task.status,
      created: task.createdAt
    })),
    trigger: context?.triggerEvent ? {
      event: context.triggerEvent,
      data: context.triggerData,
      isProactive: context.isProactive
    } : null,
    summary: {
      totalDocuments: relevantDocs.length,
      totalInstructions: instructions.length,
      totalTasks: pendingTasks.length,
      hasRecentContext: recentMessages.length > 0
    }
  };

  return sections;
}

// Build enhanced system prompt - FIXED VERSION
// function buildEnhancedSystemPrompt(contextSections: any, intent: any) {
//   const currentDate = new Date().toISOString().split('T')[0];
//   const prompt = `You are an AI assistant for a financial advisor. You have access to comprehensive context about clients, emails, calendar events, and HubSpot data.

// AVAILABLE TOOLS:
// 1. send_email - Send emails to clients
// 2. create_calendar_event - Schedule meetings and appointments
// 3. schedule_meeting_with_contact - Schedule meeting with a specific contact (preferred over create_calendar_event when you know the contact name)
// 4. search_contacts - Find specific contacts in HubSpot
// 5. create_contact - Create new contacts in HubSpot
// 6. add_contact_note - Add notes to contacts
// 7. get_available_times - Check calendar availability
// 8. get_all_contacts - Retrieve all contacts from HubSpot
// 9. get_contact_notes - Retrieve notes and details for a specific contact
// 10. get_all_contacts_with_notes - Retrieve all contacts with their notes

// CURRENT DATE: ${currentDate}
//     When scheduling meetings, ALWAYS use dates in ${currentDate.split('-')[0]} or later.
//     Never suggest dates in past years.

// CRITICAL INSTRUCTION HANDLING:
// ${intent.isConditionalInstruction ? `
// ⚠️ CONDITIONAL INSTRUCTION DETECTED ⚠️
// This appears to be a FUTURE/CONDITIONAL instruction (e.g., "when X happens, do Y").
// DO NOT execute any tools with placeholder values.
// Instead, acknowledge the instruction and explain that you understand what to do when the condition is met.
// You should respond with something like:
// "I understand. When someone emails you who is not already in HubSpot, I will:
// 1. Create a new contact in HubSpot with their information
// 2. Add a note about the email they sent

// This instruction has been noted and I'll apply it when new emails arrive from unknown contacts."
// ` : ''}

// TOOL CALL INSTRUCTIONS:
// - NEVER use placeholder values like "[Email Address]", "[First Name]", etc.
// - Only execute tools when you have ACTUAL data to work with
// - For conditional/future instructions ("when X happens"), acknowledge and store the instruction without executing
// - When the user asks for "all contacts", "show contacts", "list contacts", or similar, use get_all_contacts
// - Always format tool calls as JSON objects with "tool" and "parameters" keys

// PARAMETER VALIDATION:
// - Email addresses must be real (contain @ and domain)
// - Names must not be placeholders or contain brackets
// - Dates must be valid ISO format or proper date strings
// - All required fields must have actual values, not placeholders

// EXAMPLE TOOL CALL FORMAT:
// \`\`\`json
// {
//   "tool": "create_contact",
//   "parameters": {
//     "email": "john.doe@example.com",
//     "firstName": "John",
//     "lastName": "Doe",
//     "company": "Example Corp",
//     "notes": "Met at conference, interested in portfolio management"
//   }
// }
// \`\`\`

// CRITICAL RULES:
// 1. NEVER execute tools with placeholder or example data
// 2. For future/conditional instructions, explain what you'll do without executing
// 3. ALWAYS verify the contact exists before scheduling
// 4. For contact queries, ALWAYS use the get_all_contacts tool
// 5. Include detailed responses along with tool calls
// 6. Default to retrieving comprehensive contact information

// CONTEXT SUMMARY:
// - Documents: ${contextSections.summary.totalDocuments}
// - Instructions: ${contextSections.summary.totalInstructions}
// - Tasks: ${contextSections.summary.totalTasks}
// - Recent Context: ${contextSections.summary.hasRecentContext}

// ${intent.isContactQuery ? `
// 🚨 CONTACT QUERY DETECTED 🚨
// This is a contact-related query. You MUST use the get_all_contacts tool to retrieve contacts.
// ` : ''}

// You should provide helpful responses and use the appropriate tools when needed.`;

//   return prompt;
// }

function buildEnhancedSystemPrompt(contextSections: any, intent: any) {
  const currentDate = new Date().toISOString().split('T')[0];
  const prompt = `You are an AI assistant for a financial advisor. You have access to comprehensive context about clients, emails, calendar events, and HubSpot data.

CRITICAL: NEVER GENERATE FAKE CONTACT DATA OR MALFORMED TOOL CALLS
- NEVER create fictional contacts like "Emily Chen", "David Lee", "John Smith"
- NEVER use placeholder names or emails
- NEVER generate example contact lists
- NEVER use malformed syntax like *tool_name parameters*
- ONLY provide contact information after tools have executed successfully
- If asking for contacts, simply use the appropriate tool and wait for results

FOR MEETING SCHEDULING:
- NEVER say "I've scheduled a meeting" unless you actually use a tool
- NEVER provide fake meeting confirmations
- ALWAYS use the schedule_meeting_with_contact tool for meetings with contacts
- NEVER respond with meeting details unless tools have executed successfully

AVAILABLE TOOLS:
1. send_email - Send emails to clients
2. create_calendar_event - Schedule meetings and appointments
3. schedule_meeting_with_contact - Schedule meeting with a specific contact (USE THIS for meeting with contacts)
4. search_contacts - Find specific contacts in HubSpot
5. create_contact - Create new contacts in HubSpot
6. add_contact_note - Add notes to contacts
7. get_contact_notes - Retrieve notes and details for a specific contact
8. get_all_contacts - Retrieve all contacts from HubSpot (without notes)
9. get_all_contacts_with_notes - Retrieve all contacts with their notes
10. get_available_times - Check calendar availability

CURRENT DATE: ${currentDate}
When scheduling meetings, ALWAYS use dates in ${currentDate.split('-')[0]} or later.

MEETING SCHEDULING RULES:
- For "schedule meeting with [contact name]", ALWAYS use schedule_meeting_with_contact tool
- NEVER use create_calendar_event for meetings with contacts
- Extract date and time properly from the query
- Format dates as YYYY-MM-DD and times as HH:MM format

TOOL CALL FORMAT (CRITICAL):
NEVER use asterisk syntax like *tool_name parameters*
ALWAYS use proper JSON format:

\`\`\`json
{
  "tool": "schedule_meeting_with_contact",
  "parameters": {
    "contactName": "Brian Halligan",
    "contactEmail: "br@hubspot.com",
    "date": "2025-07-16",
    "time": "12:00",
    "title": "Meeting with Brian Halligan",
    "description": "Scheduled meeting"
  }
}
\`\`\`

RESPONSE GUIDELINES:
- For meeting requests, execute the schedule_meeting_with_contact tool immediately
- NEVER provide meeting confirmations until tool execution completes
- Present real data naturally without exposing technical details
- Be conversational but never invent information

EXAMPLE RESPONSES:
User: "Schedule meeting with Brian on 16th July at 12pm"
Good: [Execute schedule_meeting_with_contact tool with proper JSON]
Bad: "*create_calendar_event Brian 16th July 12pm*"

${intent.isConditionalInstruction ? `
⚠️ CONDITIONAL INSTRUCTION DETECTED ⚠️
This appears to be a FUTURE/CONDITIONAL instruction (e.g., "when X happens, do Y").
Acknowledge the instruction naturally without mentioning tools or technical details.
` : ''}

TOOL EXECUTION RULES:
- Execute tools silently without mentioning them
- NEVER use placeholder values
- Only execute tools when you have ACTUAL data to work with
- Present results naturally as if you inherently know the information
- For meeting scheduling, ALWAYS verify the contact exists and extract proper date/time

CONTEXT SUMMARY:
- Documents: ${contextSections.summary.totalDocuments}
- Instructions: ${contextSections.summary.totalInstructions}
- Tasks: ${contextSections.summary.totalTasks}
- Recent Context: ${contextSections.summary.hasRecentContext}

${intent.isContactQuery ? `
🚨 CONTACT QUERY DETECTED 🚨
This is a contact-related query. Use the appropriate get_ tool and present real data only.
` : ''}

Respond helpfully using real data only and proper tool call syntax. You must use tools for all actions. Never fake responses.`;


  return prompt;
}

function parseEnhancedToolCalls(response: string, intent?: any, query?: string) {
  console.log('🔍 Parsing response for tool calls...');
  
  const toolCalls = [];
  
  // Check if the response is explanatory/instructional rather than containing actual tool calls
  const isInstructionalResponse = response.includes("I'll use") || 
                                  response.includes("I'll retrieve") ||
                                  response.includes("Please wait") ||
                                  response.includes("Here's the tool call:") ||
                                  response.includes("tool call:") ||
                                  response.includes("I'll execute");

  if (isInstructionalResponse) {
    console.log('⚠️ Response appears to be instructional, limiting tool call extraction');
  }
  
  // First check if the response itself contains a tool response (not a tool call)
  // This happens when the LLM mistakenly includes the expected response format
  if (response.includes('"tool":') && response.includes('"response":')) {
    console.log('⚠️ Response contains tool response format, not a tool call');
    // Extract just the tool call part
    const toolMatch = response.match(/{\s*"tool":\s*"([^"]+)"\s*,\s*"parameters":\s*({[^}]*})/);
    if (toolMatch) {
      try {
        const toolName = toolMatch[1];
        const parameters = JSON.parse(toolMatch[2]);
        toolCalls.push({
          name: toolName,
          parameters: parameters
        });
        console.log('✅ Extracted tool call from response format:', toolName);
      } catch (error) {
        console.error('❌ Failed to extract tool call from response format');
      }
    }
  }
  
  // Look for JSON blocks
  const jsonBlocks = response.match(/```json\n([\s\S]*?)\n```/g) || [];
  console.log('Found JSON blocks:', jsonBlocks.length);
  
  for (const block of jsonBlocks) {
    try {
      const cleanJson = block.replace(/```json\n|\n```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      
      // Skip if this appears to be an example or explanation in an instructional response
      if (isInstructionalResponse && (
          response.includes("Here's the tool call:") || 
          response.includes("I'll use") ||
          response.includes("tool call:")
        )) {
        console.log('⚠️ Skipping JSON block that appears to be explanatory in instructional response');
        continue;
      }
      
      // Check if this is a tool call (has "tool" and "parameters")
      if (parsed.tool && parsed.parameters) {
        console.log('✅ Valid tool call found in JSON block:', parsed.tool);
        toolCalls.push({
          name: parsed.tool,
          parameters: parsed.parameters
        });
      }
      // Skip if it has "response" field (it's showing expected output, not a tool call)
      else if (parsed.response) {
        console.log('⚠️ Skipping JSON block with response field');
      }
    } catch (error) {
      console.error('❌ Failed to parse JSON block:', error);
    }
  }
  
  // Look for inline tool calls if no JSON blocks found or if we need more
  if (toolCalls.length === 0) {
    // Updated patterns to better match tool calls
    const inlinePatterns = [
      /\{\s*"tool":\s*"([^"]+)"\s*,\s*"parameters":\s*\{[^}]*\}\s*\}/g,
      /\{\s*"tool":\s*"([^"]+)"\s*,\s*"parameters":\s*\{[\s\S]*?\}\s*\}/g
    ];
    
    for (const pattern of inlinePatterns) {
      const matches = response.match(pattern) || [];
      console.log(`Found inline matches: ${matches.length}`);
      
      for (const match of matches) {
        try {
          // Skip if it contains "response" field
          if (match.includes('"response"')) {
            console.log('⚠️ Skipping match with response field');
            continue;
          }
          
          // Skip if it's in an instructional context
          if (isInstructionalResponse && (
              response.includes("Here's the tool call:") ||
              response.includes("I'll use")
            )) {
            console.log('⚠️ Skipping inline match that appears to be explanatory');
            continue;
          }
          
          const parsed = JSON.parse(match);
          if (parsed.tool && parsed.parameters) {
            console.log('✅ Valid inline tool call found:', parsed.tool);
            toolCalls.push({
              name: parsed.tool,
              parameters: parsed.parameters
            });
          }
        } catch (error) {
          console.error('❌ Failed to parse inline tool call:', error);
        }
      }
    }
  }

  // PRESERVED: Only add tool calls if no valid tool calls were found AND we have the required context
  if (toolCalls.length === 0 && query && intent) {
    // Handle contact queries
    if (intent.isContactQuery) {
      console.log('🔧 No tool calls found but contact query detected - forcing get_all_contacts');
      toolCalls.push({
        name: 'get_all_contacts',
        parameters: {
          limit: 100,
          offset: 0
        }
      });
    }

    // Handle all contacts notes queries with proper detection
    if (intent.type === 'all_contacts_notes') {
      console.log('🔧 All contacts notes intent detected - generating get_all_contacts_with_notes tool call');
      toolCalls.push({
        name: 'get_all_contacts_with_notes',
        parameters: {
          limit: 50,
          includeContactsWithoutNotes: query.toLowerCase().includes('all contacts')
        }
      });
    }
    
    // Additional check for all contacts notes queries that might not be caught by intent
    const queryLower = query.toLowerCase();

    const claimsToolExecution = response.includes("I've executed") || 
                               response.includes("I have executed") ||
                               response.includes("executed the") ||
                               response.includes("tool to schedule") ||
                               response.includes("meeting has been") ||
                               response.includes("successfully scheduled") ||
                               response.includes("I've sent") ||
                               response.includes("email has been sent") ||
                               response.includes("Event created and invitation sent") || 
                               response.includes("Here is the email") || response.includes("event has been created");
    
    const isEmailQuery = queryLower.includes('send') && (queryLower.includes('email') || queryLower.includes('message'));
    
    if (claimsToolExecution && isEmailQuery) {
      console.log('🚨 LLM CLAIMS EMAIL TOOL EXECUTION BUT NO TOOL CALLS - FORCING');
      
      // Extract recipient from query
      const recipientMatch = query.match(/(?:send.*email.*to|email.*to|message.*to)\s+([A-Za-z\s]+?)(?:\s+about|\s+regarding|$)/i);
      
      if (recipientMatch) {
        const recipientName = recipientMatch[1].trim();
        console.log('🔧 Force-extracted recipient:', recipientName);
        
        // Extract subject from query
        const subjectMatch = query.match(/(?:about|regarding)\s+(.+?)(?:\s*$)/i);
        const subject = subjectMatch ? subjectMatch[1].trim() : 'Follow-up';
        
        // Extract email content from LLM response if available
        let emailBody = 'Please see the message below.';
        
        // Try to extract the email content from the LLM response
        const emailContentMatch = response.match(/Dear\s+\w+,[\s\S]*?Best regards/i) ||
                                 response.match(/Subject:.*?\n\n([\s\S]*?)(?:\n\nBest|$)/i) ||
                                 response.match(/Here is the email:\s*\n\n([\s\S]*?)(?:\n\n|$)/i);
        
        if (emailContentMatch) {
          emailBody = emailContentMatch[0] || emailContentMatch[1] || emailBody;
          emailBody = emailBody.replace(/^Subject:.*?\n\n/i, '').trim();
          console.log('🔧 Extracted email body from response');
        }
        
        toolCalls.push({
          name: 'send_email',
          parameters: {
            contactName: recipientName,
            subject: subject,
            body: emailBody
          }
        });
        
        console.log('✅ Force-generated email tool call');
      }
    }

    const isAvailabilityQuery = (queryLower.includes('availability') || queryLower.includes('available')) ||
                               (queryLower.includes('calendar') && (queryLower.includes('check') || queryLower.includes('show'))) ||
                               queryLower.includes('free time') ||
                               queryLower.includes('schedule') && queryLower.includes('on');
    
    if (claimsToolExecution && isAvailabilityQuery) {
      console.log('🚨 LLM CLAIMS AVAILABILITY TOOL EXECUTION BUT NO TOOL CALLS - FORCING');
      
      // Extract date from query
      const dateMatch = query.match(/(?:on\s+)?(\d{1,2}(?:st|nd|rd|th)?\s+\w+(?:\s+\d{4})?)/i) ||
                       query.match(/(\d{4}-\d{2}-\d{2})/i) ||
                       query.match(/(today|tomorrow|this week|next week)/i);
      
      let dateParam = '';
      if (dateMatch) {
        dateParam = dateMatch[1];
        console.log('🔧 Force-extracted date:', dateParam);
      }
      
      toolCalls.push({
        name: 'get_available_times',
        parameters: {
          date: dateParam,
          duration: 60 // Default 1 hour slots
        }
      });
      
      console.log('✅ Force-generated availability tool call');
    }
    // Check if it's a meeting scheduling query
    const isMeetingSchedulingQuery = (queryLower.includes('schedule') && queryLower.includes('meeting')) ||
                                    queryLower.includes('book meeting') ||
                                    queryLower.includes('set up meeting');
    
    if (claimsToolExecution && isMeetingSchedulingQuery) {
      console.log('🚨 LLM CLAIMS TOOL EXECUTION BUT NO TOOL CALLS FOUND - FORCING GENERATION');
      
      // Extract contact name from query
      const contactMatch = query.match(/(?:schedule.*meeting.*with|meet.*with|meeting.*with)\s+([A-Za-z\s]+?)(?:\s+on|\s+at|\s+for|$)/i);
      
      if (contactMatch) {
        const contactName = contactMatch[1].trim();
        console.log('🔧 Force-extracted contact name:', contactName);
        
        // Extract date if present
        const dateMatch = query.match(/(?:on\s+|for\s+)?(\d{1,2}(?:st|nd|rd|th)?\s+\w+(?:\s+\d{4})?)/i);
        const timeMatch = query.match(/(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
        
        const toolCallParams: any = {
          contactName: contactName,
          title: `Meeting with ${contactName}`,
          description: 'Scheduled meeting'
        };
        
        if (dateMatch) {
          toolCallParams.date = dateMatch[1];
          console.log('🔧 Force-extracted date:', dateMatch[1]);
        }
        
        if (timeMatch) {
          toolCallParams.time = timeMatch[1];
          console.log('🔧 Force-extracted time:', timeMatch[1]);
        }
        
        toolCalls.push({
          name: 'schedule_meeting_with_contact',
          parameters: toolCallParams
        });
        
        console.log('✅ Force-generated tool call:', toolCalls[0]);
      }
    }
    const isFakeMeetingResponse = response.includes("I've scheduled") || 
                                  response.includes("Meeting with") ||
                                  response.includes("Date:") ||
                                  response.includes("Time:");
    
    if (isFakeMeetingResponse && queryLower.includes('schedule') && queryLower.includes('meeting')) {
      console.log('🚨 DETECTED FAKE MEETING RESPONSE - FORCING TOOL CALL');
      
      // Extract contact name from query
      const contactMatch = query.match(/(?:schedule.*meeting.*with|meet.*with)\s+([A-Za-z\s]+?)(?:\s+on|\s+at|$)/i);
      
      if (contactMatch) {
        const contactName = contactMatch[1].trim();
        console.log('🔧 Extracted contact name:', contactName);
        
        // Only add if no existing tool calls
        toolCalls.push({
          name: 'schedule_meeting_with_contact',
          parameters: {
            contactName: contactName,
            title: `Meeting with ${contactName}`,
            description: 'Scheduled meeting'
          }
        });
        
        console.log('✅ Force-generated tool call for meeting scheduling');
      }
    }

    const allContactsNotesQueries = [
      'all contacts notes', 'show all contacts notes', 'all contacts with notes',
      'contacts with notes', 'show me all notes', 'get all notes',
      'list all contacts notes', 'display all contacts notes',
      'show all notes for contacts', 'get notes for all contacts',
      'show contacts and their notes', 'contacts and notes',
      'show all my contacts and their notes', 'can you show all my contacts and their notes'
    ];
    
    const isAllContactsNotesQuery = allContactsNotesQueries.some(phrase => queryLower.includes(phrase));
    
    if (isAllContactsNotesQuery && !toolCalls.some(call => call.name === 'get_all_contacts_with_notes')) {
      console.log('🔧 All contacts notes query pattern detected - generating get_all_contacts_with_notes tool call');
      toolCalls.push({
        name: 'get_all_contacts_with_notes',
        parameters: {
          limit: 50,
          includeContactsWithoutNotes: queryLower.includes('all contacts')
        }
      });
    }
  }
  
  console.log('🎯 Final tool calls:', toolCalls);
  return toolCalls;
}

async function validateToolCalls(toolCalls: any[], relevantDocs: any[]) {
  const validatedCalls = [];
  
  for (const call of toolCalls) {
    const validation = await validateSingleToolCall(call, relevantDocs);
    if (validation.valid) {
      validatedCalls.push(call);
    } else {
      console.warn(`Invalid tool call: ${validation.reason}`, call);
    }
  }
  
  return validatedCalls;
}

function replaceCommonPlaceholders(emailBody: string): string {
  const userName = "Your Financial Advisor";
  
  let processedBody = emailBody
    .replace(/\[Your Name\]/gi, userName)
    .replace(/\[topic\]/gi, "our upcoming meeting")
    .replace(/\[date\]/gi, new Date().toLocaleDateString())
    .replace(/\[time\]/gi, new Date().toLocaleTimeString());
  
  return processedBody;
}

async function validateSingleToolCall(toolCall: any, relevantDocs: any[]) {
  const { name, parameters } = toolCall;
  
  // Special handling for get_all_contacts and get_all_contacts_with_notes
  if (name === 'get_all_contacts' || name === 'get_all_contacts_with_notes') {
    if (parameters.includeProperties && !Array.isArray(parameters.includeProperties)) {
      return { valid: false, reason: 'includeProperties must be an array' };
    }
    if (parameters.limit && (typeof parameters.limit !== 'number' || parameters.limit < 1)) {
      return { valid: false, reason: 'limit must be a positive number' };
    }
    if (parameters.offset && (typeof parameters.offset !== 'number' || parameters.offset < 0)) {
      return { valid: false, reason: 'offset must be a non-negative number' };
    }
    return { valid: true };
  }
  
  // Enhanced placeholder detection for other tools
  const paramString = JSON.stringify(parameters);
  const placeholderPatterns = [
    /\[.*?\]/g,  // Matches [anything]
    /<.*?>/g,    // Matches <anything>
    /placeholder/i,
    /example\.com/i,
    /your_/i,
    /YOUR_/i,
    /\[Email Address\]/i,
    /\[First Name\]/i,
    /\[Last Name\]/i,
    /\[Company Name\]/i,
    /\[Date\]/i,
    /\[Subject\]/i,
    /\[Your Name\]/i
  ];
  
  const safeFields = ['includeProperties', 'limit', 'offset', 'properties', 'contactName', 'title', 'description'];
  const filteredParams = Object.entries(parameters).reduce((acc, [key, value]) => {
    if (!safeFields.includes(key)) {
      acc[key] = value;
    }
    return acc;
  }, {} as any);
  
  const filteredParamString = JSON.stringify(filteredParams);
  
  const criticalPlaceholders = [
    /\[Email Address\]/i,
    /\[First Name\]/i,
    /\[Last Name\]/i,
    /\[Company Name\]/i,
    /placeholder/i,
    /example\.com/i
  ];
  
  // Only check critical placeholders for the 'to' field (email sending)
  const hasCtriticalPlaceholdersInTo = criticalPlaceholders.some(pattern => 
    pattern.test(parameters.to || '')
  );
  
  if (hasCtriticalPlaceholdersInTo) {
    return { valid: false, reason: 'Email recipient contains placeholder values' };
  }
  
  // Validate specific tool requirements
  switch (name) {
    case 'send_email':
      // Check for either 'to' (email) or 'contactName' parameter
      if (!parameters.to && !parameters.contactName) {
        return { valid: false, reason: 'Missing email address or contact name' };
      }
      
      // If 'to' is provided, validate it's an email
      if (parameters.to && !parameters.to.includes('@')) {
        return { valid: false, reason: 'Invalid email address format' };
      }
      
      // If contactName is provided, that's also valid (system will resolve to email)
      if (parameters.contactName && typeof parameters.contactName !== 'string') {
        return { valid: false, reason: 'Contact name must be a string' };
      }
      
      if (!parameters.subject || parameters.subject.trim().length === 0) {
        return { valid: false, reason: 'Missing email subject' };
      }
      if (!parameters.body || parameters.body.trim().length === 0) {
        return { valid: false, reason: 'Missing email body' };
      }

      if (parameters.body.includes('[Your Name]') || parameters.body.includes('[topic]')) {
        parameters.body = replaceCommonPlaceholders(parameters.body);
        console.log('📝 Auto-replaced placeholders in email body');
      }
      break;
      
    case 'create_calendar_event':
      if (!parameters.title || parameters.title.trim().length === 0) {
        return { valid: false, reason: 'Missing event title' };
      }
      try {
        new Date(parameters.start);
        new Date(parameters.end);
      } catch (error) {
        return { valid: false, reason: 'Invalid date format' };
      }
      break;
      
    case 'schedule_meeting_with_contact':
      // FIXED: Accept both contactEmail and contactName
      if (!parameters.contactEmail && !parameters.contactName) {
        return { valid: false, reason: 'Missing contact identifier (contactEmail or contactName)' };
      }
      
      // If contactEmail is provided, validate it
      if (parameters.contactEmail && !parameters.contactEmail.includes('@')) {
        return { valid: false, reason: 'Invalid contact email format' };
      }
      
      // If contactName is provided, that's valid too
      if (parameters.contactName && typeof parameters.contactName !== 'string') {
        return { valid: false, reason: 'Contact name must be a string' };
      }
      
      // Date/time validation is optional - function will use defaults
      const hasStartEnd = parameters.start && parameters.end;
      const hasDateTime = parameters.date && parameters.time;
      
      if (hasStartEnd) {
        try {
          new Date(parameters.start);
          new Date(parameters.end);
        } catch (error) {
          return { valid: false, reason: 'Invalid start/end date format' };
        }
      }
      
      if (hasDateTime && parameters.date) {
        // Validate date format if provided (but it's optional)
        if (typeof parameters.date !== 'string') {
          return { valid: false, reason: 'Date must be a string' };
        }
      }
      break;
      
    case 'add_contact_note':
      if (!parameters.contactId && !parameters.email && !parameters.contactName) {
        return { valid: false, reason: 'Missing contact identifier (contactId, email, or contactName)' };
      }
      if (!parameters.note || parameters.note.trim().length === 0) {
        return { valid: false, reason: 'Missing note content' };
      }
      break;
      
    case 'search_contacts':
      if (!parameters.query && !parameters.email && !parameters.name) {
        return { valid: false, reason: 'Missing search criteria (query, email, or name)' };
      }
      break;
      
    case 'create_contact':
      // Enhanced validation for create_contact
      if (!parameters.email || !parameters.email.includes('@')) {
        return { valid: false, reason: 'Invalid or missing email address' };
      }
      
      // Check if email looks like a placeholder
      if (parameters.email.includes('[') || parameters.email.includes(']')) {
        return { valid: false, reason: 'Email contains placeholder brackets' };
      }
      
      // Check for example.com domain
      if (parameters.email.includes('example.com')) {
        return { valid: false, reason: 'Email contains example domain' };
      }
      
      if (!parameters.firstName && !parameters.lastName) {
        return { valid: false, reason: 'Missing both first and last name' };
      }
      
      // Check if names look like placeholders
      if ((parameters.firstName && (parameters.firstName.includes('[') || parameters.firstName.includes(']'))) ||
          (parameters.lastName && (parameters.lastName.includes('[') || parameters.lastName.includes(']')))) {
        return { valid: false, reason: 'Names contain placeholder brackets' };
      }
      break;
      
    default:
      console.warn(`Unknown tool: ${name}`);
      return { valid: true }; // Allow unknown tools to pass through
  }
  
  return { valid: true };
}

// async function validateSingleToolCall(toolCall: any, relevantDocs: any[]) {
//   const { name, parameters } = toolCall;
  
//   if (name === 'get_all_contacts') {

//     if (parameters.includeProperties && !Array.isArray(parameters.includeProperties)) {
//       return { valid: false, reason: 'includeProperties must be an array' };
//     }
//     if (parameters.limit && (typeof parameters.limit !== 'number' || parameters.limit < 1)) {
//       return { valid: false, reason: 'limit must be a positive number' };
//     }
//     if (parameters.offset && (typeof parameters.offset !== 'number' || parameters.offset < 0)) {
//       return { valid: false, reason: 'offset must be a non-negative number' };
//     }
//     return { valid: true };
//   }
  
//   const paramString = JSON.stringify(parameters);
//   const placeholderPatterns = [
//     /\[.*?\]/g,  // Matches [anything]
//     /<.*?>/g,    // Matches <anything>
//     /placeholder/i,
//     /example\.com/i, // Add this to catch example domains
//     /your_/i,
//     /YOUR_/i,
//     /\[Email Address\]/i,
//     /\[First Name\]/i,
//     /\[Last Name\]/i,
//     /\[Company Name\]/i,
//     /\[Date\]/i,
//     /\[Subject\]/i,
//     /\[Your Name\]/i
//   ];
  
//   const safeFields = ['includeProperties', 'limit', 'offset', 'properties'];
//   const filteredParams = Object.entries(parameters).reduce((acc, [key, value]) => {
//     if (!safeFields.includes(key)) {
//       acc[key] = value;
//     }
//     return acc;
//   }, {} as any);
  
//   const filteredParamString = JSON.stringify(filteredParams);
  
//   const criticalPlaceholders = [
//     /\[Email Address\]/i,
//     /\[First Name\]/i,
//     /\[Last Name\]/i,
//     /\[Company Name\]/i,
//     /placeholder/i,
//     /example\.com/i
//   ];
  
//   // Only check critical placeholders for the 'to' field
//   const hasCtriticalPlaceholdersInTo = criticalPlaceholders.some(pattern => 
//     pattern.test(parameters.to || '')
//   );
  
//   if (hasCtriticalPlaceholdersInTo) {
//     return { valid: false, reason: 'Email recipient contains placeholder values' };
//   }
  
//   // Validate specific tool requirements
//   switch (name) {
//     case 'send_email':
//       // Check for either 'to' (email) or 'contactName' parameter
//       if (!parameters.to && !parameters.contactName) {
//         return { valid: false, reason: 'Missing email address or contact name' };
//       }
      
//       // If 'to' is provided, validate it's an email
//       if (parameters.to && !parameters.to.includes('@')) {
//         return { valid: false, reason: 'Invalid email address format' };
//       }
      
//       // If contactName is provided, that's also valid (system will resolve to email)
//       if (parameters.contactName && typeof parameters.contactName !== 'string') {
//         return { valid: false, reason: 'Contact name must be a string' };
//       }
      
//       if (!parameters.subject || parameters.subject.trim().length === 0) {
//         return { valid: false, reason: 'Missing email subject' };
//       }
//       if (!parameters.body || parameters.body.trim().length === 0) {
//         return { valid: false, reason: 'Missing email body' };
//       }

//       if (parameters.body.includes('[Your Name]') || parameters.body.includes('[topic]')) {
//         // Option: Auto-replace these placeholders
//         parameters.body = replaceCommonPlaceholders(parameters.body);
//         console.log('📝 Auto-replaced placeholders in email body');
//       }
//       break;
      
//     case 'create_calendar_event':
//       if (!parameters.title || parameters.title.trim().length === 0) {
//         return { valid: false, reason: 'Missing event title' };
//       }
//       if (!parameters.start || !parameters.end) {
//         return { valid: false, reason: 'Missing event start or end time' };
//       }
//       // Validate date format
//       try {
//         new Date(parameters.start);
//         new Date(parameters.end);
//       } catch (error) {
//         return { valid: false, reason: 'Invalid date format' };
//       }
//       break;
      
//     case 'schedule_meeting_with_contact':
//       if (!parameters.contactEmail || typeof parameters.contactEmail !== 'string') {
//         return { valid: false, reason: 'Missing or invalid contact email' };
//       }
      
//       // Check for either start/end OR date/time parameters
//       const hasStartEnd = parameters.start && parameters.end;
//       const hasDateTime = parameters.date && parameters.time;
      
//       if (!hasStartEnd && !hasDateTime) {
//         return { valid: false, reason: 'Missing timing information - need either start/end times or date/time' };
//       }
      
//       // Validate date formats if provided
//       if (hasStartEnd) {
//         try {
//           new Date(parameters.start);
//           new Date(parameters.end);
//         } catch (error) {
//           return { valid: false, reason: 'Invalid start/end date format' };
//         }
//       }
      
//       if (hasDateTime) {
//         // Validate date format (YYYY-MM-DD)
//         if (!/^\d{4}-\d{2}-\d{2}$/.test(parameters.date)) {
//           return { valid: false, reason: 'Invalid date format - use YYYY-MM-DD' };
//         }
//       }
//       break;
      
//     case 'add_contact_note':
//       if (!parameters.contactId && !parameters.email && !parameters.contactName) {
//         return { valid: false, reason: 'Missing contact identifier (contactId, email, or contactName)' };
//       }
//       if (!parameters.note || parameters.note.trim().length === 0) {
//         return { valid: false, reason: 'Missing note content' };
//       }
//       break;
      
//     case 'search_contacts':
//       if (!parameters.query && !parameters.email && !parameters.name) {
//         return { valid: false, reason: 'Missing search criteria (query, email, or name)' };
//       }
//       break;
      
//     case 'create_contact':
//       // Enhanced validation for create_contact
//       if (!parameters.email || !parameters.email.includes('@')) {
//         return { valid: false, reason: 'Invalid or missing email address' };
//       }
      
//       // Check if email looks like a placeholder
//       if (parameters.email.includes('[') || parameters.email.includes(']')) {
//         return { valid: false, reason: 'Email contains placeholder brackets' };
//       }
      
//       // Check for example.com domain
//       if (parameters.email.includes('example.com')) {
//         return { valid: false, reason: 'Email contains example domain' };
//       }
      
//       if (!parameters.firstName && !parameters.lastName) {
//         return { valid: false, reason: 'Missing both first and last name' };
//       }
      
//       // Check if names look like placeholders
//       if ((parameters.firstName && (parameters.firstName.includes('[') || parameters.firstName.includes(']'))) ||
//           (parameters.lastName && (parameters.lastName.includes('[') || parameters.lastName.includes(']')))) {
//         return { valid: false, reason: 'Names contain placeholder brackets' };
//       }
//       break;
      
//     default:
//       console.warn(`Unknown tool: ${name}`);
//       return { valid: true }; // Allow unknown tools to pass through
//   }
  
//   return { valid: true };
// }

async function storeOngoingInstruction(userId: string, instruction: string) {
  return await prisma.ongoingInstruction.create({
    data: {
      userId,
      instruction,
      isActive: true,
    }
  });
}

// Smart chunking based on content type
function smartChunkContent(content: string, source: string, chunkSize: number) {
  const chunks = [];
  
  if (source === 'email') {
    // For emails, try to keep headers and body together
    const emailParts = content.split('\n\n');
    let currentChunk = '';
    
    for (const part of emailParts) {
      if (currentChunk.length + part.length > chunkSize) {
        if (currentChunk) {
          chunks.push({
            content: currentChunk,
            metadata: { type: 'email_section', source }
          });
        }
        currentChunk = part;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + part;
      }
    }
    
    if (currentChunk) {
      chunks.push({
        content: currentChunk,
        metadata: { type: 'email_section', source }
      });
    }
  } else {
    // Standard chunking for other content
    for (let i = 0; i < content.length; i += chunkSize) {
      chunks.push({
        content: content.slice(i, i + chunkSize),
        metadata: { type: 'standard_chunk', source }
      });
    }
  }
  
  return chunks;
}

// Helper functions for metadata extraction
function extractEmails(text: string): string[] {
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  return text.match(emailRegex) || [];
}

function extractContactIds(text: string): string[] {
  const contactIdRegex = /contact[_\s]?id[:\s]*(\d+)/gi;
  const matches = text.match(contactIdRegex) || [];
  return matches.map(match => match.replace(/\D/g, ''));
}

function extractNames(text: string): string[] {
  // Simple name extraction - could be enhanced with NLP
  const nameRegex = /\b[A-Z][a-z]+ [A-Z][a-z]+\b/g;
  return text.match(nameRegex) || [];
}

function extractDates(text: string): string[] {
  const dateRegex = /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g;
  return text.match(dateRegex) || [];
}

function extractKeywords(text: string): string[] {
  // Extract important keywords (simple version)
  const keywords = [];
  const financialTerms = ['stock', 'bond', 'portfolio', 'investment', 'dividend', 'return', 'risk', 'market'];
  
  for (const term of financialTerms) {
    if (text.toLowerCase().includes(term)) {
      keywords.push(term);
    }
  }
  
  return keywords;
}

async function analyzeSentiment(text: string): Promise<string> {
  // Simple sentiment analysis - could be enhanced with actual ML
  const positiveWords = ['good', 'great', 'excellent', 'happy', 'satisfied'];
  const negativeWords = ['bad', 'terrible', 'unhappy', 'disappointed', 'frustrated'];
  
  const textLower = text.toLowerCase();
  const positiveCount = positiveWords.filter(word => textLower.includes(word)).length;
  const negativeCount = negativeWords.filter(word => textLower.includes(word)).length;
  
  if (positiveCount > negativeCount) return 'positive';
  if (negativeCount > positiveCount) return 'negative';
  return 'neutral';
}

async function extractTopics(text: string): Promise<string[]> {
  // Simple topic extraction - could be enhanced with actual NLP
  const topics = [];
  const topicKeywords = {
    'investment': ['invest', 'stock', 'bond', 'portfolio'],
    'retirement': ['retirement', 'pension', '401k', 'ira'],
    'insurance': ['insurance', 'coverage', 'policy'],
    'tax': ['tax', 'deduction', 'refund'],
    'meeting': ['meeting', 'appointment', 'schedule', 'calendar'],
    'contacts': ['contact', 'client', 'customer', 'lead']
  };
  
  const textLower = text.toLowerCase();
  
  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    if (keywords.some(keyword => textLower.includes(keyword))) {
      topics.push(topic);
    }
  }
  
  return topics;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Proactive analysis for webhook events
export async function analyzeProactiveAction(
  userId: string,
  eventType: string,
  eventData: any
) {
  try {
    const instructions = await prisma.ongoingInstruction.findMany({
      where: { userId, isActive: true },
    });

    if (instructions.length === 0) {
      return null;
    }

    const contextPrompt = `
EVENT: ${eventType}
EVENT DATA: ${JSON.stringify(eventData)}

ONGOING INSTRUCTIONS:
${instructions.map(inst => `- ${inst.instruction}`).join('\n')}

Should I take any proactive action based on this event and the ongoing instructions?
If yes, respond with the appropriate tool call in JSON format.
If no, respond with "NO_ACTION".
    `;

    const response = await llmClient.generateResponse([
      { role: 'user', content: contextPrompt }
    ], 0.3);

    if (response.includes('NO_ACTION')) {
      return null;
    }

    const toolCalls = parseEnhancedToolCalls(response);
    return toolCalls.length > 0 ? toolCalls[0] : null;

  } catch (error) {
    console.error('Proactive analysis failed:', error);
    return null;
  }
}

export async function testContactQueryDetection() {
  const testQueries = [
    'show all contacts',
    'list all contacts',
    'get all contacts',
    'display all contacts',
    'show contacts',
    'list contacts',
    'get contacts',
    'all contacts',
    'my contacts',
    'hubspot contacts',
    'show me all the contacts',
    'can you list all contacts?',
    'I need to see all contacts'
  ];

  console.log('🧪 Testing contact query detection...');
  
  for (const query of testQueries) {
    const intent = await analyzeQueryIntent(query);
    console.log(`Query: "${query}" -> Contact Query: ${intent.isContactQuery}, Type: ${intent.contactQueryType}`);
  }
}

// Export all functions
export {
  initializeEmbedder,
  generateEmbedding,
  LLMClient,
  llmClient,
  analyzeQueryIntent,
  searchRelevantContext,
  buildContextSections,
  parseEnhancedToolCalls,
  validateToolCalls
};
