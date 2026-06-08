// IMPORTANT: Set INGEST_SECRET in Vercel environment variables.
// Generate a random string (e.g. openssl rand -hex 32) and add it there.
// The Zoho webhook must send the same value in the x-ingest-secret header.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ZOHO_ORG_ID = '787984005'
const ZOHO_BASE   = 'https://desk.zoho.com/api/v1'

// ── Agent → queue mapping ─────────────────────────────────────────────────
const TECH_AGENTS        = new Set(['Karl', 'Khim', 'EJ', 'Yvhan'])
const RECOVERY_AGENTS    = new Set(['Keri', 'Maddie', 'Chantelle'])
const FULFILLMENT_AGENTS = new Set(['Marielle', 'Kristin', 'Wayne', 'Clifferwayn'])
const SALES_AGENTS       = new Set(['Eric', 'Mike', 'Mat', 'Bruce', 'James', 'Tony'])

function resolveQueue(agentName: string): string {
  // Match on first name only to handle "First Last" format
  const firstName = agentName.trim().split(/\s+/)[0]
  if (TECH_AGENTS.has(firstName))        return 'Tech'
  if (RECOVERY_AGENTS.has(firstName))    return 'Recovery'
  if (FULFILLMENT_AGENTS.has(firstName)) return 'Fulfillment'
  if (SALES_AGENTS.has(firstName))       return 'Sales'
  return 'unknown'
}

// ── Zoho helpers ──────────────────────────────────────────────────────────
async function getZohoToken(): Promise<string | null> {
  const { ZOHO_DESK_REFRESH_TOKEN, ZOHO_DESK_CLIENT_ID, ZOHO_DESK_CLIENT_SECRET } = process.env
  if (!ZOHO_DESK_REFRESH_TOKEN || !ZOHO_DESK_CLIENT_ID || !ZOHO_DESK_CLIENT_SECRET) {
    console.error('[ingest] Missing Zoho OAuth credentials')
    return null
  }
  try {
    const res = await fetch('https://accounts.zoho.com/oauth/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: ZOHO_DESK_REFRESH_TOKEN,
        client_id:     ZOHO_DESK_CLIENT_ID,
        client_secret: ZOHO_DESK_CLIENT_SECRET,
      }).toString(),
    })
    const data = await res.json()
    if (!res.ok || data.error) {
      console.error('[ingest] Zoho token refresh failed —', data.error)
      return null
    }
    return data.access_token || null
  } catch (err: any) {
    console.error('[ingest] Exception refreshing Zoho token —', err.message)
    return null
  }
}

async function zohoGet(path: string, token: string): Promise<any> {
  const sep = path.includes('?') ? '&' : '?'
  const url = `${ZOHO_BASE}${path}${sep}orgId=${ZOHO_ORG_ID}`
  const res = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  })
  if (!res.ok) {
    const txt = await res.text()
    console.error(`[ingest] Zoho GET ${path} → ${res.status}`, txt)
    return null
  }
  return res.json()
}

// ── Build the text blob to embed (mirrors embed-tickets.js) ──────────────
function buildConversationText(
  subject: string,
  agentName: string,
  threads: Array<{ direction: 'in' | 'out'; author: string; content: string }>
): string {
  const parts: string[] = []
  if (subject)   parts.push(`Subject: ${subject}`)
  if (agentName) parts.push(`Agent: ${agentName}`)

  const firstCustomer = threads.find(t => t.direction === 'in')
  if (firstCustomer) parts.push(`First customer message:\n${firstCustomer.content}`)

  if (threads.length) {
    const msgs = threads
      .map(t => `[${t.direction === 'in' ? 'Customer' : 'Agent'} — ${t.author}]: ${t.content}`)
      .join('\n')
    parts.push(`Full conversation:\n${msgs}`)
  }

  const lastAgent = [...threads].reverse().find(t => t.direction === 'out')
  if (lastAgent) parts.push(`Last agent message:\n${lastAgent.content}`)

  return parts.join('\n\n').slice(0, 12000)
}

// ── GET — Zoho webhook URL validation ────────────────────────────────────
export function GET() {
  return NextResponse.json({ status: 'ok' })
}

