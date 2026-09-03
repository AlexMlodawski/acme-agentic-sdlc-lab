"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import styles from "@/components/AssistantPanel.module.css";
import portalStyles from "@/components/SupportPortal.module.css";
import { sendAssistantMessage } from "@/lib/portalClient";
import type { AgentReply } from "@/lib/types";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  source?: AgentReply["source"];
}

export interface AssistantPanelProps {
  orderId: string;
  threadId: string | undefined;
  onThreadIdChange: (id: string | undefined) => void;
  onReset: () => void;
}

export function AssistantPanel({ orderId, threadId, onThreadIdChange, onReset }: AssistantPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ text: string; retryPayload: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    if (typeof bottomRef.current?.scrollIntoView === "function") {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, []);

  useEffect(() => {
    if (messages.length > 0) scrollToBottom();
  }, [messages, scrollToBottom]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setDraft("");
    setError(null);
    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setLoading(true);

    let reply: AgentReply;
    try {
      reply = await sendAssistantMessage({ message: trimmed, orderId, threadId });
    } catch {
      setLoading(false);
      setError({ text: "The support assistant is temporarily unavailable. Your message was not lost.", retryPayload: trimmed });
      return;
    }

    setLoading(false);
    if (reply.threadId) onThreadIdChange(reply.threadId);
    setMessages((prev) => [
      ...prev,
      { role: "assistant", text: reply.message, source: reply.source },
    ]);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft);
  }

  function handleReset() {
    setMessages([]);
    setDraft("");
    setError(null);
    onReset();
  }

  const isEmpty = messages.length === 0 && !loading && !error;

  return (
    <section
      id="assistant-panel"
      className={styles.assistantPanel}
      data-testid="assistant-panel"
      aria-labelledby="assistant-panel-heading"
    >
      <div className={styles.assistantPanelHeader}>
        <div>
          <p className={portalStyles.sectionLabel}>Order support</p>
          <h3 id="assistant-panel-heading">Ask about this order</h3>
        </div>
        {messages.length > 0 && (
          <button
            className={styles.assistantResetButton}
            data-testid="assistant-reset"
            type="button"
            onClick={handleReset}
          >
            Start over
          </button>
        )}
      </div>

      <div
        className={styles.assistantMessages}
        data-testid="assistant-messages"
        aria-live="polite"
        aria-label="Conversation"
        role="log"
      >
        {isEmpty && (
          <p className={styles.assistantEmpty}>
            Ask about your delivery status, return options, or what to do next.
          </p>
        )}
        {messages.length > 0 && (
          <ol className={styles.assistantMessageList}>
            {messages.map((msg, i) => (
              <li
                key={i}
                className={msg.role === "user" ? styles.assistantMsgUser : styles.assistantMsgAssistant}
                data-role={msg.role}
                data-testid={msg.role === "user" ? "assistant-msg-user" : "assistant-msg-assistant"}
              >
                <span className={styles.assistantMsgMeta}>
                  <span className={styles.assistantMsgRole} aria-hidden="true">
                    {msg.role === "user" ? "You" : "Support"}
                  </span>
                  {msg.role === "assistant" && msg.source && (
                    <span className={styles.assistantSource} data-testid="assistant-source">
                      Source: {msg.source === "orchestrate" ? "watsonx Orchestrate" : "Local mock"}
                    </span>
                  )}
                </span>
                <p>{msg.text}</p>
              </li>
            ))}
          </ol>
        )}
        {loading && (
          <div className={styles.assistantMsgAssistant} data-testid="assistant-thinking" aria-label="Support is responding">
            <span className={styles.assistantMsgRole} aria-hidden="true">Support</span>
            <span className={styles.assistantTyping} aria-hidden="true">
              <i /><i /><i />
            </span>
          </div>
        )}
        {error && (
          <div className={styles.assistantError} data-testid="assistant-error" role="alert">
            <p>{error.text}</p>
            <button
              className={styles.assistantRetryButton}
              data-testid="assistant-retry"
              type="button"
              onClick={() => {
                void sendMessage(error.retryPayload);
              }}
            >
              Try again
            </button>
          </div>
        )}
        <div ref={bottomRef} aria-hidden="true" />
      </div>

      <form
        className={styles.assistantForm}
        onSubmit={handleSubmit}
        data-testid="assistant-form"
      >
        <div className={styles.assistantInputRow}>
          <label htmlFor="assistant-input" className={styles.srOnly}>Your question</label>
          <input
            id="assistant-input"
            data-testid="assistant-input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="Ask a question about this order…"
            maxLength={1000}
            value={draft}
            disabled={loading}
            onChange={(e) => setDraft(e.target.value)}
            aria-describedby={error ? "assistant-error-hint" : undefined}
          />
          <button
            className={portalStyles.primaryButton}
            data-testid="assistant-send"
            type="submit"
            disabled={loading || draft.trim().length === 0}
          >
            {loading ? (
              <span className={portalStyles.loadingLabel} role="status">
                <span className={portalStyles.spinner} aria-hidden="true" />
                Sending
              </span>
            ) : "Send"}
          </button>
        </div>
        <p className={styles.assistantDisclaimer}>
          Answers are for guidance only and do not constitute a promise or approval.
          For account changes, use <a href="#contact">customer care</a>.
        </p>
      </form>
    </section>
  );
}
