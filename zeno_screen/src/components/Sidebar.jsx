import { useState, useEffect, useCallback, useRef } from 'react'
import {
  PlusIcon, TrashIcon, MessageSquareIcon,
  VideoIcon, ChevronDownIcon, XIcon, LogOutIcon, Loader2Icon,
} from 'lucide-react'

const INDEXING_PHASES = [
  { until: 5000,    msg: 'Fetching transcript...' },
  { until: 15000,   msg: 'Chunking transcript...' },
  { until: Infinity, msg: 'Generating embeddings...' },
]
import { YoutubeInput } from './YoutubeInput'
import { VideoList }    from './VideoList'
import { useAuth }      from '../context/AuthContext'
import { api }          from '../service/api'

function timeLabel(iso) {
  const d    = new Date(iso)
  const now  = new Date()
  const diff = (now - d) / 1000

  if (diff < 60)           return 'Just now'
  if (diff < 3600)         return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400)        return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7)    return `${Math.floor(diff / 86400)}d ago`
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function groupSessions(sessions) {
  const today = [], week = [], older = []
  const now   = Date.now()

  for (const s of sessions) {
    const age = (now - new Date(s.updatedAt)) / 1000
    if (age < 86400)       today.push(s)
    else if (age < 604800) week.push(s)
    else                   older.push(s)
  }
  return [
    { label: 'Today',     items: today },
    { label: 'This week', items: week  },
    { label: 'Older',     items: older },
  ].filter(g => g.items.length > 0)
}

