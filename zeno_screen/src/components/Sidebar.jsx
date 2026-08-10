import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TrashIcon, MessageSquareIcon,
  VideoIcon, XIcon, LogOutIcon, Loader2Icon,
  LayoutDashboardIcon,
} from 'lucide-react'
import { YoutubeInput } from './YoutubeInput'
import { VideoList } from './VideoList'
import { useAuth } from '../context/AuthContext'
import { api } from '../service/api'

const INDEXING_PHASES = [
  { until: 5000, msg: 'Fetching transcript...' },
  { until: 15000, msg: 'Chunking transcript...' },
  { until: Infinity, msg: 'Generating embeddings...' },
]

function timeLabel(iso) {
  const d = new Date(iso)
  const now = new Date()
  const diff = (now - d) / 1000

  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function groupSessions(sessions) {
  const today = [], week = [], older = []
  const now = Date.now()

  for (const s of sessions) {
    const age = (now - new Date(s.updatedAt)) / 1000
    if (age < 86400) today.push(s)
    else if (age < 604800) week.push(s)
    else older.push(s)
  }
  return [
    { label: 'Today', items: today },
    { label: 'This week', items: week },
    { label: 'Older', items: older },
  ].filter(g => g.items.length > 0)
}

export function Sidebar({
  sessions, activeId,
  onSelect, onDelete,
  onVideoIndexed,
  onVideoAdded,
  sessionVideoId,
  indexReady,
  collapsed, onToggle,
}) {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [videos, setVideos] = useState([])
  const [loadingVideos, setLoadingVideos] = useState(true)
  const [deleteError, setDeleteError] = useState(null)
  const [indexingMsg, setIndexingMsg] = useState('Fetching transcript...')
  const indexingStartRef = useRef(null)
  const statusTimerRef = useRef(null)

  const groups = groupSessions(sessions)
  const pollTimerRef = useRef(null)

  const fetchVideos = useCallback(async () => {
    try {
      const data = await api.listVideos()
      setVideos(data)
      const stillProcessing = data.some(v => v.status === 'processing')
      if (!stillProcessing && pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    } catch {
      // ignore
    } finally {
      setLoadingVideos(false)
    }
  }, [])

  useEffect(() => { fetchVideos() }, [fetchVideos])

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
  }, [videos.some(v => v.status === 'processing'), fetchVideos])

  useEffect(() => () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current) }, [])

  const handleVideoSuccess = (video_id, title) => {
    onVideoAdded?.(video_id, title)
    onVideoIndexed?.(video_id)
    fetchVideos()
  }

  const handleDeleteVideo = async (videoId) => {
    try {
      await api.deleteVideo(videoId)
      fetchVideos()
      onVideoIndexed?.()
    } catch (err) {
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

  const activeVideo = videos.find(v => v.video_id === sessionVideoId)

  return (
    <>
      {!collapsed && (
        <div
          className="sidebar-backdrop"
          onClick={onToggle}
        />
      )}

      <aside
        className="sidebar-panel"
        style={{
          width: collapsed ? '0' : 'var(--sidebar-w)',
          minWidth: collapsed ? '0' : 'var(--sidebar-w)',
          overflow: 'hidden',
          transition: 'width 0.22s cubic-bezier(0.4,0,0.2,1), min-width 0.22s cubic-bezier(0.4,0,0.2,1)',
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          zIndex: 30,
          position: 'relative',
        }}
      >
        <div style={{ width: 'var(--sidebar-w)', display: 'flex', flexDirection: 'column', height: '100%' }}>

          {/* Logo Header (Clean Logo Only) */}
          <div style={{
            padding: '14px 14px 12px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid var(--border)', flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <img
                src="/zeno_logo.png"
                alt="Zeno Logo"
                style={{
                  height: 36,
                  width: 'auto',
                  maxHeight: 40,
                  objectFit: 'contain',
                  filter: 'drop-shadow(0 2px 8px var(--accent-glow))',
                }}
                onError={e => { e.target.src = '/logo.png' }}
              />
            </div>
            <button
              onClick={onToggle}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', padding: 6, borderRadius: 8,
                display: 'flex', alignItems: 'center', transition: 'all 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
            >
              <XIcon size={16} />
            </button>
          </div>

          {/* Video Context Input Card */}
          <div style={{
            padding: '12px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-elevated)',
            margin: '12px 10px 8px',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-strong)',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <VideoIcon size={13} color="var(--accent)" />
                Add Video Context
              </span>
              {sessionVideoId && (
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  padding: '2px 7px', borderRadius: 12,
                  background: indexReady === true ? 'rgba(16,185,129,0.15)' : indexReady === false ? 'rgba(239,68,68,0.15)' : 'rgba(236,216,3,0.15)',
                  color: indexReady === true ? 'var(--success)' : indexReady === false ? 'var(--danger)' : 'var(--accent)',
                  border: `1px solid ${indexReady === true ? 'rgba(16,185,129,0.30)' : indexReady === false ? 'rgba(239,68,68,0.30)' : 'rgba(236,216,3,0.30)'}`,
                }}>
                  {indexReady === true ? 'Ready' : indexReady === false ? 'Failed' : 'Indexing'}
                </span>
              )}
            </div>

            <YoutubeInput onSuccess={handleVideoSuccess} />

            {deleteError && (
              <p style={{
                fontSize: 11, color: 'var(--danger)',
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: 6, padding: '5px 8px', marginTop: 8,
              }}>
                {deleteError}
              </p>
            )}

            {sessionVideoId && indexReady === null && (
              <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--accent)', fontWeight: 600, marginBottom: 6 }}>
                  <Loader2Icon size={12} style={{ animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                  {indexingMsg}
                </div>
                <div className="indexing-bar-track">
                  <div className="indexing-bar" />
                </div>
              </div>
            )}

            {activeVideo && (
              <div style={{
                marginTop: 10, padding: '8px 10px',
                background: 'var(--bg-surface)', borderRadius: 8,
                border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <img
                  src={activeVideo.thumbnail ?? `https://img.youtube.com/vi/${activeVideo.video_id}/mqdefault.jpg`}
                  alt={activeVideo.title}
                  style={{ width: 44, height: 32, borderRadius: 4, objectFit: 'cover' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {activeVideo.title}
                  </p>
                  <p style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {activeVideo.channel || 'Linked Video'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Scrollable Chat History */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
            {sessions.length === 0 ? (
              <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                <MessageSquareIcon size={22} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                <p>No video chats yet</p>
                <p style={{ fontSize: 11, marginTop: 4 }}>Add a YouTube URL above to start</p>
              </div>
            ) : (
              groups.map(group => (
                <div key={group.label} style={{ marginBottom: 10 }}>
                  <p style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
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
                      style={{
                        padding: '8px 10px',
                        borderRadius: 8,
                        marginBottom: 3,
                        display: 'flex',
                        alignItems: 'center',
                        justify: 'space-between',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0, flex: 1 }}>
                        <MessageSquareIcon
                          size={14}
                          style={{
                            color: s.id === activeId ? 'var(--accent)' : 'var(--text-muted)',
                            flexShrink: 0,
                          }}
                        />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <p style={{
                            fontSize: 12, color: 'var(--text-primary)',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            fontWeight: s.id === activeId ? 600 : 400,
                          }}>
                            {s.title}
                          </p>
                          <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                            {timeLabel(s.updatedAt)}
                          </p>
                        </div>
                      </div>

                      {confirmDelete === s.id ? (
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                          <button
                            onClick={confirmDel}
                            style={{
                              fontSize: 10, padding: '3px 8px', borderRadius: 5,
                              background: 'var(--danger)', color: '#fff',
                              border: 'none', cursor: 'pointer', fontWeight: 700,
                            }}
                          >
                            Delete
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); setConfirmDelete(null) }}
                            style={{
                              fontSize: 10, padding: '3px 8px', borderRadius: 5,
                              background: 'var(--bg-active)', color: 'var(--text-secondary)',
                              border: 'none', cursor: 'pointer',
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={e => handleDelete(e, s.id)}
                          title="Delete session & video"
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--text-muted)', padding: 4, borderRadius: 5,
                            display: 'flex', alignItems: 'center', flexShrink: 0,
                            transition: 'color 0.15s, background 0.15s',
                          }}
                          className="delete-btn"
                          onMouseEnter={e => {
                            e.currentTarget.style.color = 'var(--danger)'
                            e.currentTarget.style.background = 'rgba(239,68,68,0.1)'
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.color = 'var(--text-muted)'
                            e.currentTarget.style.background = 'none'
                          }}
                        >
                          <TrashIcon size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))
            )}

            <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', padding: '0 8px 6px', textTransform: 'uppercase' }}>
                All Indexed Videos ({videos.length})
              </p>
              <VideoList
                videos={videos}
                onDelete={handleDeleteVideo}
                loading={loadingVideos}
              />
            </div>
          </div>

          {/* User Profile Footer */}
          {user && (
            <div style={{
              borderTop: '1px solid var(--border)',
              padding: '12px 14px', flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 10,
              background: 'var(--bg-surface)',
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: 'var(--accent-soft)',
                border: '1px solid var(--border-strong)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 800, color: 'var(--accent)',
              }}>
                {user.name?.[0]?.toUpperCase() ?? '?'}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user.name}
                </p>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user.email}
                </p>
              </div>

              <button
                onClick={() => navigate('/dashboard')}
                title="Vector DB Dashboard"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', padding: 6, borderRadius: 6,
                  display: 'flex', alignItems: 'center', flexShrink: 0, transition: 'color 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--accent)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
              >
                <LayoutDashboardIcon size={15} />
              </button>

              <button
                onClick={logout}
                title="Sign out"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', padding: 6, borderRadius: 6,
                  display: 'flex', alignItems: 'center', flexShrink: 0, transition: 'color 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
              >
                <LogOutIcon size={15} />
              </button>
            </div>
          )}

        </div>
      </aside>
    </>
  )
}