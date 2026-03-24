import { useState } from 'react'
import { TrashIcon, AlertCircleIcon, Loader2Icon } from 'lucide-react'

function StatusDot({ status }) {
  const bg = status === 'ready'      ? 'var(--success)'
           : status === 'processing' ? 'var(--warning)'
           : status === 'failed'     ? 'var(--danger)'
           : 'var(--text-muted)'
  return (
    <span style={{
      width: 6, height: 6, borderRadius: '50%',
      background: bg, flexShrink: 0, display: 'inline-block',
    }} />
  )
}

function VideoCard({ video, onDelete }) {
  const [confirm, setConfirm]   = useState(false)
  const [deleting, setDeleting] = useState(false)

  const ytUrl = `https://www.youtube.com/watch?v=${video.video_id}`

  const handleDelete = async (e) => {
    e.stopPropagation()
    if (!confirm) { setConfirm(true); return }
    setDeleting(true)
    try {
      await onDelete(video.video_id)
    } finally {
      setDeleting(false)
      setConfirm(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex', gap: 8, padding: '7px 6px',
        borderRadius: 8, border: '1px solid var(--border)',
        background: 'var(--bg-base)', alignItems: 'flex-start',
        marginBottom: 5,
      }}
      onMouseLeave={() => setConfirm(false)}
    >
      {/* Thumbnail */}
      <a href={ytUrl} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }}>
        <img
          src={video.thumbnail ?? `https://img.youtube.com/vi/${video.video_id}/mqdefault.jpg`}
          alt={video.title}
          style={{ width: 54, height: 38, borderRadius: 4, objectFit: 'cover', display: 'block' }}
          onError={e => { e.target.style.display = 'none' }}
        />
      </a>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: 11, fontWeight: 500, color: 'var(--text-primary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          lineHeight: 1.3,
        }}>
          {video.title}
        </p>
        <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
          {video.channel}
        </p>

        {video.status === 'processing' && (
          <p style={{
            fontSize: 10, color: 'var(--warning)', marginTop: 3,
            display: 'flex', alignItems: 'center', gap: 3,
          }}>
            <Loader2Icon size={9} style={{ animation: 'spin 0.8s linear infinite' }} />
            Indexing…
          </p>
        )}
        {video.status === 'failed' && (
          <p
            style={{ fontSize: 10, color: 'var(--danger)', marginTop: 3 }}
            title={video.error_msg}
          >
            <AlertCircleIcon
              size={9}
              style={{ display: 'inline', verticalAlign: 'middle', marginRight: 3 }}
            />
            {(video.error_msg ?? 'Failed').slice(0, 45)}
          </p>
        )}
        {video.status === 'ready' && (
          <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
            {video.chunk_count} segments
          </p>
        )}
      </div>

      {/* Status dot + delete */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 5, flexShrink: 0, paddingTop: 2,
      }}>
        <StatusDot status={video.status} />
        {confirm ? (
          <button
            onClick={handleDelete}
            disabled={deleting}
            style={{
              fontSize: 9, padding: '2px 5px', borderRadius: 4,
              background: 'var(--danger)', color: '#fff',
              border: 'none', cursor: 'pointer', fontWeight: 600,
            }}
          >
            {deleting ? '…' : 'Yes'}
          </button>
        ) : (
          <button
            onClick={handleDelete}
            title="Remove video"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', padding: 2, borderRadius: 4,
              display: 'flex', alignItems: 'center',
              transition: 'color 0.15s, opacity 0.15s', opacity: 0.5,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.opacity = '1'
              e.currentTarget.style.color = 'var(--danger)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.opacity = '0.5'
              e.currentTarget.style.color = 'var(--text-muted)'
            }}
          >
            <TrashIcon size={11} />
          </button>
        )}
      </div>
    </div>
  )
}

export function VideoList({ videos, onDelete, loading }) {
  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '8px 2px', fontSize: 11, color: 'var(--text-muted)',
      }}>
        <Loader2Icon size={11} style={{ animation: 'spin 0.8s linear infinite' }} />
        Loading videos…
      </div>
    )
  }
  if (videos.length === 0) {
    return (
      <p style={{
        fontSize: 11, color: 'var(--text-muted)',
        textAlign: 'center', padding: '6px 0',
      }}>
        No videos indexed yet
      </p>
    )
  }
  return (
    <div>
      {videos.map(v => (
        <VideoCard key={v.video_id} video={v} onDelete={onDelete} />
      ))}
    </div>
  )
}
