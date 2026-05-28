const SHOPIFY_URL = process.env.SHOPIFY_STORE_URL
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN

export interface OrderDetails {
  orderNumber: string
  customerName: string
  customerEmail: string
  customerPhone: string
  createdAt: string
  totalPrice: string
  lineItems: { name: string; sku: string; quantity: number; price: string }[]
  fulfillmentStatus: string
  financialStatus: string
  daysSincePurchase: number
  withinReturnWindow: boolean
  orderNote: string
  shopifyLink: string
}

async function shopifyFetch(path: string) {
  // Try both auth header formats — shppa_ tokens use Basic auth, shpat_ use X-Shopify-Access-Token
  const token = SHOPIFY_TOKEN || ''
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  // shppa_ = legacy private app password, needs Basic auth
  // shpat_ = custom app access token, needs X-Shopify-Access-Token
  if (token.startsWith('shppa_')) {
    const encoded = Buffer.from(`shopsolarkits:${token}`).toString('base64')
    headers['Authorization'] = `Basic ${encoded}`
  } else {
    headers['X-Shopify-Access-Token'] = token
  }

  const res = await fetch(`https://${SHOPIFY_URL}/admin/api/2024-01${path}`, { headers })
  if (!res.ok) {
    const errText = await res.text()
    console.error(`Shopify API error ${res.status}:`, errText)
    return null
  }
  return res.json()
}

export async function lookupOrderByUrl(shopifyUrl: string): Promise<OrderDetails | null> {
  try {
    const match = shopifyUrl.match(/orders\/(\d+)/)
    if (!match) return null
    return await lookupOrderById(match[1])
  } catch (err) {
    console.error('Shopify URL lookup error:', err)
    return null
  }
}

export async function lookupOrderById(orderId: string): Promise<OrderDetails | null> {
  try {
    const data = await shopifyFetch(`/orders/${orderId}.json`)
    if (!data?.order) return null
    return formatOrder(data.order)
  } catch (err) {
    console.error('Shopify ID lookup error:', err)
    return null
  }
}

export async function lookupOrderByNumber(orderIdentifier: string): Promise<OrderDetails | null> {
  try {
    const cleaned = orderIdentifier.replace('#', '').trim()
    const data = await shopifyFetch(`/orders.json?name=${encodeURIComponent(cleaned)}&status=any`)
    if (!data?.orders?.length) return null
    return formatOrder(data.orders[0])
  } catch (err) {
    console.error('Shopify number lookup error:', err)
    return null
  }
}

function formatOrder(order: any): OrderDetails {
  const createdAt = new Date(order.created_at)
  const now = new Date()
  const daysSincePurchase = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24))

  // Collect all notes — main note field plus any note_attributes
  const mainNote = order.note || ''
  const attrNotes = (order.note_attributes || [])
    .map((a: any) => `${a.name}: ${a.value}`)
    .join('\n')
  const fullNote = [mainNote, attrNotes].filter(Boolean).join('\n\n')

  return {
    orderNumber: order.name,
    customerName: `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim()
      || order.shipping_address?.name || 'Unknown',
    customerEmail: order.customer?.email || order.email || '',
    customerPhone: order.customer?.phone || order.shipping_address?.phone || '',
    createdAt: createdAt.toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    }),
    totalPrice: `$${parseFloat(order.total_price || '0').toLocaleString()}`,
    lineItems: (order.line_items || []).map((item: any) => ({
      name: item.name,
      sku: item.sku || '',
      quantity: item.quantity,
      price: `$${item.price}`,
    })),
    fulfillmentStatus: order.fulfillment_status || 'unfulfilled',
    financialStatus: order.financial_status || '',
    daysSincePurchase,
    withinReturnWindow: daysSincePurchase <= 30,
    orderNote: fullNote,
    shopifyLink: `https://admin.shopify.com/store/shopsolarkits/orders/${order.id}`,
  }
}

export function extractSlackData(slackText: string): {
  customerName?: string
  customerEmail?: string
  shopifyLink?: string
  topic?: string
  addedBy?: string
} {
  const result: any = {}

  // Clean up the text — normalize whitespace issues from Slack copy-paste
  const text = slackText.replace(/\s+/g, ' ').trim()

  // Extract each field — use lookahead to stop at the next field label
  const topicMatch = text.match(/Topic:\s*(.*?)(?=\s+Customer Name:|$)/i)
  if (topicMatch) result.topic = topicMatch[1].trim()

  const nameMatch = text.match(/Customer Name:\s*(.*?)(?=\s+Customer Email:|$)/i)
  if (nameMatch) result.customerName = nameMatch[1].trim()

  const emailMatch = text.match(/Customer Email:\s*([^\s]+)/i)
  if (emailMatch) result.customerEmail = emailMatch[1].trim().replace(/[<>]/g, '')

  const linkMatch = text.match(/(?:Shopify Link:|https:\/\/admin\.shopify\.com\/store\/[^\s]+)/i)
  if (linkMatch) {
    const urlMatch = text.match(/https:\/\/admin\.shopify\.com\/store\/[^\s]+/i)
    if (urlMatch) result.shopifyLink = urlMatch[0].trim()
  }

  const addedByMatch = text.match(/Added by @([^\s]+)/i)
  if (addedByMatch) result.addedBy = addedByMatch[1].trim()

  return result
}

export function extractOrderNumber(text: string): string | null {
  const patterns = [
    /(?:order\s*#?\s*)([A-Z]{2,}-\d+)/gi,
    /(?:order\s*#?\s*)(\d{4,})/gi,
    /#(\d{4,})/g,
    /([A-Z]{2,}-\d{4,})/g,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (match) return match[1]
  }
  return null
}
