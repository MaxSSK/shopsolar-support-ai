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
  noteAttributes: { name: string; value: string }[]
  shopifyLink: string
}

export async function lookupOrderByUrl(shopifyUrl: string): Promise<OrderDetails | null> {
  try {
    // Extract order ID from URL like https://admin.shopify.com/store/shopsolarkits/orders/5155457335436
    const match = shopifyUrl.match(/orders\/(\d+)/)
    if (!match) return null
    const orderId = match[1]
    return await lookupOrderById(orderId)
  } catch (err) {
    console.error('Shopify URL lookup error:', err)
    return null
  }
}

export async function lookupOrderById(orderId: string): Promise<OrderDetails | null> {
  try {
    const res = await fetch(
      `https://${SHOPIFY_URL}/admin/api/2024-01/orders/${orderId}.json`,
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_TOKEN!,
          'Content-Type': 'application/json',
        },
      }
    )
    if (!res.ok) return null
    const data = await res.json()
    return formatOrder(data.order)
  } catch (err) {
    console.error('Shopify ID lookup error:', err)
    return null
  }
}

export async function lookupOrderByNumber(orderIdentifier: string): Promise<OrderDetails | null> {
  try {
    const cleaned = orderIdentifier.replace('#', '').trim()
    const res = await fetch(
      `https://${SHOPIFY_URL}/admin/api/2024-01/orders.json?name=${encodeURIComponent(cleaned)}&status=any`,
      {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_TOKEN!,
          'Content-Type': 'application/json',
        },
      }
    )
    if (!res.ok) return null
    const data = await res.json()
    if (!data.orders?.length) return null
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

  return {
    orderNumber: order.name,
    customerName: `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim() || order.shipping_address?.name || 'Unknown',
    customerEmail: order.customer?.email || order.email || '',
    customerPhone: order.customer?.phone || order.shipping_address?.phone || '',
    createdAt: createdAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    totalPrice: `$${parseFloat(order.total_price).toLocaleString()}`,
    lineItems: (order.line_items || []).map((item: any) => ({
      name: item.name,
      sku: item.sku || '',
      quantity: item.quantity,
      price: `$${item.price}`,
    })),
    fulfillmentStatus: order.fulfillment_status || 'unfulfilled',
    financialStatus: order.financial_status,
    daysSincePurchase,
    withinReturnWindow: daysSincePurchase <= 30,
    orderNote: order.note || '',
    noteAttributes: order.note_attributes || [],
    shopifyLink: `https://admin.shopify.com/store/shopsolarkits/orders/${order.id}`,
  }
}

export function extractSlackData(slackText: string): {
  customerName?: string
  customerEmail?: string
  shopifyLink?: string
  topic?: string
} {
  const result: any = {}

  const topicMatch = slackText.match(/Topic:\s*([^\n\r]+)/i)
  if (topicMatch) result.topic = topicMatch[1].trim()

  const nameMatch = slackText.match(/Customer Name:\s*([^\n\r]+)/i)
  if (nameMatch) result.customerName = nameMatch[1].trim()

  const emailMatch = slackText.match(/Customer Email:\s*([^\s\n\r]+)/i)
  if (emailMatch) result.customerEmail = emailMatch[1].trim().replace(/[<>]/g, '')

  const linkMatch = slackText.match(/https:\/\/admin\.shopify\.com\/store\/[^\s\n\r]+/i)
  if (linkMatch) result.shopifyLink = linkMatch[0].trim()

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
