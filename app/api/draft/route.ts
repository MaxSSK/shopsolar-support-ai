import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { SYSTEM_PROMPT_NEW_TICKET, SYSTEM_PROMPT_EXISTING_TICKET } from '../../../lib/knowledge'
import {
  lookupOrderByUrl,
  lookupOrderByNumber,
  extractSlackData,
  extractOrderNumber,
} from '../../../lib/shopify'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const ZOHO_ORG_ID = '787984005'
const ZOHO_TOKEN = process.env.ZOHO_DESK_TOKEN

async function getZohoTicket(ticketNumber: string) {
  if (!ZOHO_TOKEN) return null
  try {
    const res = await fetch(
      `https://desk.zoho.com/api/v1/tickets/search?orgId=${ZOHO_ORG_ID}&ticketNumber=${ticketNumber}`,
      { headers: { Authorization: `Zoho-oauthtoken ${ZOHO_TOKEN}` } }
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.data?.[0] || null
  } catch { return null }
}

async function getZohoThreads(ticketId: string) {
  if (!ZOHO_TOKEN) return []
  try {
    const res = await fetch(
      `https://desk.zoho.com/api/v1/tickets/${ticketId}/conversations?orgId=${ZOHO_ORG_ID}&limit=20`,
      { headers: { Authorization: `Zoho-oauthtoken ${ZOHO_TOKEN}` } }
    )
    if (!res.ok) return []
    const data = await res.json()
    return data.data || []
  } catch { return [] }
}

function formatThreadsForAI(threads: any[]): string {
  if (!threads.length) return 'No conversation threads found.'
  // Reverse to show oldest first
  const sorted = [...threads].reverse()
  return sorted.map((t, i) => {
    const direction = t.direction === 'in' ? '← CUSTOMER' : '→ AGENT'
    const author = t.direction === 'in'
      ? (t.author?.name || 'Customer')
      : (t.author?.name || 'Agent')
    const date = new Date(t.createdTime).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
    })
    return `[${i + 1}] ${direction} — ${author} (${date})\n${t.summary || '(no preview available)'}`
  }).join('\n\n---\n\n')
}

