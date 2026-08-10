import { useRef, useEffect, useState, useCallback } from 'react'
import {
  PanelLeftIcon, Trash2Icon, CircleDotIcon,
} from 'lucide-react'
import { Sidebar }        from '../components/Sidebar'
import { MessageBubble, TypingIndicator } from '../components/MessageBubble'
import { ChatInput }      from '../components/ChatInput'
import { WelcomeScreen }  from '../components/WelcomeScreen'
import { RAGPipeline3D }  from '../components/RAGPipeline3D'
import { useChat }        from '../hooks/useChat'
import { useChatHistory } from '../hooks/useChatHistory'
import { useAuth }        from '../context/AuthContext'

const INDEXING_PHASES = [
  { until: 5000, msg: 'Fetching transcript...' },
  { until: 15000, msg: 'Chunking transcript...' },
  { until: Infinity, msg: 'Generating embeddings...' },
]

export default function ChatPage() {
  const { user } = useAuth()

  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 768)
  const [mode, setMode]               = useState('agent')
  const [modeOpen, setModeOpen]       = useState(false)
  const [isMobile, setIsMobile]       = useState(() => window.innerWidth <= 768)
  const [indexingMsg, setIndexingMsg] = useState('Fetching transcript...')

  const indexingStartRef = useRef(null)
  const statusTimerRef   = useRef(null)

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  const bottomRef       = useRef(null)
  const pendingQueryRef = useRef(null)

  const {
    sessions, activeId, activeMessages,
    createSession, createSessionForVideo, selectSession, saveMessages, deleteSession,
    sessionVideoId, setSessionVideo,
  } = useChatHistory(user?.id)

  const handleMessagesChange = useCallback((msgs) => {
    saveMessages(msgs)
  }, [saveMessages])

  const {
    messages, isLoading, isThinking, error, indexReady,
    sendMessage, clearMessages, onVideoIndexed,
  } = useChat({
    initialMessages: activeMessages,
    onMessagesChange: handleMessagesChange,
    sessionId: activeId,
    sessionVideoId,
  })

  // Track indexing phases for 3D animation on Main Screen
  useEffect(() => {
    if (indexReady === null && sessionVideoId) {
      indexingStartRef.current = Date.now()
      setIndexingMsg('Fetching transcript...')
      statusTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - indexingStartRef.current
        const phase = INDEXING_PHASES.find(p => elapsed < p.until) ?? INDEXING_PHASES[INDEXING_PHASES.length - 1]
        setIndexingMsg(phase.msg)
      }, 1000)
    } else {
      if (statusTimerRef.current) {
        clearInterval(statusTimerRef.current)
        statusTimerRef.current = null
      }
    }
    return () => {
      if (statusTimerRef.current) {
        clearInterval(statusTimerRef.current)
        statusTimerRef.current = null
      }
    }
  }, [indexReady, sessionVideoId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  useEffect(() => {
    if (!activeId) createSession()
  }, [activeId])

  useEffect(() => {
    if (activeId && pendingQueryRef.current) {
      const { query: q, mode: m } = pendingQueryRef.current
      pendingQueryRef.current = null
      sendMessage(q, m)
    }
  }, [activeId, sendMessage])

  const handleVideoAdded = (videoId, title) => {
    createSessionForVideo(videoId, title)
  }

  const handleSelect = (id) => {
    selectSession(id)
  }

  const handleSend = (query) => {
    if (!activeId) {
      pendingQueryRef.current = { query, mode }
      createSession()
    } else {
      sendMessage(query, mode)
    }
  }

  const activeSession  = sessions.find(s => s.id === activeId)
  const sessionTitle   = activeSession?.title || 'New chat'

  const currentStage = 
    indexingMsg.includes('Fetching') ? 1 :
    indexingMsg.includes('Chunking') ? 2 :
    indexingMsg.includes('embeddings') ? 3 : 4

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg-base)' }}>

      {sidebarOpen && isMobile && (
        <div
          className="sidebar-backdrop"
          style={{ display: 'block' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar (Old Clean Style) */}
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={handleSelect}
        onDelete={deleteSession}
        onVideoIndexed={onVideoIndexed}
        onVideoAdded={handleVideoAdded}
        sessionVideoId={sessionVideoId}
        indexReady={indexReady}
        collapsed={!sidebarOpen}
        onToggle={() => setSidebarOpen(o => !o)}
      />

      {/* Main Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

        {/* Header */}
        <header style={{
          height: 'var(--header-h)',
          display: 'flex', alignItems: 'center',
          padding: '0 16px', gap: 10, flexShrink: 0,
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-surface)',
        }}>
          {(!sidebarOpen || isMobile) && (
            <button
              onClick={() => setSidebarOpen(o => !o)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', padding: 5, borderRadius: 7, display: 'flex',
                alignItems: 'center', transition: 'color 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
            >
              {isMobile
                ? <span style={{ fontSize: 18, lineHeight: 1, fontFamily: 'sans-serif' }}>☰</span>
                : <PanelLeftIcon size={17} />
              }
            </button>
          )}

          <div className="header-title" style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {sessionTitle}
            </p>
          </div>

          {/* Mode Selector */}
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
                    <p style={{ fontSize: 12, fontWeight: 600, color: mode === m.id ? 'var(--accent)' : 'var(--text-primary)' }}>
                      {m.label}
                    </p>
                    <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{m.sub}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Clear Chat */}
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

        {/* Main Content Area */}
        <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
          {/* 1. Show 3D RAG Pipeline Animation on Main Screen while Indexing */}
          {sessionVideoId && indexReady === null ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justify: 'center', height: '100%', padding: '32px 20px', maxWidth: 640, margin: '0 auto'
            }}>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6, fontFamily: 'var(--font-display)', textAlign: 'center' }}>
                Preparing Video Context
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, textAlign: 'center', lineHeight: 1.6 }}>
                Processing transcript, generating 3D vector embeddings, and indexing into Pinecone DB.
              </p>

              {/* 3D Visualizer Card */}
              <RAGPipeline3D stage={currentStage} indexingMsg={indexingMsg} />
            </div>
          ) : messages.length === 0 ? (
            /* 2. Show Welcome Screen after Indexing completes */
            <WelcomeScreen
              onSuggestion={handleSend}
              indexReady={indexReady}
              sessionVideoId={sessionVideoId}
            />
          ) : (
            /* 3. Show Chat Messages */
            <div className="messages-container" style={{
              maxWidth: 800, margin: '0 auto',
              padding: '20px 20px 8px',
              display: 'flex', flexDirection: 'column', gap: 20,
            }}>
              {messages.map(msg => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              {isThinking && <TypingIndicator />}
              <div ref={bottomRef} style={{ height: 8 }} />
            </div>
          )}
        </div>

        {/* Error Banner */}
        {error && (
          <div style={{
            margin: '0 16px 8px', maxWidth: 768,
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: 8, padding: '7px 12px',
            fontSize: 12, color: 'var(--danger)',
            display: 'flex', alignItems: 'center', gap: 7,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--danger)', flexShrink: 0 }} />
            {error}
          </div>
        )}

        {/* Chat Input */}
        <ChatInput
          onSend={handleSend}
          isLoading={isLoading}
          disabled={indexReady !== true}
          statusMsg={
            !sessionVideoId     ? 'Please add a YouTube video URL above to start chatting.'
            : indexReady === null  ? 'Video is being indexed... Please wait.'
            : indexReady === false ? 'Video indexing failed. Please try a different video.'
            : null
          }
        />
      </div>

      {modeOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 40 }}
          onClick={() => setModeOpen(false)}
        />
      )}
    </div>
  )
}