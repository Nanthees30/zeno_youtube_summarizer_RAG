import { useState, useRef, useEffect } from 'react'
import { SendIcon, Loader2Icon } from 'lucide-react'

const MAX_CHARS    = 2000
const DEBOUNCE_MS  = 500   // prevent double-sends within 500 ms

export function ChatInput({ onSend, isLoading, disabled = false }) {
  const [value, setValue]       = useState('')
  const taRef                   = useRef(null)
  const lastSentAt              = useRef(0)   // timestamp of most recent submit

  // Auto-resize
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'
  }, [value])

  const submit = () => {
    const t = value.trim()
    if (!t || isLoading || disabled || t.length > MAX_CHARS) return
    // Debounce: swallow duplicate submits within DEBOUNCE_MS
    const now = Date.now()
    if (now - lastSentAt.current < DEBOUNCE_MS) return
    lastSentAt.current = now
    onSend(t)
    setValue('')
    if (taRef.current) taRef.current.style.height = 'auto'
  }

  const onKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  }

  const over   = value.length > MAX_CHARS
  const canSend = !isLoading && !disabled && value.trim() && !over

  return (
    <div style={{
      padding: '12px 16px 16px',
      background: 'var(--bg-base)',
      borderTop: '1px solid var(--border)',
      flexShrink: 0,
    }}>
      {/* Char warning */}
      {value.length > MAX_CHARS * 0.8 && (
        <p style={{
          fontSize: 11, textAlign: 'right', marginBottom: 4,
          color: over ? 'var(--danger)' : 'var(--warning)',
          fontFamily: 'var(--font-mono)',
        }}>
          {value.length}/{MAX_CHARS}
        </p>
      )}

      <div style={{ maxWidth: 800, margin: '0 auto', position: 'relative' }}>
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 0,
          background: 'var(--bg-elevated)',
          border: `1px solid ${over ? 'var(--danger)' : 'var(--border-strong)'}`,
          borderRadius: 'var(--radius-xl)',
          padding: '4px 4px 4px 16px',
          transition: 'border-color 0.15s, box-shadow 0.15s',
          boxShadow: value ? '0 0 0 2px var(--accent-glow)' : 'none',
        }}>
          <textarea
            ref={taRef}
            rows={1}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={disabled}
            placeholder={disabled ? 'Add a YouTube video first, then wait for "Index ready"…' : 'Ask anything about your video…'}
            className="chat-textarea"
            style={{
              flex: 1, resize: 'none', background: 'none',
              border: 'none', color: 'var(--text-primary)',
              fontSize: 14, lineHeight: 1.6,
              fontFamily: 'var(--font-sans)',
              padding: '8px 0',
              opacity: disabled ? 0.45 : 1,
              cursor: disabled ? 'not-allowed' : 'text',
            }}
          />

          <button
            onClick={submit}
            disabled={!canSend}
            style={{
              width: 38, height: 38, borderRadius: 14, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: canSend ? 'var(--accent)' : 'var(--bg-active)',
              border: 'none', cursor: canSend ? 'pointer' : 'not-allowed',
              transition: 'background 0.15s, transform 0.1s',
              marginBottom: 2,
            }}
            onMouseEnter={e => canSend && (e.currentTarget.style.background = 'var(--accent-hover)')}
            onMouseLeave={e => e.currentTarget.style.background = canSend ? 'var(--accent)' : 'var(--bg-active)'}
            onMouseDown={e => canSend && (e.currentTarget.style.transform = 'scale(0.92)')}
            onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            {isLoading
              ? <Loader2Icon size={16} color="var(--text-muted)" style={{ animation: 'spin 0.8s linear infinite' }} />
              : <SendIcon size={15} color={canSend ? '#fff' : 'var(--text-muted)'} />
            }
          </button>
        </div>

        <p style={{
          fontSize: 11, color: 'var(--text-muted)',
          textAlign: 'center', marginTop: 7,
        }}>
          <kbd style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)',
            borderRadius: 4, padding: '1px 5px', color: 'var(--text-secondary)',
          }}>Enter</kbd>
          {' '}to send{' · '}
          <kbd style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)',
            borderRadius: 4, padding: '1px 5px', color: 'var(--text-secondary)',
          }}>Shift+Enter</kbd>
          {' '}for newline
        </p>
      </div>
    </div>
  )
}