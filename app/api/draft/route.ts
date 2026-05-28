import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { SYSTEM_PROMPT } from '../../../lib/knowledge'
import { lookupOrder, extractOrderNumber } from '../../../lib/shopify'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export async function POST(req: NextRequest) {
  try {
    const { emailContent, topic } = await req.json()

    if (!emailContent?.trim()) {
      return NextResponse.json({ error: 'Email content is required' }, { status: 400 })
    }

    // Try to find and look up an order number from the email
    const orderNumber = extractOrderNumber(emailContent)
    let orderDetails = null
    let orderContext = ''

    if (orderNumber) {
      orderDetails = await lookupOrder(orderNumber)
      if (orderDetails) {
        orderContext = `
## SHOPIFY ORDER DATA (looked up automatically)
Order: ${orderDetails.orderNumber}
Customer: ${orderDetails.customerName} (${orderDetails.customerEmail})
Purchase date: ${orderDetails.createdAt}
Days since purchase: ${orderDetails.daysSincePurchase} days
Within 30-day return window: ${orderDetails.withinReturnWindow ? 'YES' : 'NO — past return window'}
Order total: ${orderDetails.totalPrice}
Fulfillment status: ${orderDetails.fulfillmentStatus}
Products ordered:
${orderDetails.lineItems.map(item => `- ${item.name} (SKU: ${item.sku}) x${item.quantity} @ ${item.price}`).join('\n')}
`
      }
    }

    const userMessage = `## INCOMING CUSTOMER EMAIL
${topic ? `Pre-labeled topic (from Slack workflow): ${topic}` : 'No topic pre-selected — please classify.'}

---
${emailContent}
---

${orderContext || (orderNumber ? `Note: Order number "${orderNumber}" detected but could not be found in Shopify. Ask customer to confirm their order number.` : 'No order number detected in the email.')}

Please classify this ticket, assess what information is present or missing, and draft a response.`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    })

    const content = response.content[0]
    if (content.type !== 'text') {
      throw new Error('Unexpected response type')
    }

    // Parse JSON response
    let parsed
    try {
      // Strip markdown code blocks if present
      const clean = content.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      parsed = JSON.parse(clean)
    } catch {
      // If JSON parse fails, return raw text
      return NextResponse.json({
        classification: 'OTHER',
        confidence: 'LOW',
        routing: 'Recovery Team',
        summary: 'Could not parse AI response',
        missing_info: [],
        order_check_needed: false,
        draft_response: content.text,
        internal_notes: 'AI response was not valid JSON — showing raw output',
        orderDetails,
      })
    }

    return NextResponse.json({ ...parsed, orderDetails })
  } catch (err: any) {
    console.error('Draft API error:', err)
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 })
  }
}
