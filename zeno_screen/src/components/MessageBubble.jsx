import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  UserIcon, AlertCircleIcon,
  ChevronDownIcon, ChevronUpIcon, VideoIcon, CopyIcon, CheckIcon,
} from 'lucide-react'

function parseVisualResponse(text) {
  const get = (tag) => {
    const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))
    return m ? m[1].trim() : null
  }
  const explanation = get('explanation')
  return {
    isVisual:    explanation !== null,
    explanation,
    visual:      get('visual'),
    source:      get('source'),
  }
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <button
      onClick={copy}
      title="Copy"
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        background: 'none', border: 'none', cursor: 'pointer',
        color: copied ? 'var(--success)' : 'var(--text-muted)',
        fontSize: 11, padding: '3px 6px', borderRadius: 6,
        transition: 'color 0.15s',
      }}
    >
      {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function ScoreBar({ score }) {
  if (score == null || !isFinite(score)) return null
  const pct   = Math.round(score * 100)
  const color = score > 0.7 ? 'var(--success)'
              : score > 0.4 ? 'var(--warning)'
              : 'var(--text-muted)'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 10, color, fontFamily: 'var(--font-mono)',
      background: 'rgba(255,255,255,0.05)', borderRadius: 20,
      padding: '2px 8px', border: '1px solid rgba(255,255,255,0.07)',
    }}>
      {pct}%
    </span>
  )
}

