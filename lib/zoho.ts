const ZOHO_ORG_ID = '787984005'
const BASE_URL = 'https://desk.zoho.com/api/v1'

async function getValidToken(): Promise<string | null> {
  console.log('[Zoho] getValidToken() called')

  const refreshToken = process.env.ZOHO_DESK_REFRESH_TOKEN
  const clientId     = process.env.ZOHO_DESK_CLIENT_ID
  const clientSecret = process.env.ZOHO_DESK_CLIENT_SECRET

  console.log('[Zoho] Credential check —', {
    hasRefreshToken: !!refreshToken,
    refreshTokenPrefix: refreshToken?.slice(0, 12) ?? 'MISSING',
    hasClientId:     !!clientId,
    clientIdPrefix:  clientId?.slice(0, 10) ?? 'MISSING',
    hasClientSecret: !!clientSecret,
  })

  if (!refreshToken || !clientId || !clientSecret) {
    console.error('[Zoho] ERROR: One or more OAuth credentials are missing from env vars')
    return null
  }

  try {
    const body = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     clientId,
      client_secret: clientSecret,
    })

    console.log('[Zoho] POSTing to https://accounts.zoho.com/oauth/v2/token ...')
    const res = await fetch('https://accounts.zoho.com/oauth/v2/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    })

    console.log('[Zoho] Token refresh HTTP status:', res.status)
    const data = await res.json()
    console.log('[Zoho] Token refresh response body:', JSON.stringify(data))

    if (!res.ok || data.error) {
      console.error('[Zoho] ERROR: Token refresh failed —', data.error, data.error_description ?? '')
      return null
    }

    console.log('[Zoho] Token refresh SUCCESS — access_token prefix:', data.access_token?.slice(0, 12))
    return data.access_token || null
  } catch (err: any) {
    console.error('[Zoho] EXCEPTION during token refresh —', err.message)
    return null
  }
}

async function zohoGet(path: string, token: string): Promise<any> {
  const separator = path.includes('?') ? '&' : '?'
  const url = `${BASE_URL}${path}${separator}orgId=${ZOHO_ORG_ID}`

  console.log('[Zoho] GET', url)
  const res = await fetch(url, {
    headers: { 'Authorization': `Zoho-oauthtoken ${token}` },
  })

  console.log('[Zoho] GET', path, '→ HTTP', res.status)

  if (!res.ok) {
    const errText = await res.text()
    console.error(`[Zoho] ERROR: GET ${path} returned ${res.status} —`, errText)
    return null
  }

  const json = await res.json()
  console.log('[Zoho] GET', path, '→ response keys:', Object.keys(json))
  return json
}

export interface ZohoTicketData {
  id: string
  ticketNumber: string
  subject: string
  status: string
  topic: string
  customerName: string
  customerEmail: string
  assigneeName: string
  createdAt: string
  shopifyLink: string
  threads: ZohoThread[]
}

export interface ZohoThread {
  direction: 'in' | 'out'
  author: string
  date: string
  summary: string
}

function buildTicketData(ticket: any, threads: ZohoThread[]): ZohoTicketData {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject || '',
    status: ticket.status || '',
    topic: ticket.cf?.cf_topic || ticket.customFields?.Topic || '',
    customerName: ticket.contact
      ? `${ticket.contact.firstName || ''} ${ticket.contact.lastName || ''}`.trim()
      : '',
    customerEmail: ticket.email || ticket.contact?.email || '',
    assigneeName: ticket.assignee
      ? `${ticket.assignee.firstName || ''} ${ticket.assignee.lastName || ''}`.trim()
      : 'Unassigned',
    createdAt: ticket.createdTime
      ? new Date(ticket.createdTime).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric'
        })
      : '',
    shopifyLink: ticket.cf?.cf_shopify_link
      || ticket.customFields?.['Shopify Link']
      || '',
    threads,
  }
}

export async function getTicketByNumber(ticketNumber: string): Promise<ZohoTicketData | null> {
  console.log('[Zoho] getTicketByNumber() called with:', ticketNumber)
  try {
    const token = await getValidToken()
    if (!token) {
      console.error('[Zoho] ERROR: getValidToken() returned null — aborting ticket fetch')
      return null
    }

    const cleaned = ticketNumber.replace('#', '').trim()
    console.log('[Zoho] Fetching ticket number:', cleaned)

    const data = await zohoGet(`/tickets?ticketNumber=${cleaned}`, token)
    console.log('[Zoho] Ticket search result — data.count:', data?.count, 'data.data length:', data?.data?.length)

    if (!data?.data?.length) {
      console.error('[Zoho] ERROR: No ticket found for number:', cleaned, '| Full response:', JSON.stringify(data))
      return null
    }

    const ticket = data.data[0]
    console.log('[Zoho] Ticket found — id:', ticket.id, 'subject:', ticket.subject)

    const threads = await getTicketThreads(ticket.id, token)
    console.log('[Zoho] Threads fetched:', threads.length)
    return buildTicketData(ticket, threads)
  } catch (err: any) {
    console.error('[Zoho] EXCEPTION in getTicketByNumber —', err.message, err.stack)
    return null
  }
}

async function getTicketThreads(ticketId: string, token: string): Promise<ZohoThread[]> {
  console.log('[Zoho] getTicketThreads() called for ticket id:', ticketId)
  try {
    const data = await zohoGet(`/tickets/${ticketId}/conversations?limit=25`, token)
    if (!data?.data) {
      console.error('[Zoho] ERROR: conversations response missing data field —', JSON.stringify(data))
      return []
    }
    console.log('[Zoho] Conversations returned:', data.data.length)
    return [...data.data].reverse().map((t: any) => ({
      direction: t.direction === 'in' ? 'in' as const : 'out' as const,
      author: t.author?.name || (t.direction === 'in' ? 'Customer' : 'Agent'),
      date: t.createdTime
        ? new Date(t.createdTime).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
          })
        : '',
      summary: t.summary || t.content || '(no preview)',
    }))
  } catch (err: any) {
    console.error('[Zoho] EXCEPTION in getTicketThreads —', err.message)
    return []
  }
}

export function formatThreadsForAI(threads: ZohoThread[]): string {
  if (!threads.length) return 'No conversation threads available.'
  return threads.map((t, i) => {
    const dir = t.direction === 'in' ? '← CUSTOMER' : '→ AGENT'
    return `[${i + 1}] ${dir} — ${t.author} (${t.date})\n${t.summary}`
  }).join('\n\n---\n\n')
}