// ── POST — ingest closed ticket ───────────────────────────────────────────
export async function POST(req: NextRequest) {
  // 1. Auth check — accept secret via header or query param
  const secret =
    req.headers.get('x-ingest-secret') ??
    req.nextUrl.searchParams.get('secret')
  if (!secret || secret !== process.env.INGEST_SECRET) {
    console.warn('[ingest] Unauthorized — bad or missing secret')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // 2. Parse payload — Zoho sends an array; ticket data is at body[0].payload
    const body = await req.json()
    const event = Array.isArray(body) ? body[0] : body

    // 2a. Status gate — check new status (payload.status); only proceed for Closed
    const newStatus: string = event?.payload?.status ?? ''
    const prevStatus: string = event?.prevState?.status ?? ''
    if (newStatus && newStatus !== 'Closed') {
      console.log(`[ingest] Skipping — status is ${newStatus}, not Closed`)
      return NextResponse.json({ skipped: true, reason: 'not closed' })
    }
    console.log(`[ingest] Status transition: ${prevStatus} → ${newStatus}`)

    const ticketId: string | undefined = event?.payload?.id

    if (!ticketId) {
      console.error('[ingest] Could not find ticket ID in payload')
      return NextResponse.json({ error: 'Missing ticket ID in payload' }, { status: 400 })
    }

    console.log('[ingest] Received webhook for ticket ID:', ticketId)

    // 3. Idempotency check — skip embedding if ticket already exists (embedding costs money)
    const { data: existing, error: checkErr } = await supabase
      .from('tickets')
      .select('ticket_id')
      .eq('ticket_id', ticketId)
      .maybeSingle()

    if (checkErr) {
      console.error('[ingest] Supabase check error:', checkErr.message)
      return NextResponse.json({ error: checkErr.message }, { status: 500 })
    }

    if (existing) {
      console.log('[ingest] Ticket already exists, skipping:', ticketId)
      return NextResponse.json({ success: true, ticket_id: ticketId, skipped: true })
    }

    // 4. Fetch ticket details from Zoho
    const token = await getZohoToken()
    if (!token) {
      return NextResponse.json({ error: 'Failed to obtain Zoho token' }, { status: 500 })
    }

    const ticketData = await zohoGet(`/tickets/${ticketId}`, token)
    if (!ticketData) {
      return NextResponse.json({ error: 'Failed to fetch ticket from Zoho' }, { status: 500 })
    }

    const subject = ticketData.subject || ''
    const agentName = ticketData.assignee
      ? `${ticketData.assignee.firstName || ''} ${ticketData.assignee.lastName || ''}`.trim()
      : 'Unassigned'

    // 5. Fetch conversation threads
    const convData = await zohoGet(`/tickets/${ticketId}/conversations?limit=25`, token)
    const rawThreads: any[] = convData?.data ?? []

    const threads = [...rawThreads].reverse().map((t: any) => ({
      direction: (t.direction === 'in' ? 'in' : 'out') as 'in' | 'out',
      author:    t.author?.name || (t.direction === 'in' ? 'Customer' : 'Agent'),
      content:   t.summary || t.content || '',
    }))

    // 6. Extract first customer message and last agent message
    const firstCustomerMessage = threads.find(t => t.direction === 'in')?.content ?? null
    const lastAgentMessage     = [...threads].reverse().find(t => t.direction === 'out')?.content ?? null

    // 7. Determine queue
    const queue = resolveQueue(agentName)

    // 8. Build text to embed
    const fullConversationText = buildConversationText(subject, agentName, threads)

    // 9. Generate embedding
    console.log('[ingest] Generating embedding for ticket:', ticketId)
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: fullConversationText,
    })
    const embedding = embeddingResponse.data[0].embedding

    // 10. Upsert into Supabase
    const { error: upsertErr } = await supabase
      .from('tickets')
      .upsert(
        {
          ticket_id:              ticketId,
          subject,
          agent_name:             agentName,
          first_customer_message: firstCustomerMessage,
          last_agent_message:     lastAgentMessage,
          full_conversation_text: fullConversationText,
          queue,
          embedding,
        },
        { onConflict: 'ticket_id' }
      )

    if (upsertErr) {
      console.error('[ingest] Supabase upsert error:', upsertErr.message)
      return NextResponse.json({ error: upsertErr.message }, { status: 500 })
    }

    console.log('[ingest] Successfully ingested ticket:', ticketId, '| queue:', queue)
    return NextResponse.json({ success: true, ticket_id: ticketId })

  } catch (err: any) {
    console.error('[ingest] Unhandled error:', err.message, err.stack)
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}
