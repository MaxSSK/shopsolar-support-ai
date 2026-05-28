'use client'
import { useState } from 'react'
import styles from './page.module.css'

const TOPICS = [
  'Warranty - Replace',
  'Warranty - Technical',
  'Return Request',
  'Refund Request',
  'Recovery - Damaged',
  'Recovery - Missing Item',
  'General Support',
  'No topic (classify automatically)',
]

const CLASSIFICATION_COLORS: Record<string, string> = {
  RETURN_REQUEST: 'amber',
  WARRANTY_CLAIM: 'blue',
  WARRANTY_TECHNICAL: 'red',
  MISSING_INFO: 'gray',
  OTHER: 'gray',
}

const CLASSIFICATION_LABELS: Record<string, string> = {
  RETURN_REQUEST: 'Return Request',
  WARRANTY_CLAIM: 'Warranty Claim',
  WARRANTY_TECHNICAL: 'Warranty — Technical',
  MISSING_INFO: 'Missing Info',
  OTHER: 'Other',
}

export default function Home() {
  const [email, setEmail] = useState('')
  const [topic, setTopic] = useState('No topic (classify automatically)')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError('')
    setResult(null)

    try {
      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailContent: email,
          topic: topic === 'No topic (classify automatically)' ? null : topic,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResult(data)
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  function copyDraft() {
    if (result?.draft_response) {
      navigator.clipboard.writeText(result.draft_response)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  function reset() {
    setResult(null)
    setEmail('')
    setError('')
    setTopic('No topic (classify automatically)')
  }

  const classColor = result ? CLASSIFICATION_COLORS[result.classification] || 'gray' : 'gray'

  return (
    <div className={styles.app}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.logo}>
            <div className={styles.logoIcon}>☀</div>
            <div>
              <div className={styles.logoName}>ShopSolar</div>
              <div className={styles.logoSub}>Email Support AI</div>
            </div>
          </div>
          <div className={styles.headerBadge}>Draft Mode — Human Review Required</div>
        </div>
      </header>

      <main className={styles.main}>
        {!result ? (
          /* INPUT PANEL */
          <div className={styles.inputPanel}>
            <div className={styles.panelHeader}>
              <h1 className={styles.panelTitle}>Draft a Response</h1>
              <p className={styles.panelSub}>Paste a customer email below. The AI will classify it, check the order in Shopify, and draft a response for your review.</p>
            </div>

            <form onSubmit={handleSubmit} className={styles.form}>
              <div className={styles.field}>
                <label className={styles.label}>Topic (from Slack workflow)</label>
                <select
                  className={styles.select}
                  value={topic}
                  onChange={e => setTopic(e.target.value)}
                >
                  {TOPICS.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <span className={styles.fieldNote}>If the ticket came through Slack with a topic already set, select it here. Otherwise leave as auto-classify.</span>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Customer Email</label>
                <textarea
                  className={styles.textarea}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="Paste the customer's email here — include the full message. The AI will extract the order number if present and look it up in Shopify automatically."
                  rows={12}
                />
              </div>

              {error && (
                <div className={styles.errorBox}>
                  <span>⚠</span> {error}
                </div>
              )}

              <button
                type="submit"
                className={styles.submitBtn}
                disabled={loading || !email.trim()}
              >
                {loading ? (
                  <span className={styles.loadingRow}>
                    <span className={styles.spinner} />
                    Drafting response...
                  </span>
                ) : (
                  'Generate Draft →'
                )}
              </button>
            </form>
          </div>
        ) : (
          /* RESULT PANEL */
          <div className={styles.resultPanel}>
            {/* Top bar */}
            <div className={styles.resultTopBar}>
              <button className={styles.backBtn} onClick={reset}>← New Email</button>
              <div className={styles.resultMeta}>
                <span className={`${styles.classTag} ${styles[`class_${classColor}`]}`}>
                  {CLASSIFICATION_LABELS[result.classification] || result.classification}
                </span>
                <span className={`${styles.confidenceBadge} ${result.confidence === 'HIGH' ? styles.confHigh : result.confidence === 'MEDIUM' ? styles.confMed : styles.confLow}`}>
                  {result.confidence} confidence
                </span>
              </div>
            </div>

            <div className={styles.resultGrid}>
              {/* Left column */}
              <div className={styles.resultLeft}>

                {/* Summary card */}
                <div className={styles.card}>
                  <div className={styles.cardLabel}>Issue Summary</div>
                  <p className={styles.summaryText}>{result.summary}</p>
                </div>

                {/* Routing card */}
                <div className={styles.card}>
                  <div className={styles.cardLabel}>Route To</div>
                  <div className={styles.routeTag}>{result.routing}</div>
                </div>

                {/* Order details */}
                {result.orderDetails && (
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>Order Lookup — Shopify</div>
                    <div className={styles.orderGrid}>
                      <div className={styles.orderRow}>
                        <span className={styles.orderKey}>Order</span>
                        <span className={styles.orderVal}>{result.orderDetails.orderNumber}</span>
                      </div>
                      <div className={styles.orderRow}>
                        <span className={styles.orderKey}>Customer</span>
                        <span className={styles.orderVal}>{result.orderDetails.customerName}</span>
                      </div>
                      <div className={styles.orderRow}>
                        <span className={styles.orderKey}>Purchase date</span>
                        <span className={styles.orderVal}>{result.orderDetails.createdAt}</span>
                      </div>
                      <div className={styles.orderRow}>
                        <span className={styles.orderKey}>Days since purchase</span>
                        <span className={styles.orderVal}>{result.orderDetails.daysSincePurchase} days</span>
                      </div>
                      <div className={styles.orderRow}>
                        <span className={styles.orderKey}>Return window</span>
                        <span className={`${styles.orderVal} ${result.orderDetails.withinReturnWindow ? styles.valGreen : styles.valRed}`}>
                          {result.orderDetails.withinReturnWindow ? '✓ Within 30 days' : '✗ Past 30 days'}
                        </span>
                      </div>
                      <div className={styles.orderRow}>
                        <span className={styles.orderKey}>Order total</span>
                        <span className={styles.orderVal}>{result.orderDetails.totalPrice}</span>
                      </div>
                    </div>
                    {result.orderDetails.lineItems?.length > 0 && (
                      <div className={styles.lineItems}>
                        <div className={styles.lineItemsLabel}>Products</div>
                        {result.orderDetails.lineItems.map((item: any, i: number) => (
                          <div key={i} className={styles.lineItem}>
                            <span className={styles.lineItemName}>{item.name}</span>
                            <span className={styles.lineItemSku}>{item.sku}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Missing info */}
                {result.missing_info?.length > 0 && (
                  <div className={`${styles.card} ${styles.cardAmber}`}>
                    <div className={styles.cardLabel}>Missing Information</div>
                    <ul className={styles.missingList}>
                      {result.missing_info.map((item: string, i: number) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Internal notes */}
                {result.internal_notes && (
                  <div className={`${styles.card} ${styles.cardBlue}`}>
                    <div className={styles.cardLabel}>Agent Notes</div>
                    <p className={styles.notesText}>{result.internal_notes}</p>
                  </div>
                )}
              </div>

              {/* Right column — draft */}
              <div className={styles.resultRight}>
                <div className={styles.draftCard}>
                  <div className={styles.draftHeader}>
                    <div className={styles.cardLabel}>Drafted Response</div>
                    <button className={styles.copyBtn} onClick={copyDraft}>
                      {copied ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className={styles.draftWarning}>
                    ⚠ Review before sending — replace [AGENT NAME] with your name
                  </div>
                  <pre className={styles.draftContent}>{result.draft_response}</pre>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
