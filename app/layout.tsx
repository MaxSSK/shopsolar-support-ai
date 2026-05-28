import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ShopSolar Email Support AI',
  description: 'AI-powered email response drafting for ShopSolar support team',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
