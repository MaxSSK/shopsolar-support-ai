import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { SYSTEM_PROMPT_NEW_TICKET, SYSTEM_PROMPT_EXISTING_TICKET } from '../../../lib/knowledge'
import {
  lookupOrderByUrl,
  lookupOrderByNumber,
  extractSlackData,
  extractOrderNumber,
} from '../../../lib/shopify'
import { getTicketByNumber, formatThreadsForAI } from '../../../lib/zoho'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  try {
    const { mode, slackText, ticketNumber } = await req.json()

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

## ORDER NOTES (top-level note field)
${orderDetails.orderNote || 'No notes.'}

## STAFF TIMELINE NOTES (written by team in Shopify order timeline — most important)
${orderDetails.timelineNotes || 'No timeline notes found.'}
`
      }

      const userMessage = `## SLACK WORKFLOW INPUT
${slackText}

## EXTRACTED DATA
Customer name: ${slackData.customerName || 'not found'}
Customer email: ${slackData.customerEmail || 'not found'}
Topic: ${slackData.topic || 'not specified'}
Shopify link: ${slackData.shopifyLink || 'not found'}
Added by: ${slackData.addedBy || 'unknown'}

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

      return NextResponse.json({ ...parsed, orderDetails, slackData, mode: 'new' })
    }

    // ── MODE 2: EXISTING TICKET FROM ZOHO ─────────────────────
    if (mode === 'existing') {
      if (!ticketNumber?.trim()) {
        return NextResponse.json({ error: 'Ticket number is required' }, { status: 400 })
      }

      const zohoTicket = await getTicketByNumber(ticketNumber)
      const threadSummary = zohoTicket ? formatThreadsForAI(zohoTicket.threads) : 'Could not retrieve ticket data.'

      // Look up Shopify order — first try the Shopify link stored in Zoho custom fields
      let orderDetails = null
      if (zohoTicket?.shopifyLink) {
        orderDetails = await lookupOrderByUrl(zohoTicket.shopifyLink)
      }
      if (!orderDetails) {
        const orderNum = extractOrderNumber(zohoTicket?.subject || '')
        if (orderNum) orderDetails = await lookupOrderByNumber(orderNum)
      }

      const userMessage = `## ZOHO DESK TICKET #${ticketNumber.replace('#', '')}
${zohoTicket ? `Subject: ${zohoTicket.subject}
Status: ${zohoTicket.status}
Topic: ${zohoTicket.topic || 'not set'}
Customer: ${zohoTicket.customerName} (${zohoTicket.customerEmail})
Assigned to: ${zohoTicket.assigneeName}
Created: ${zohoTicket.createdAt}
Total threads: ${zohoTicket.threads.length}` : 'Ticket data unavailable — Zoho connection may need re-authentication.'}

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

Staff timeline notes:
${orderDetails.timelineNotes || 'No timeline notes.'}
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
        zohoTicket: zohoTicket ? {
          subject: zohoTicket.subject,
          status: zohoTicket.status,
          topic: zohoTicket.topic,
          assigneeName: zohoTicket.assigneeName,
          createdAt: zohoTicket.createdAt,
        } : null,
        threadCount: zohoTicket?.threads.length || 0,
        mode: 'existing',
      })
    }

    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 })

  } catch (err: any) {
    console.error('Draft API error:', err)
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}
