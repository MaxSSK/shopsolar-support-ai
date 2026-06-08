import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export interface SimilarTicket {
  subject: string
  first_customer_message: string
  last_agent_message: string
  agent_name: string
  similarity: number
}

export async function findSimilarTickets(query: string): Promise<SimilarTicket[]> {
  try {
    // Generate embedding for the incoming ticket description
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    })
    const embedding = embeddingResponse.data[0].embedding

    // Query Supabase using the match_tickets RPC function
    const { data, error } = await supabase.rpc('match_tickets', {
      query_embedding: embedding,
      match_count: 5,
    })

    if (error) {
      console.error('Supabase retrieval error:', error.message)
      return []
    }

    return (data || []).map((row: any) => ({
      subject: row.subject || '',
      first_customer_message: row.first_customer_message || '',
      last_agent_message: row.last_agent_message || '',
      agent_name: row.agent_name || '',
      similarity: Math.round((row.similarity || 0) * 100),
    }))
  } catch (err: any) {
    console.error('Retrieval error:', err.message)
    return []
  }
}

export function formatSimilarTicketsForPrompt(tickets: SimilarTicket[]): string {
  if (tickets.length === 0) return ''

  const formatted = tickets.map((t, i) => `
### Similar Ticket ${i + 1} — "${t.subject}" (${t.similarity}% match)
**Handled by:** ${t.agent_name || 'Unknown'}

**Customer said:**
${t.first_customer_message || '(no message recorded)'}

**Agent replied:**
${t.last_agent_message || '(no reply recorded)'}
`.trim()).join('\n\n---\n\n')

  return `## SIMILAR PAST TICKETS (retrieved from 4,960 resolved tickets)
Use these as tone and approach reference — do not copy verbatim.

${formatted}`
}
