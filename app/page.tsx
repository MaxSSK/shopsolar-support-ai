'use client'
import { useState } from 'react'
import styles from './page.module.css'

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
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [slackText, setSlackText] = useState('')
  const [ticketNumber, setTicketNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setResult(null)

    try {
      const body = mode === 'new'
        ? { mode: 'new', slackText }
        : { mode: 'existing', ticketNumber }

      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
    setSlackText('')
    setTicketNumber('')
    setError('')
  }

  const classColor = result ? CLASSIFICATION_COLORS[result.classification] || 'gray' : 'gray'
  const isValid = mode === 'new' ? slackText.trim().length > 0 : ticketNumber.trim().length > 0

  return (
    <div className={styles.app}>
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
          <div className={styles.inputPanel}>
            <div className={styles.panelHeader}>
              <h1 className={styles.panelTitle}>Draft a Response</h1>
              <p className={styles.panelSub}>Choose a mode below — new ticket from Slack, or a follow-up on an existing Zoho ticket.</p>
            </div>

            {/* Mode switcher */}
            <div className={styles.modeSwitcher}>
              <button
                className={`${styles.modeBtn} ${mode === 'new' ? styles.modeBtnActive : ''}`}
                onClick={() => { setMode('new'); setError('') }}
                type="button"
              >
                <span className={styles.modeIcon}>✦</span>
                <div>
                  <div className={styles.modeName}>New Ticket</div>
                  <div className={styles.modeSub}>Paste Slack workflow message → draft first email to customer</div>
                </div>
              </button>
              <button
                className={`${styles.modeBtn} ${mode === 'existing' ? styles.modeBtnActive : ''}`}
                onClick={() => { setMode('existing'); setError('') }}
                type="button"
              >
                <span className={styles.modeIcon}>↺</span>
                <div>
                  <div className={styles.modeName}>Existing Ticket</div>
                  <div className={styles.modeSub}>Enter Zoho ticket # → draft next reply in conversation</div>
                </div>
              </button>
            </div>

            <form onSubmit={handleSubmit} className={styles.form}>
              {mode === 'new' ? (
                <div className={styles.field}>
                  <label className={styles.label}>Slack Workflow Message</label>
                  <textarea
                    className={styles.textarea}
                    value={slackText}
                    onChange={e => setSlackText(e.target.value)}
                    placeholder={`Paste the Slack service request here. Example:\n\nService Request [5:16 PM]\nService Ticket Added by @Bruce  Topic: Warranty  Customer Name: Angela LaPointe  Customer Email: angelalapointe33@gmail.com  Shopify Link: https://admin.shopify.com/store/shopsolarkits/orders/5155457335436\n\nThe AI will extract all fields and pull the Shopify order notes automatically.`}
                    rows={10}
                  />
                  <span className={styles.fieldNote}>The AI will extract customer name, email, topic, and Shopify link — then pull the full order details and notes automatically.</span>
                </div>
              ) : (
                <div className={styles.field}>
                  <label className={styles.label}>Zoho Desk Ticket Number</label>
                  <input
                    className={styles.input}
                    value={ticketNumber}
                    onChange={e => setTicketNumber(e.target.value)}
                    placeholder="e.g. 234618 or #234618"
                    type="text"
                  />
                  <span className={styles.fieldNote}>The AI will pull the full conversation thread from Zoho Desk and the Shopify order notes, then draft the next reply.</span>
                </div>
              )}

              {error && (
                <div className={styles.errorBox}>⚠ {error}</div>
              )}

              <button
                type="submit"
                className={styles.submitBtn}
                disabled={loading || !isValid}
              >
                {loading ? (
                  <span className={styles.loadingRow}>
                    <span className={styles.spinner} />
                    {mode === 'new' ? 'Reading Slack & Shopify...' : 'Reading Zoho & Shopify...'}
                  </span>
                ) : (
                  mode === 'new' ? 'Draft First Email →' : 'Draft Next Reply →'
                )}
              </button>
            </form>
          </div>
        ) : (
          <div className={styles.resultPanel}>
            <div className={styles.resultTopBar}>
              <button className={styles.backBtn} onClick={reset}>← New Draft</button>
              <div className={styles.resultMeta}>
                <span className={`${styles.modePill} ${result.mode === 'new' ? styles.modeNew : styles.modeExisting}`}>
                  {result.mode === 'new' ? '✦ New Ticket' : '↺ Existing Ticket'}
                </span>
                <span className={`${styles.classTag} ${styles[`class_${classColor}`]}`}>
                  {CLASSIFICATION_LABELS[result.classification] || result.classification}
                </span>
                <span className={`${styles.confidenceBadge} ${result.confidence === 'HIGH' ? styles.confHigh : result.confidence === 'MEDIUM' ? styles.confMed : styles.confLow}`}>
                  {result.confidence} confidence
                </span>
              </div>
            </div>

            <div className={styles.resultGrid}>
              <div className={styles.resultLeft}>

                <div className={styles.card}>
                  <div className={styles.cardLabel}>Issue Summary</div>
                  <p className={styles.summaryText}>{result.summary}</p>
                </div>

                <div className={styles.card}>
                  <div className={styles.cardLabel}>Route To</div>
                  <div className={styles.routeTag}>{result.routing}</div>
                </div>

                {/* Slack extracted data (new mode) */}
                {result.slackData && (
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>Extracted from Slack</div>
                    <div className={styles.orderGrid}>
                      {result.slackData.customerName && <div className={styles.orderRow}><span className={styles.orderKey}>Customer</span><span className={styles.orderVal}>{result.slackData.customerName}</span></div>}
                      {result.slackData.customerEmail && <div className={styles.orderRow}><span className={styles.orderKey}>Email</span><span className={styles.orderVal}>{result.slackData.customerEmail}</span></div>}
                      {result.slackData.topic && <div className={styles.orderRow}><span className={styles.orderKey}>Topic</span><span className={styles.orderVal}>{result.slackData.topic}</span></div>}
                    </div>
                  </div>
                )}

                {/* Zoho ticket info (existing mode) */}
                {result.zohoTicket && (
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>Zoho Ticket</div>
                    <div className={styles.orderGrid}>
                      <div className={styles.orderRow}><span className={styles.orderKey}>Subject</span><span className={styles.orderVal}>{result.zohoTicket.subject}</span></div>
                      <div className={styles.orderRow}><span className={styles.orderKey}>Status</span><span className={styles.orderVal}>{result.zohoTicket.status}</span></div>
                      <div className={styles.orderRow}><span className={styles.orderKey}>Threads read</span><span className={styles.orderVal}>{result.threadCount}</span></div>
                      {result.zohoTicket.assignee && <div className={styles.orderRow}><span className={styles.orderKey}>Assigned to</span><span className={styles.orderVal}>{result.zohoTicket.assignee.firstName} {result.zohoTicket.assignee.lastName}</span></div>}
                    </div>
                  </div>
                )}

                {/* Order details */}
                {result.orderDetails && (
                  <div className={styles.card}>
                    <div className={styles.cardLabel}>Shopify Order</div>
                    <div className={styles.orderGrid}>
                      <div className={styles.orderRow}><span className={styles.orderKey}>Order</span><span className={styles.orderVal}>{result.orderDetails.orderNumber}</span></div>
                      <div className={styles.orderRow}><span className={styles.orderKey}>Customer</span><span className={styles.orderVal}>{result.orderDetails.customerName}</span></div>
                      <div className={styles.orderRow}><span className={styles.orderKey}>Purchase date</span><span className={styles.orderVal}>{result.orderDetails.createdAt}</span></div>
                      <div className={styles.orderRow}><span className={styles.orderKey}>Days since purchase</span><span className={styles.orderVal}>{result.orderDetails.daysSincePurchase} days</span></div>
                      <div className={styles.orderRow}>
                        <span className={styles.orderKey}>Return window</span>
                        <span className={`${styles.orderVal} ${result.orderDetails.withinReturnWindow ? styles.valGreen : styles.valRed}`}>
                          {result.orderDetails.withinReturnWindow ? '✓ Within 30 days' : '✗ Past 30 days'}
                        </span>
                      </div>
                      <div className={styles.orderRow}><span className={styles.orderKey}>Order total</span><span className={styles.orderVal}>{result.orderDetails.totalPrice}</span></div>
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
                    {result.orderDetails.orderNote && (
                      <div className={styles.orderNotes}>
                        <div className={styles.lineItemsLabel}>Order Notes</div>
                        <p className={styles.orderNoteText}>{result.orderDetails.orderNote}</p>
                      </div>
                    )}
                  </div>
                )}

                {result.missing_info?.length > 0 && (
                  <div className={`${styles.card} ${styles.cardAmber}`}>
                    <div className={styles.cardLabel}>Missing Information</div>
                    <ul className={styles.missingList}>
                      {result.missing_info.map((item: string, i: number) => <li key={i}>{item}</li>)}
                    </ul>
                  </div>
                )}

                {result.internal_notes && (
                  <div className={`${styles.card} ${styles.cardBlue}`}>
                    <div className={styles.cardLabel}>Agent Notes</div>
                    <p className={styles.notesText}>{result.internal_notes}</p>
                  </div>
                )}
              </div>

              <div className={styles.resultRight}>
                <div className={styles.draftCard}>
                  <div className={styles.draftHeader}>
                    <div className={styles.cardLabel}>
                      {result.mode === 'new' ? 'First Contact Draft' : 'Next Reply Draft'}
                    </div>
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
