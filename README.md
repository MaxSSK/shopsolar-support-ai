# ShopSolar Email Support AI

AI-powered email response drafting for the ShopSolar support team. Classifies inbound customer emails, looks up orders in Shopify, and drafts responses for human review.

## What it does

1. Paste a customer email (return request, warranty claim, etc.)
2. AI classifies the ticket type and confidence level
3. Shopify order is looked up automatically if an order number is found
4. A draft response is generated in ShopSolar's voice
5. Agent reviews, fills in their name, copies and sends

## Tech stack

- Next.js 14 (App Router)
- TypeScript
- Anthropic Claude API (claude-sonnet-4-20250514)
- Shopify Admin API
- Deployed on Vercel

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Set environment variables
Copy `.env.example` to `.env.local` and fill in:
```
ANTHROPIC_API_KEY=your_key
SHOPIFY_STORE_URL=shopsolarkits.myshopify.com
SHOPIFY_ACCESS_TOKEN=your_token
```

### 3. Run locally
```bash
npm run dev
```

### 4. Deploy to Vercel
```bash
npx vercel
```
Add the three environment variables in the Vercel dashboard under Settings → Environment Variables.

## Deploying with Claude Code

Open Claude Code and run:
```
Create a GitHub repo called shopsolar-support-ai, commit all files in this directory, push to GitHub, and deploy to Vercel. Add these environment variables to the Vercel project:
- ANTHROPIC_API_KEY
- SHOPIFY_STORE_URL  
- SHOPIFY_ACCESS_TOKEN
```

Then add the actual values in the Vercel dashboard.