export function MessageBubble({ message }) {
  const [sourcesOpen, setSourcesOpen] = useState(false)

  const isUser      = message.role === 'user'
  const isError     = message.role === 'error'
  const isAssistant = message.role === 'assistant'
  const hasSources  = isAssistant && message.sources?.length > 0

  return (
    <div
      className="fade-slide-up"
      style={{
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        gap: 12,
        width: '100%',
        alignItems: 'flex-start',
        padding: '4px 0',
      }}
    >
      {/* Avatar */}
      <div style={{
        width: 30, height: 30, borderRadius: 10, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: isUser      ? 'var(--user-bg)'
                  : isError     ? 'rgba(248,113,113,0.12)'
                  : 'var(--bg-elevated)',
        border: `1px solid ${
          isUser  ? 'var(--user-border)'
        : isError ? 'rgba(248,113,113,0.25)'
        : 'var(--border-strong)'}`,
        marginTop: 2,
      }}>
        {isUser      && <UserIcon size={14} color="var(--accent)" />}
        {isError     && <AlertCircleIcon size={14} color="var(--danger)" />}
        {isAssistant && (
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>Z</span>
        )}
      </div>

      {/* Bubble */}
      <div style={{ maxWidth: '78%', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>

        {/* Role label */}
        <p style={{
          fontSize: 11, fontWeight: 500, marginBottom: 5,
          color: isUser ? 'var(--accent)' : isError ? 'var(--danger)' : 'var(--text-muted)',
          letterSpacing: '0.04em',
        }}>
          {isUser ? 'You' : isError ? 'Error' : 'Zeno'}
        </p>

        {/* Message content */}
        <div style={{
          padding: isUser ? '10px 14px' : '12px 16px',
          borderRadius: isUser
            ? 'var(--radius-lg) var(--radius-sm) var(--radius-lg) var(--radius-lg)'
            : 'var(--radius-sm) var(--radius-lg) var(--radius-lg) var(--radius-lg)',
          background: isUser  ? 'var(--user-bg)'
                    : isError ? 'rgba(248,113,113,0.08)'
                    : 'var(--bg-elevated)',
          border: `1px solid ${
            isUser  ? 'var(--user-border)'
          : isError ? 'rgba(248,113,113,0.2)'
          : 'var(--border-strong)'}`,
          fontSize: 14, lineHeight: 1.7,
          color: isError ? 'var(--danger)' : 'var(--text-primary)',
          wordBreak: 'break-word',
        }}>
          {isUser || isError
            ? <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{message.content}</p>
            : (() => {
                const parsed = parseVisualResponse(message.content)
                if (parsed.isVisual) {
                  return (
                    <div>
                      <p style={{ margin: '0 0 10px', lineHeight: 1.7 }}>{parsed.explanation}</p>
                      {parsed.visual && (
                        <div
                          style={{ borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}
                          dangerouslySetInnerHTML={{ __html: parsed.visual }}
                        />
                      )}
                      {parsed.source && (
                        <span style={{
                          display: 'inline-block', fontSize: 10,
                          color: 'var(--text-muted)',
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 20, padding: '2px 8px',
                        }}>
                          {parsed.source === 'transcript' ? '📹 From video' : '🧠 General knowledge'}
                        </span>
                      )}
                    </div>
                  )
                }
                return (
                  <div className="prose-dark">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {message.content}
                    </ReactMarkdown>
                  </div>
                )
              })()
          }
        </div>

        {/* Actions row (assistant only) */}
        {isAssistant && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5 }}>
            <CopyButton text={message.content} />
            {hasSources && (
              <button
                onClick={() => setSourcesOpen(o => !o)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', fontSize: 11,
                  padding: '3px 6px', borderRadius: 6, transition: 'color 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
              >
                <VideoIcon size={12} />
                {message.sources.length} source{message.sources.length !== 1 ? 's' : ''}
                {sourcesOpen
                  ? <ChevronUpIcon size={11} />
                  : <ChevronDownIcon size={11} />
                }
              </button>
            )}
            {message.model && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 2, fontFamily: 'var(--font-mono)' }}>
                · {message.model}
              </span>
            )}
          </div>
        )}

        {/* Sources panel */}
        {isAssistant && hasSources && sourcesOpen && (
          <div style={{
            marginTop: 8, width: '100%',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            {message.sources.map((src, i) => {
              const ytUrl = src.video_id
                ? `https://www.youtube.com/watch?v=${src.video_id}&t=${Math.floor(src.start_seconds ?? 0)}s`
                : null
              return (
                <div key={i} style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 10, padding: '10px 12px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5, gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                      {ytUrl ? (
                        <a
                          href={ytUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontSize: 11, fontWeight: 500, color: 'var(--accent)',
                            fontFamily: 'var(--font-mono)',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            textDecoration: 'none',
                          }}
                          onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                          onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                        >
                          {src.title ?? src.source}
                        </a>
                      ) : (
                        <span style={{
                          fontSize: 11, fontWeight: 500, color: 'var(--accent)',
                          fontFamily: 'var(--font-mono)',
                        }}>
                          {src.title ?? src.source}
                        </span>
                      )}
                      {src.timestamp && (
                        <span style={{
                          fontSize: 10, color: 'var(--text-muted)', flexShrink: 0,
                          background: 'var(--bg-elevated)',
                          padding: '1px 5px', borderRadius: 4,
                          fontFamily: 'var(--font-mono)',
                        }}>
                          {src.timestamp}
                        </span>
                      )}
                    </div>
                    {src.score != null && <ScoreBar score={src.score} />}
                  </div>
                  <p style={{
                    fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55,
                    display: '-webkit-box', WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>
                    {src.content}
                  </p>
                </div>
              )
            })}
          </div>
        )}

        {/* Timestamp */}
        <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  )
}

export function TypingIndicator() {
  return (
    <div className="fade-slide-up" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{
        width: 30, height: 30, borderRadius: 10, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)',
        marginTop: 2,
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>Z</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <p style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 5 }}>Zeno</p>
        <div style={{
          padding: '12px 16px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-strong)',
          borderRadius: '4px 14px 14px 14px',
          display: 'flex', alignItems: 'center', gap: 5, height: 42,
        }}>
          {[0, 1, 2].map(i => (
            <span key={i} style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--accent)',
              display: 'block',
              animation: `pulseDot 1.2s ease-in-out ${i * 0.18}s infinite`,
            }} />
          ))}
        </div>
      </div>
    </div>
  )
}