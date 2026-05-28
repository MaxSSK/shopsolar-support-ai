const SHOPIFY_URL = process.env.SHOPIFY_STORE_URL
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN

export interface OrderDetails {
  orderNumber: string
  customerName: string
  customerEmail: string
  createdAt: string
  totalPrice: string
  lineItems: { name: string; sku: string; quantity: number; price: string }[]
  fulfillmentStatus: string
  financialStatus: string
  daysSincePurchase: number
  withinReturnWindow: boolean
}

export async function lookupOrder(orderIdentifier: string): Promise<OrderDetails | null> {
  try {
    // Clean up order number — remove # if present
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
    const orders = data.orders

    if (!orders || orders.length === 0) {
      // Try searching by order number directly
      const res2 = await fetch(
        `https://${SHOPIFY_URL}/admin/api/2024-01/orders.json?status=any&limit=10`,
        {
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_TOKEN!,
            'Content-Type': 'application/json',
          },
        }
      )
      return null
    }

    const order = orders[0]
    const createdAt = new Date(order.created_at)
    const now = new Date()
    const daysSincePurchase = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24))

    return {
      orderNumber: order.name,
      customerName: `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim(),
      customerEmail: order.customer?.email || order.email || '',
      createdAt: createdAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      totalPrice: `$${order.total_price}`,
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
    }
  } catch (err) {
    console.error('Shopify lookup error:', err)
    return null
  }
}

export function extractOrderNumber(text: string): string | null {
  // Match common order number patterns: #12345, Order 12345, WHUS-49441, order #38910
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