export function Sidebar({
  sessions, activeId,
  onNew, onSelect, onDelete,
  onVideoIndexed,
  onVideoLinked,
  sessionVideoId,
  indexReady,
  collapsed, onToggle,
}) {
  const { user, logout }                  = useAuth()
  const [videoOpen,     setVideoOpen]     = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [videos,        setVideos]        = useState([])
  const [loadingVideos, setLoadingVideos] = useState(true)
  const [deleteError,   setDeleteError]   = useState(null)  // H-1
  const [indexingMsg,   setIndexingMsg]   = useState('Fetching transcript...')
  const indexingStartRef = useRef(null)
  const statusTimerRef   = useRef(null)

  const groups = groupSessions(sessions)

  // ── Fetch video list ────────────────────────────────────────────────────────
  const pollTimerRef = useRef(null)

  const fetchVideos = useCallback(async () => {
    try {
      const data = await api.listVideos()
      setVideos(data)
      // If nothing is still processing, stop the polling interval
      const stillProcessing = data.some(v => v.status === 'processing')
      if (!stillProcessing && pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    } catch {
      // ignore — auth may not be ready yet
    } finally {
      setLoadingVideos(false)
    }
  }, [])

  // Run once on mount — never re-runs, so no cascade
  useEffect(() => { fetchVideos() }, [fetchVideos])

  // Cycle through indexing status messages while indexReady === null
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

  // Start a stable polling interval only while a video is processing.
  // Depends on fetchVideos (stable ref) not on `videos`, so it never
  // restarts mid-interval and never creates the cascade loop.
  useEffect(() => {
    const hasProcessing = videos.some(v => v.status === 'processing')
    if (hasProcessing && !pollTimerRef.current) {
      pollTimerRef.current = setInterval(fetchVideos, 8000)
    }
    return () => {
      if (!videos.some(v => v.status === 'processing') && pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [videos.some(v => v.status === 'processing'), fetchVideos]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup poll on unmount
  useEffect(() => () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current) }, [])

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleVideoSuccess = (video_id) => {
    if (video_id) onVideoLinked?.(video_id)
    onVideoIndexed?.(video_id)   // C-3: pass id directly — avoids stale closure in useChat
    fetchVideos()
  }

  const handleDeleteVideo = async (videoId) => {
    try {
      await api.deleteVideo(videoId)
      fetchVideos()
      onVideoIndexed?.()
    } catch (err) {
      // H-1: was an unhandled rejection — now surfaces a timed error message
      const msg = err?.response?.data?.detail ?? 'Failed to remove video'
      setDeleteError(msg)
      setTimeout(() => setDeleteError(null), 4000)
    }
  }

  const handleDelete = (e, id) => {
    e.stopPropagation()
    setConfirmDelete(id)
  }

  const confirmDel = (e) => {
    e.stopPropagation()
    onDelete(confirmDelete)
    setConfirmDelete(null)
  }

  const readyCount = videos.filter(v => v.status === 'ready').length

  return (
    <>
      {/* Mobile overlay */}
      {!collapsed && (
        <div
          className="fixed inset-0 bg-black/40 z-20 lg:hidden"
          onClick={onToggle}
        />
      )}

      {/* Fix #15 — sidebar-panel class used by CSS media query for mobile overlay */}
      <aside
        className="sidebar-panel"
        style={{
          width:      collapsed ? '0' : 'var(--sidebar-w)',
          minWidth:   collapsed ? '0' : 'var(--sidebar-w)',
          overflow:   'hidden',
          transition: 'width 0.22s cubic-bezier(0.4,0,0.2,1), min-width 0.22s cubic-bezier(0.4,0,0.2,1)',
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)',
          display:    'flex',
          flexDirection: 'column',
          height:     '100%',
          zIndex:     30,
          position:   'relative',
        }}
      >
        <div style={{ width: 'var(--sidebar-w)', display: 'flex', flexDirection: 'column', height: '100%' }}>

          {/* ── Logo + close ─────────────────────────────── */}
          <div style={{
            padding: '16px 14px 12px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid var(--border)', flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 8,
                background: 'var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700, color: '#fff',
                fontFamily: 'var(--font-mono)',
              }}>Z</div>
              <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>Zeno</span>
            </div>
            <button
              onClick={onToggle}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', padding: 4, borderRadius: 6,
                display: 'flex', alignItems: 'center', transition: 'color 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
            >
              <XIcon size={15} />
            </button>
          </div>

          {/* ── New Chat ─────────────────────────────────── */}
          <div style={{ padding: '10px 10px 6px', flexShrink: 0 }}>
            <button
              onClick={onNew}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '9px 12px', borderRadius: 'var(--radius-md)',
                background: 'var(--accent)', color: '#fff',
                border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
                transition: 'background 0.15s, transform 0.1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--accent)'}
              onMouseDown={e => e.currentTarget.style.transform = 'scale(0.98)'}
              onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
            >
              <PlusIcon size={15} />
              New chat
            </button>
          </div>

          {/* ── Chat history ─────────────────────────────── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
            {sessions.length === 0 ? (
              <div style={{
                padding: '24px 12px', textAlign: 'center',
                color: 'var(--text-muted)', fontSize: 12,
              }}>
                <MessageSquareIcon size={24} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                <p>No chats yet</p>
                <p style={{ marginTop: 4 }}>Click "New chat" to start</p>
              </div>
            ) : (
              groups.map(group => (
                <div key={group.label} style={{ marginBottom: 8 }}>
                  <p style={{
                    fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
                    color: 'var(--text-muted)', padding: '6px 8px 4px',
                    textTransform: 'uppercase',
                  }}>
                    {group.label}
                  </p>
                  {group.items.map(s => (
                    <div
                      key={s.id}
                      className={`history-item${s.id === activeId ? ' active' : ''}`}
                      onClick={() => onSelect(s.id)}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <MessageSquareIcon
                          size={13}
                          style={{
                            color: s.id === activeId ? 'var(--accent)' : 'var(--text-muted)',
                            flexShrink: 0, marginTop: 2,
                          }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{
                            fontSize: 13, color: 'var(--text-primary)',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            fontWeight: s.id === activeId ? 500 : 400,
                          }}>
                            {s.title}
                          </p>
                          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                            {timeLabel(s.updatedAt)}
                            {s.messages.length > 0 && ` · ${Math.ceil(s.messages.length / 2)} msg`}
                          </p>
                        </div>

                        {confirmDelete === s.id ? (
                          <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                            <button
                              onClick={confirmDel}
                              style={{
                                fontSize: 10, padding: '2px 7px', borderRadius: 5,
                                background: 'var(--danger)', color: '#fff',
                                border: 'none', cursor: 'pointer', fontWeight: 600,
                              }}
                            >Yes</button>
                            <button
                              onClick={e => { e.stopPropagation(); setConfirmDelete(null) }}
                              style={{
                                fontSize: 10, padding: '2px 7px', borderRadius: 5,
                                background: 'var(--bg-active)', color: 'var(--text-secondary)',
                                border: 'none', cursor: 'pointer',
                              }}
                            >No</button>
                          </div>
                        ) : (
                          <button
                            onClick={e => handleDelete(e, s.id)}
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              color: 'var(--text-muted)', padding: 3, borderRadius: 5,
                              opacity: 0, transition: 'opacity 0.15s, color 0.15s',
                              display: 'flex', alignItems: 'center', flexShrink: 0,
                            }}
                            className="delete-btn"
                            onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
                            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                          >
                            <TrashIcon size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>

          {/* ── YouTube videos ───────────────────────────── */}
          <div style={{
            borderTop: '1px solid var(--border)',
            padding: '10px 10px', flexShrink: 0,
          }}>
            <button
              onClick={() => setVideoOpen(o => !o)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12,
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <VideoIcon
                  size={13}
                  style={{ color: readyCount > 0 ? 'var(--success)' : 'var(--text-muted)' }}
                />
                {readyCount > 0
                  ? `${readyCount} video${readyCount !== 1 ? 's' : ''} indexed`
                  : 'Add YouTube video'
                }
              </span>
              <ChevronDownIcon
                size={13}
                style={{
                  transition: 'transform 0.2s',
                  transform: videoOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                }}
              />
            </button>

            {videoOpen && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <YoutubeInput onSuccess={handleVideoSuccess} />
                {deleteError && (
                  <p style={{
                    fontSize: 11, color: 'var(--danger)',
                    background: 'rgba(248,113,113,0.08)',
                    border: '1px solid rgba(248,113,113,0.2)',
                    borderRadius: 6, padding: '5px 8px', margin: 0,
                  }}>
                    {deleteError}
                  </p>
                )}
                <VideoList
                  videos={videos}
                  onDelete={handleDeleteVideo}
                  loading={loadingVideos}
                />
              </div>
            )}

            {/* Index status — animated when indexing, dot otherwise */}
            <div style={{ padding: '6px 4px 0' }}>
              {sessionVideoId && indexReady === null ? (
                <div>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    fontSize: 11, color: 'var(--accent)', marginBottom: 5,
                  }}>
                    <Loader2Icon size={11} style={{ animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                    {indexingMsg}
                  </div>
                  <div className="indexing-bar-track">
                    <div className="indexing-bar" />
                  </div>
                </div>
              ) : (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 11, color: 'var(--text-muted)',
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                    background: indexReady === true  ? 'var(--success)'
                              : indexReady === false ? 'var(--danger)'
                              : 'var(--text-muted)',
                  }} />
                  {sessionVideoId
                    ? (indexReady === true  ? 'Ready to chat!'
                     : 'Indexing failed — see video list')
                    : 'No video in this tab'}
                </div>
              )}
            </div>
          </div>

          {/* ── User info + logout ───────────────────────── */}
          {user && (
            <div style={{
              borderTop: '1px solid var(--border)',
              padding: '10px 10px', flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-strong)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 600, color: 'var(--accent)',
              }}>
                {user.name?.[0]?.toUpperCase() ?? '?'}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  fontSize: 12, fontWeight: 500, color: 'var(--text-primary)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {user.name}
                </p>
                <p style={{
                  fontSize: 10, color: 'var(--text-muted)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {user.email}
                </p>
              </div>

              <button
                onClick={logout}
                title="Sign out"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', padding: 4, borderRadius: 6,
                  display: 'flex', alignItems: 'center', flexShrink: 0,
                  transition: 'color 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
              >
                <LogOutIcon size={14} />
              </button>
            </div>
          )}

        </div>
      </aside>
    </>
  )
}
