const ZOHO_ORG_ID = '787984005'
const BASE_URL = 'https://desk.zoho.com/api/v1'

async function getValidToken(): Promise<string | null> {
  const token = process.env.ZOHO_DESK_TOKEN
  if (!token) return null

  // Test current token with a simple call
  const testRes = await fetch(
    `${BASE_URL}/tickets?limit=1&orgId=${ZOHO_ORG_ID}`,
    { headers: { 'Authorization': `Zoho-oauthtoken ${token}` } }
  )

  if (testRes.ok) return token

  // Token expired — refresh it
  const refreshToken = process.env.ZOHO_DESK_REFRESH_TOKEN
  const clientId = process.env.ZOHO_DESK_CLIENT_ID
  const clientSecret = process.env.ZOHO_DESK_CLIENT_SECRET

  if (!refreshToken || !clientId || !clientSecret) return null

  try {
    const params = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    })

    const refreshRes = await fetch(
      `https://accounts.zoho.com/oauth/v2/token?${params.toString()}`,
      { method: 'POST' }
    )

    if (!refreshRes.ok) return null
    const data = await refreshRes.json()
    return data.access_token || null
  } catch {
    return null
  }
}

async function zohoGet(path: string, token: string): Promise<any> {
  const separator = path.includes('?') ? '&' : '?'
  const url = `${BASE_URL}${path}${separator}orgId=${ZOHO_ORG_ID}`

  const res = await fetch(url, {
    headers: { 'Authorization': `Zoho-oauthtoken ${token}` },
  })

  if (!res.ok) {
    const errText = await res.text()
    console.error(`Zoho error ${res.status} for ${path}:`, errText)
    return null
  }
  return res.json()
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
  try {
    const token = await getValidToken()
    if (!token) {
      console.error('No valid Zoho token')
      return null
    }

    const cleaned = ticketNumber.replace('#', '').trim()

    // Use the search endpoint with ticketNumber field
    const data = await zohoGet(`/tickets/search?ticketNumber=${cleaned}`, token)

    if (!data?.data?.length) {
      console.error('No ticket found for number:', cleaned)
      return null
    }

    const ticket = data.data[0]
    const threads = await getTicketThreads(ticket.id, token)
    return buildTicketData(ticket, threads)
  } catch (err) {
    console.error('Zoho ticket lookup error:', err)
    return null
  }
}

async function getTicketThreads(ticketId: string, token: string): Promise<ZohoThread[]> {
  try {
    const data = await zohoGet(`/tickets/${ticketId}/conversations?limit=25`, token)
    if (!data?.data) return []

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
  } catch (err) {
    console.error('Zoho threads error:', err)
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
