import { useRef, useEffect, useState, useCallback } from 'react'
import {
  PanelLeftIcon, Trash2Icon, CircleDotIcon,
} from 'lucide-react'
import { Sidebar }        from '../components/Sidebar'
import { MessageBubble, TypingIndicator } from '../components/MessageBubble'
import { ChatInput }      from '../components/ChatInput'
import { WelcomeScreen }  from '../components/WelcomeScreen'
import { useChat }        from '../hooks/useChat'
import { useChatHistory } from '../hooks/useChatHistory'

export default function ChatPage() {
  // Fix #15 — start sidebar collapsed on mobile (<= 768px)
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 768)
  const [mode, setMode]               = useState('agent')  // 'agent' | 'chain'
  const [modeOpen, setModeOpen]       = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768)

  useEffect(() => {
  const handler = () => setIsMobile(window.innerWidth <= 768)
  window.addEventListener('resize', handler)
  return () => window.removeEventListener('resize', handler)
}, [])

  const bottomRef      = useRef(null)
  const pendingQueryRef = useRef(null)   // L-1: queued message waiting for activeId

  const {
    sessions, activeId, activeMessages,
    createSession, selectSession, saveMessages, deleteSession,
    sessionVideoId, setSessionVideo,
  } = useChatHistory()

  // Save messages back to history whenever they change
  const handleMessagesChange = useCallback((msgs) => {
    saveMessages(msgs)
  }, [saveMessages])

  const {
    messages, isLoading, error, indexReady,
    sendMessage, clearMessages, onVideoIndexed,
  } = useChat({
    initialMessages: activeMessages,
    onMessagesChange: handleMessagesChange,
    sessionId: activeId,       // resets messages when session switches
    sessionVideoId,            // restricts chat to this tab's video
  })

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  // Auto-create a session whenever there is no active one
  useEffect(() => {
    if (!activeId) createSession()
  }, [activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // L-1: fire any queued message once activeId has been set by createSession()
  useEffect(() => {
    if (activeId && pendingQueryRef.current) {
      const { query: q, mode: m } = pendingQueryRef.current
      pendingQueryRef.current = null
      sendMessage(q, m)
    }
  }, [activeId, sendMessage])

  const handleNew = () => {
    clearMessages()
    createSession()
  }

  const handleSelect = (id) => {
    selectSession(id)   // useChat resets messages via sessionId watch
  }

  const handleSend = (query) => {
    if (!activeId) {
      // L-1: createSession() calls setActiveId async; queue the message and
      // send it from the useEffect above once the new id propagates.
      pendingQueryRef.current = { query, mode }
      createSession()
    } else {
      sendMessage(query, mode)
    }
  }

  // Header: active session title
  const activeSession  = sessions.find(s => s.id === activeId)
  const sessionTitle   = activeSession?.title || 'New chat'

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg-base)' }}>

      {/* Fix #15 — mobile backdrop: tap outside to close sidebar */}
      {sidebarOpen && isMobile && (
        <div
          className="sidebar-backdrop"
          style={{ display: 'block' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ───────────────────────────────────── */}
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onNew={handleNew}
        onSelect={handleSelect}
        onDelete={deleteSession}
        onVideoIndexed={onVideoIndexed}
        onVideoLinked={setSessionVideo}
        sessionVideoId={sessionVideoId}
        indexReady={indexReady}
        collapsed={!sidebarOpen}
        onToggle={() => setSidebarOpen(o => !o)}
      />

      {/* ── Main area ─────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

        {/* Header */}
        <header style={{
          height: 'var(--header-h)',
          display: 'flex', alignItems: 'center',
          padding: '0 16px', gap: 10, flexShrink: 0,
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-surface)',
        }}>
          {/* Fix #15 — toggle always visible on mobile; hidden when sidebar is open on desktop */}
          {(!sidebarOpen || isMobile) && (
            <button
              onClick={() => setSidebarOpen(o => !o)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', padding: 5, borderRadius: 7, display: 'flex',
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
            >
              <PanelLeftIcon size={17} />
            </button>
          )}

          {/* Title */}
          <div className="header-title" style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {sessionTitle}
            </p>
          </div>

          {/* Mode selector */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setModeOpen(o => !o)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)',
                borderRadius: 8, padding: '5px 10px', cursor: 'pointer',
                fontSize: 11, color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-strong)'}
            >
              <CircleDotIcon size={11} color={mode === 'agent' ? 'var(--accent)' : 'var(--warning)'} />
              {mode}
            </button>

            {modeOpen && (
              <div style={{
                position: 'absolute', right: 0, top: 34, zIndex: 50,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-strong)',
                borderRadius: 10, padding: 6, minWidth: 170,
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              }}>
                {[
                  { id: 'agent', label: 'Agent mode', sub: 'ReAct — multi-step (best)' },
                  { id: 'chain', label: 'Chain mode', sub: 'Single LCEL call — fast' },
                ].map(m => (
                  <button key={m.id}
                    onClick={() => { setMode(m.id); setModeOpen(false) }}
                    style={{
                      width: '100%', textAlign: 'left', padding: '8px 10px',
                      borderRadius: 7, border: 'none', cursor: 'pointer',
                      background: mode === m.id ? 'var(--accent-soft)' : 'none',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={e => { if (mode !== m.id) e.currentTarget.style.background = 'var(--bg-hover)' }}
                    onMouseLeave={e => { if (mode !== m.id) e.currentTarget.style.background = 'none' }}
                  >
                    <p style={{ fontSize: 12, fontWeight: 500, color: mode === m.id ? 'var(--accent)' : 'var(--text-primary)' }}>
                      {m.label}
                    </p>
                    <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{m.sub}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Clear */}
          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              title="Clear this chat"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', padding: 5, borderRadius: 7,
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: 11, transition: 'color 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
            >
              <Trash2Icon size={14} />
            </button>
          )}
        </header>

        {/* ── Messages area ────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
          {messages.length === 0 ? (
            <WelcomeScreen
              onSuggestion={handleSend}
              indexReady={indexReady}
              sessionVideoId={sessionVideoId}
            />
          ) : (
            <div style={{
              maxWidth: 800, margin: '0 auto',
              padding: '20px 20px 8px',
              display: 'flex', flexDirection: 'column', gap: 20,
            }}>
              {messages.map(msg => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              {isLoading && <TypingIndicator />}
              <div ref={bottomRef} style={{ height: 8 }} />
            </div>
          )}
        </div>

        {/* Error banner */}
        {error && (
          <div style={{
            margin: '0 16px 8px', maxWidth: 768,
            background: 'rgba(248,113,113,0.08)',
            border: '1px solid rgba(248,113,113,0.2)',
            borderRadius: 8, padding: '7px 12px',
            fontSize: 12, color: 'var(--danger)',
            display: 'flex', alignItems: 'center', gap: 7,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--danger)', flexShrink: 0 }} />
            {error}
          </div>
        )}

        {/* ── Input ────────────────────────────────────── */}
        <ChatInput
          onSend={handleSend}
          isLoading={isLoading}
          disabled={indexReady === null || !sessionVideoId}
        />
      </div>

      {/* Close mode dropdown on outside click */}
      {modeOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 40 }}
          onClick={() => setModeOpen(false)}
        />
      )}
    </div>
  )
}