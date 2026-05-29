const ZOHO_ORG_ID = '787984005'
const BASE_URL = 'https://desk.zoho.com/api/v1'

async function getValidToken(): Promise<string | null> {
  const token = process.env.ZOHO_DESK_TOKEN
  if (!token) return null

  // Try the current token first
  const testRes = await fetch(`${BASE_URL}/myProfile?orgId=${ZOHO_ORG_ID}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` }
  })

  if (testRes.ok) return token

  // Token expired — refresh it
  const refreshToken = process.env.ZOHO_DESK_REFRESH_TOKEN
  const clientId = process.env.ZOHO_DESK_CLIENT_ID
  const clientSecret = process.env.ZOHO_DESK_CLIENT_SECRET

  if (!refreshToken || !clientId || !clientSecret) {
    console.error('Missing Zoho refresh credentials')
    return null
  }

  try {
    const refreshRes = await fetch('https://accounts.zoho.com/oauth/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      }),
    })

    if (!refreshRes.ok) {
      console.error('Token refresh failed:', await refreshRes.text())
      return null
    }

    const data = await refreshRes.json()
    if (data.access_token) {
      console.log('Zoho token refreshed successfully')
      return data.access_token
    }
    return null
  } catch (err) {
    console.error('Token refresh error:', err)
    return null
  }
}

async function zohoFetch(path: string): Promise<any> {
  const token = await getValidToken()
  if (!token) return null

  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      orgId: ZOHO_ORG_ID,
    },
  })

  if (!res.ok) {
    console.error(`Zoho API error ${res.status} for ${path}:`, await res.text())
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
  threads: ZohoThread[]
}

export interface ZohoThread {
  direction: 'in' | 'out'
  author: string
  date: string
  summary: string
  isPublic: boolean
}

export async function getTicketByNumber(ticketNumber: string): Promise<ZohoTicketData | null> {
  try {
    const cleaned = ticketNumber.replace('#', '').trim()
    const data = await zohoFetch(`/tickets?ticketNumber=${cleaned}&orgId=${ZOHO_ORG_ID}`)
    if (!data?.data?.length) return null

    const ticket = data.data[0]
    const threads = await getTicketThreads(ticket.id)

    return {
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject || '',
      status: ticket.status || '',
      topic: ticket.cf?.cf_topic || ticket.customFields?.Topic || '',
      customerName: `${ticket.contact?.firstName || ''} ${ticket.contact?.lastName || ''}`.trim(),
      customerEmail: ticket.email || ticket.contact?.email || '',
      assigneeName: ticket.assignee
        ? `${ticket.assignee.firstName || ''} ${ticket.assignee.lastName || ''}`.trim()
        : 'Unassigned',
      createdAt: ticket.createdTime
        ? new Date(ticket.createdTime).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
          })
        : '',
      threads,
    }
  } catch (err) {
    console.error('Zoho ticket lookup error:', err)
    return null
  }
}

async function getTicketThreads(ticketId: string): Promise<ZohoThread[]> {
  try {
    const data = await zohoFetch(`/tickets/${ticketId}/conversations?limit=25&orgId=${ZOHO_ORG_ID}`)
    if (!data?.data) return []

    return data.data
      .reverse() // oldest first
      .map((t: any) => ({
        direction: t.direction === 'in' ? 'in' : 'out',
        author: t.author?.name || (t.direction === 'in' ? 'Customer' : 'Agent'),
        date: t.createdTime
          ? new Date(t.createdTime).toLocaleDateString('en-US', {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            })
          : '',
        summary: t.summary || t.content || '(no preview)',
        isPublic: t.isPublic !== false,
      }))
  } catch (err) {
    console.error('Zoho threads error:', err)
    return []
  }
}

export function formatThreadsForAI(threads: ZohoThread[]): string {
  if (!threads.length) return 'No conversation threads available.'
  return threads.map((t, i) => {
    const direction = t.direction === 'in' ? '← CUSTOMER' : '→ AGENT'
    return `[${i + 1}] ${direction} — ${t.author} (${t.date})\n${t.summary}`
  }).join('\n\n---\n\n')
}