export async function POST(req: NextRequest) {
  try {
    const { mode, slackText, ticketNumber, topic } = await req.json()

    // ── MODE 1: NEW TICKET FROM SLACK ─────────────────────────
    if (mode === 'new') {
      if (!slackText?.trim()) {
        return NextResponse.json({ error: 'Slack message is required' }, { status: 400 })
      }

      const slackData = extractSlackData(slackText)
      let orderDetails = null

      if (slackData.shopifyLink) {
        orderDetails = await lookupOrderByUrl(slackData.shopifyLink)
      }

      if (!orderDetails) {
        const orderNum = extractOrderNumber(slackText)
        if (orderNum) orderDetails = await lookupOrderByNumber(orderNum)
      }

      let orderContext = ''
      if (orderDetails) {
        orderContext = `
## SHOPIFY ORDER DATA
Order: ${orderDetails.orderNumber}
Customer: ${orderDetails.customerName} (${orderDetails.customerEmail})
Phone: ${orderDetails.customerPhone || 'not on file'}
Purchase date: ${orderDetails.createdAt}
Days since purchase: ${orderDetails.daysSincePurchase} days
Within 30-day return window: ${orderDetails.withinReturnWindow ? 'YES' : 'NO — past return window'}
Order total: ${orderDetails.totalPrice}
Fulfillment: ${orderDetails.fulfillmentStatus}

Products ordered:
${orderDetails.lineItems.map(item => `- ${item.name} (SKU: ${item.sku}) x${item.quantity} @ ${item.price}`).join('\n')}

## ORDER NOTES (written by team member who took the call)
${orderDetails.orderNote || 'No notes on this order.'}
`
      }

      const userMessage = `## SLACK WORKFLOW INPUT
${slackText}

## EXTRACTED DATA
Customer name: ${slackData.customerName || 'not found'}
Customer email: ${slackData.customerEmail || 'not found'}
Topic: ${slackData.topic || topic || 'not specified'}
Shopify link: ${slackData.shopifyLink || 'not found'}

${orderContext || 'Could not retrieve Shopify order data.'}

Please draft the first outbound email to this customer.`

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 2000,
        system: SYSTEM_PROMPT_NEW_TICKET,
        messages: [{ role: 'user', content: userMessage }],
      })

      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      let parsed
      try {
        parsed = JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
      } catch {
        parsed = { classification: 'OTHER', confidence: 'LOW', routing: 'Recovery Team', summary: 'Parse error', missing_info: [], draft_response: text, internal_notes: 'AI response was not valid JSON' }
      }

      return NextResponse.json({
        ...parsed,
        orderDetails,
        slackData,
        mode: 'new',
      })
    }

    // ── MODE 2: EXISTING TICKET FROM ZOHO ─────────────────────
    if (mode === 'existing') {
      if (!ticketNumber?.trim()) {
        return NextResponse.json({ error: 'Ticket number is required' }, { status: 400 })
      }

      const cleanTicket = ticketNumber.replace('#', '').trim()

      // Try to get Zoho data via API token if available
      let threads: any[] = []
      let zohoTicket: any = null
      let shopifyLink: string | null = null

      if (ZOHO_TOKEN) {
        zohoTicket = await getZohoTicket(cleanTicket)
        if (zohoTicket) {
          threads = await getZohoThreads(zohoTicket.id)
          shopifyLink = zohoTicket.cf_shopify_link || zohoTicket.customFields?.['Shopify Link'] || null
        }
      }

      // Look up Shopify order
      let orderDetails = null
      if (shopifyLink) {
        orderDetails = await lookupOrderByUrl(shopifyLink)
      }

      const threadSummary = formatThreadsForAI(threads)

      const userMessage = `## ZOHO DESK TICKET #${cleanTicket}
Subject: ${zohoTicket?.subject || 'Unknown'}
Status: ${zohoTicket?.status || 'Unknown'}
Topic: ${zohoTicket?.customFields?.Topic || zohoTicket?.cf?.cf_topic || 'not set'}
Customer: ${zohoTicket?.contact?.firstName || ''} ${zohoTicket?.contact?.lastName || ''} (${zohoTicket?.email || ''})
Assigned to: ${zohoTicket?.assignee?.firstName || 'unassigned'} ${zohoTicket?.assignee?.lastName || ''}

## CONVERSATION HISTORY (oldest to newest)
${threadSummary}

${orderDetails ? `## SHOPIFY ORDER DATA
Order: ${orderDetails.orderNumber}
Customer: ${orderDetails.customerName}
Purchase date: ${orderDetails.createdAt} (${orderDetails.daysSincePurchase} days ago)
Within return window: ${orderDetails.withinReturnWindow ? 'YES' : 'NO'}
Order total: ${orderDetails.totalPrice}
Products: ${orderDetails.lineItems.map(i => i.name).join(', ')}

Order notes:
${orderDetails.orderNote || 'No notes.'}
` : 'Shopify order data not available for this ticket.'}

Please draft the next reply in this conversation.`

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 2000,
        system: SYSTEM_PROMPT_EXISTING_TICKET,
        messages: [{ role: 'user', content: userMessage }],
      })

      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      let parsed
      try {
        parsed = JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
      } catch {
        parsed = { classification: 'OTHER', confidence: 'LOW', routing: 'Recovery Team', summary: 'Parse error', missing_info: [], draft_response: text, internal_notes: 'AI response was not valid JSON' }
      }

      return NextResponse.json({
        ...parsed,
        orderDetails,
        zohoTicket,
        threadCount: threads.length,
        mode: 'existing',
      })
    }

    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 })

  } catch (err: any) {
    console.error('Draft API error:', err)
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}
