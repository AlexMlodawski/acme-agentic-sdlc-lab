"use client";

import { type FormEvent, useState } from "react";

import assistantStyles from "@/components/AssistantPanel.module.css";
import { AssistantPanel } from "@/components/AssistantPanel";
import styles from "@/components/SupportPortal.module.css";
import {
  formatDeliveryDate,
  formatOrderStatus,
  getOrderStatusTone,
} from "@/lib/formatters";
import { getOrderPresentation, getOrderTimeline } from "@/lib/orderPresentation";
import { lookupOrder, PortalApiError } from "@/lib/portalClient";
import {
  createSupportCase,
  getDemoCorrelationId,
  SupportClientError,
} from "@/lib/supportClient";
import type { OrderRecord, SupportCaseResult, SupportPriority } from "@/lib/types";

interface CaseErrorState {
  correlationId: string;
  code: string;
  status: number;
}

export function SupportPortal() {
  const [orderId, setOrderId] = useState("");
  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [priority, setPriority] = useState<SupportPriority>("normal");
  const [description, setDescription] = useState("");
  const [caseLoading, setCaseLoading] = useState(false);
  const [caseError, setCaseError] = useState<CaseErrorState | null>(null);
  const [caseResult, setCaseResult] = useState<SupportCaseResult | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantThreadId, setAssistantThreadId] = useState<string | undefined>(undefined);

  async function handleOrderLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedOrderId = orderId.trim().toUpperCase();

    if (!/^ACME-\d{4}$/.test(normalizedOrderId)) {
      setOrder(null);
      setOrderError("Enter an order ID in the format ACME-1234.");
      return;
    }

    setOrderId(normalizedOrderId);
    setOrderLoading(true);
    setOrderError(null);
    setOrder(null);
    setPriority("normal");
    setDescription("");
    setCaseError(null);
    setCaseResult(null);
    setAssistantOpen(false);
    setAssistantThreadId(undefined);

    try {
      setOrder(await lookupOrder(normalizedOrderId));
    } catch (error) {
      setOrderError(
        error instanceof PortalApiError && error.status === 404
          ? "We couldn't find that order. Check the ID and try again."
          : "Order details are unavailable right now. Please try again shortly.",
      );
    } finally {
      setOrderLoading(false);
    }
  }

  async function handleCaseSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!order || description.trim().length < 10 || caseLoading) {
      return;
    }

    setCaseLoading(true);
    setCaseError(null);
    setCaseResult(null);

    try {
      const result = await createSupportCase({
        orderId: order.orderId,
        selectedPriority: priority,
        description,
      });
      setCaseResult(result);
    } catch (error) {
      setCaseError(
        error instanceof SupportClientError
          ? {
              correlationId: error.correlationId,
              code: error.code,
              status: error.status,
            }
          : {
              correlationId: getDemoCorrelationId(),
              code: "SUPPORT_CASE_REQUEST_FAILED",
              status: 0,
            },
      );
    } finally {
      setCaseLoading(false);
    }
  }

  return (
    <div className={styles.portal} data-testid="customer-support-portal">
      <a className={styles.skipLink} href="#main-content">Skip to main content</a>

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a className={styles.brand} href="#top" aria-label="Acme customer care home">
            <span className={styles.brandMark} aria-hidden="true">A</span>
            <span className={styles.brandName}>Acme</span>
            <span className={styles.brandDivision}>Orders &amp; support</span>
          </a>
          <nav className={styles.navigation} aria-label="Customer care navigation">
            <a href="#orders">Orders</a>
            <a href="#returns">Returns &amp; refunds</a>
            <a href="#contact">Customer care</a>
          </nav>
          <a className={styles.headerLink} href="#orders">Track an order</a>
        </div>
      </header>

      <main id="main-content">
        <section className={styles.intro} id="top" aria-labelledby="page-title">
          <div className={styles.introCopy}>
            <p className={styles.kicker}>Acme customer care</p>
            <h1 id="page-title">Support for every step of your order.</h1>
            <p className={styles.lede}>
              Track a shipment, understand your return options, or get personal help with
              an order — all in one place.
            </p>
            <ul className={styles.serviceNotes} aria-label="Customer care benefits">
              <li>Fictional carrier status</li>
              <li>30-day return guidance</li>
              <li>Synthetic order lookup</li>
            </ul>
          </div>

          <section className={styles.lookupPanel} id="orders" aria-labelledby="order-lookup-heading">
            <div className={styles.lookupHeading}>
              <span className={styles.lookupIcon} aria-hidden="true"><i /></span>
              <div>
                <p className={styles.sectionLabel}>Order lookup</p>
                <h2 id="order-lookup-heading">Find your order</h2>
                <p>Enter the order ID from your confirmation email.</p>
              </div>
            </div>
            <form className={styles.lookupForm} onSubmit={handleOrderLookup} noValidate>
              <div className={styles.field}>
                <label htmlFor="order-id">Order ID</label>
                <div className={styles.lookupControl}>
                  <input
                    id="order-id"
                    data-testid="order-id-input"
                    name="orderId"
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="ACME-1042"
                    value={orderId}
                    onChange={(event) => setOrderId(event.target.value)}
                    aria-describedby={orderError ? "order-id-hint order-id-error" : "order-id-hint"}
                    aria-invalid={Boolean(orderError)}
                  />
                  <button
                    className={styles.primaryButton}
                    data-testid="order-lookup-button"
                    type="submit"
                    disabled={orderLoading}
                  >
                    {orderLoading ? <LoadingLabel label="Finding order" /> : (
                      <span className={styles.buttonLabel}>Find order <i aria-hidden="true">→</i></span>
                    )}
                  </button>
                </div>
                <span className={styles.fieldHint} id="order-id-hint">Example: ACME-1042</span>
              </div>
            </form>
            {orderError ? (
              <div className={styles.errorNotice} data-testid="order-lookup-error" id="order-id-error" role="alert">
                <span aria-hidden="true">!</span>
                <p>{orderError}</p>
              </div>
            ) : null}
            <div className={styles.lookupTrust} aria-label="Order lookup privacy information">
              <span className={styles.lockIcon} aria-hidden="true"><i /></span>
              <p><strong>Demo-safe lookup</strong><span>Uses fictional data; no account or payment details required.</span></p>
            </div>
          </section>
        </section>

        {order
          ? (
              <OrderDetail
                order={order}
                assistantOpen={assistantOpen}
                onAssistantToggle={() => setAssistantOpen((prev) => !prev)}
                assistantThreadId={assistantThreadId}
                onThreadIdChange={setAssistantThreadId}
                onAssistantReset={() => {
                  setAssistantThreadId(undefined);
                }}
              />
            )
          : <ServiceOverview />}

        <div className={styles.supportGrid}>
          <ReturnPolicy />
          <section className={styles.caseSection} id="contact" aria-labelledby="case-heading">
            <p className={styles.sectionLabel}>Customer care</p>
            <h2 id="case-heading">Start a sample support case</h2>
            <p className={styles.sectionIntro}>
              The local lab returns a synthetic receipt. It does not contact a real support team.
            </p>

            {!order ? (
              <div className={styles.lockedNotice} data-testid="support-case-order-required">
                <span aria-hidden="true">01</span>
                <div>
                  <strong>Look up your order first</strong>
                  <p>Your order details will be attached to the case automatically.</p>
                </div>
              </div>
            ) : (
              <form className={styles.caseForm} onSubmit={handleCaseSubmit}>
                <div className={styles.formRow}>
                  <div className={styles.field}>
                    <label htmlFor="case-order-id">Order</label>
                    <input id="case-order-id" value={order.orderId} readOnly />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="priority">Priority</label>
                    <select
                      id="priority"
                      data-testid="priority-select"
                      value={priority}
                      onChange={(event) => setPriority(event.target.value as SupportPriority)}
                    >
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>
                </div>
                <div className={styles.field}>
                  <label htmlFor="case-description">How can we help?</label>
                  <textarea
                    id="case-description"
                    data-testid="support-case-description"
                    rows={5}
                    minLength={10}
                    maxLength={1000}
                    required
                    placeholder="Describe the issue and the outcome you need."
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    aria-describedby="case-description-hint"
                  />
                  <span className={styles.fieldHint} id="case-description-hint">
                    10-1000 characters. Do not include payment details or passwords.
                  </span>
                </div>

                {caseError ? (
                  <div
                    className={styles.errorFeedback}
                    data-testid="support-case-error"
                    data-http-status={caseError.status}
                    data-error-code={caseError.code}
                    role="alert"
                  >
                    <span aria-hidden="true">!</span>
                    <div>
                      <strong>We couldn&apos;t create your support case.</strong>
                      <p>Please try again shortly or share this reference with customer care.</p>
                      <code data-testid="support-case-correlation-id">{caseError.correlationId}</code>
                    </div>
                  </div>
                ) : null}

                {caseResult ? (
                  <div
                    className={styles.successFeedback}
                    data-testid="support-case-success"
                    data-correlation-id={caseResult.correlationId}
                    role="status"
                  >
                    <span aria-hidden="true">✓</span>
                    <div>
                      <strong>A synthetic support case receipt was created.</strong>
                      <p>No external ticket was created or scheduled for follow-up.</p>
                      <span className={styles.caseIdLabel}>Case ID</span>
                      <code data-testid="support-case-id">{caseResult.caseId}</code>
                    </div>
                  </div>
                ) : null}

                <div className={styles.caseActions}>
                  <span>Local lab — no real follow-up</span>
                  <button
                    className={styles.primaryButton}
                    data-testid="create-support-case-button"
                    type="submit"
                    disabled={caseLoading || description.trim().length < 10}
                  >
                    {caseLoading ? <LoadingLabel label="Creating sample case" /> : "Create sample support case"}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>

        <section className={styles.contactStrip} data-testid="contact-options" aria-labelledby="more-help-heading">
          <div>
            <p className={styles.sectionLabel}>More ways to reach us</p>
            <h2 id="more-help-heading">Prefer to speak with someone?</h2>
          </div>
          <div className={styles.contactOptions}>
            <a href="tel:+18005550142">
              <span>Call customer care</span>
              <strong>1 800 555 0142</strong>
            </a>
            <a href="mailto:care@acme.example">
              <span>Email us</span>
              <strong>care@acme.example</strong>
            </a>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div>
          <span>© 2026 Acme Commerce</span>
          <nav aria-label="Legal navigation">
            <a href="#top">Privacy</a>
            <a href="#top">Terms</a>
            <a href="#top">Accessibility</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function LoadingLabel({ label }: { label: string }) {
  return (
    <span className={styles.loadingLabel} role="status">
      <span className={styles.spinner} aria-hidden="true" />
      {label}
    </span>
  );
}

function ServiceOverview() {
  return (
    <section className={styles.serviceOverview} aria-labelledby="service-overview-heading">
      <div className={styles.overviewHeading}>
        <p className={styles.sectionLabel}>Self-service support</p>
        <h2 id="service-overview-heading">A clear path from shipment to resolution.</h2>
      </div>
      <ol className={styles.overviewSteps}>
        <li>
          <span>01</span>
          <div><strong>Track progress</strong><p>See the sample status and delivery estimate.</p></div>
        </li>
        <li>
          <span>02</span>
          <div><strong>Review your options</strong><p>Check timing, eligibility, and refund guidance.</p></div>
        </li>
        <li>
          <span>03</span>
          <div><strong>Exercise the flow</strong><p>Create a sample receipt with the order attached.</p></div>
        </li>
      </ol>
    </section>
  );
}

interface OrderDetailProps {
  order: OrderRecord;
  assistantOpen: boolean;
  onAssistantToggle: () => void;
  assistantThreadId: string | undefined;
  onThreadIdChange: (id: string | undefined) => void;
  onAssistantReset: () => void;
}

function OrderDetail({
  order,
  assistantOpen,
  onAssistantToggle,
  assistantThreadId,
  onThreadIdChange,
  onAssistantReset,
}: OrderDetailProps) {
  const presentation = getOrderPresentation(order.orderId);
  const timeline = getOrderTimeline(order);
  const tone = getOrderStatusTone(order.status);

  return (
    <section className={styles.orderDetail} data-testid="order-status-card" aria-labelledby="order-status-heading">
      <div className={styles.orderHeading}>
        <div>
          <p className={styles.sectionLabel}>Order details</p>
          <h2 id="order-status-heading">Delivery update</h2>
          <p className={styles.orderIdentity}>
            <strong>{order.orderId}</strong>
            <span aria-hidden="true">/</span>
            <span>{order.customerName}</span>
          </p>
        </div>
        <div className={styles.statusCluster}>
          <span className={`${styles.statusBadge} ${styles[tone]}`} data-testid="order-status-value">
            <i aria-hidden="true" />
            {formatOrderStatus(order.status)}
          </span>
          <small>Estimated {formatDeliveryDate(order.estimatedDeliveryDate)}</small>
        </div>
      </div>

      <ol className={styles.timeline} data-testid="order-timeline" aria-label={`Order status: ${formatOrderStatus(order.status)}`}>
        {timeline.map((step) => (
          <li className={styles[step.state]} key={step.label} aria-current={step.state === "current" ? "step" : undefined}>
            <span className={styles.timelineMarker} aria-hidden="true" />
            <div><strong>{step.label}</strong><small>{step.detail}</small></div>
          </li>
        ))}
      </ol>

      <div className={styles.orderBody}>
        <div className={styles.itemColumn}>
          <h3>Items in this order</h3>
          <div className={styles.lineItem} data-testid="order-line-item">
            <div className={styles.productVisual} aria-hidden="true">
              <span className={styles.productHandle} />
              <span className={styles.productBody}><i /><i /></span>
            </div>
            <div className={styles.itemDescription}>
              <strong>{presentation.itemName}</strong>
              <span>{presentation.itemVariant}</span>
              <small>SKU {presentation.sku}</small>
            </div>
            <span className={styles.quantity}>Qty {presentation.quantity}</span>
            <strong>{presentation.subtotal}</strong>
          </div>
          <dl className={styles.fulfilmentDetails}>
            <div>
              <dt>Estimated delivery</dt>
              <dd data-testid="order-delivery-date">{formatDeliveryDate(order.estimatedDeliveryDate)}</dd>
            </div>
            <div><dt>Carrier</dt><dd>{order.carrier}</dd></div>
            <div><dt>Tracking number</dt><dd>{order.trackingNumber}</dd></div>
            <div><dt>Delivery area</dt><dd>{presentation.destination}</dd></div>
          </dl>
          <p className={styles.returnEligibility}>
            <strong>Return eligibility</strong>
            <span>{presentation.returnSummary}</span>
          </p>
        </div>
        <aside className={styles.orderSummary} aria-label="Order summary">
          <div className={styles.summaryHeading}>
            <h3>Order summary</h3>
            <span>1 item</span>
          </div>
          <dl>
            <div><dt>Subtotal</dt><dd>{presentation.subtotal}</dd></div>
            <div><dt>Shipping</dt><dd>{presentation.shipping}</dd></div>
            <div><dt>Tax</dt><dd>{presentation.tax}</dd></div>
            <div className={styles.total}><dt>Total</dt><dd>{presentation.total}</dd></div>
          </dl>
          <a href="#contact">Get help with this order <span aria-hidden="true">→</span></a>
          <p className={styles.paymentNote}>
            <span aria-hidden="true">✓</span>
            Payment received
          </p>
          <div className={assistantStyles.assistantEntry}>
            <button
              className={assistantStyles.assistantToggle}
              data-testid="assistant-toggle"
              type="button"
              aria-expanded={assistantOpen}
              aria-controls="assistant-panel"
              onClick={onAssistantToggle}
            >
              <span className={assistantStyles.assistantToggleIcon} aria-hidden="true" />
              {assistantOpen ? "Close support assistant" : "Ask about this order"}
            </button>
          </div>
        </aside>
      </div>
      {assistantOpen && (
        <AssistantPanel
          orderId={order.orderId}
          threadId={assistantThreadId}
          onThreadIdChange={onThreadIdChange}
          onReset={onAssistantReset}
        />
      )}
    </section>
  );
}

function ReturnPolicy() {
  return (
    <section className={styles.returnSection} id="returns" data-testid="return-policy-card" aria-labelledby="return-policy-heading">
      <p className={styles.sectionLabel}>Returns and refunds</p>
      <h2 id="return-policy-heading">Know what to expect.</h2>
      <p className={styles.sectionIntro}>
        Most items can be reviewed for return within 30 days after delivery. Final eligibility is confirmed after inspection.
      </p>
      <dl className={styles.policyList}>
        <div><dt>Standard items</dt><dd>Start a return within 30 days of delivery.</dd></div>
        <div><dt>Opened items</dt><dd>Complete, undamaged items may be reviewed within 14 days.</dd></div>
        <div><dt>Damaged or incorrect</dt><dd>Contact us within 48 hours for priority handling.</dd></div>
        <div><dt>Refund timing</dt><dd>Timing is confirmed only after individual review.</dd></div>
      </dl>
      <p className={styles.policyNote}>
        Personalized and final-sale products are excluded. Approved damaged-item returns receive a prepaid label.
      </p>
    </section>
  );
}
