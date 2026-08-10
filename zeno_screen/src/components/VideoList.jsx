import { useState } from 'react'
import { TrashIcon, AlertCircleIcon, Loader2Icon, CheckCircle2Icon } from 'lucide-react'

function StatusBadge({ status }) {
  if (status === 'ready') {
    return (
      <span style={{ fontSize: 10, color: 'var(--success)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <CheckCircle2Icon size={10} /> Ready
      </span>
    )
  }
  if (status === 'processing') {
    return (
      <span style={{ fontSize: 10, color: 'var(--warning)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        <Loader2Icon size={10} style={{ animation: 'spin 0.8s linear infinite' }} /> Indexing
      </span>
    )
  }
  return (
    <span style={{ fontSize: 10, color: 'var(--danger)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <AlertCircleIcon size={10} /> Failed
    </span>
  )
}

function VideoCard({ video, onDelete }) {
  const [confirm, setConfirm] = useState(false)
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
        display: 'flex', gap: 8, padding: '8px',
        borderRadius: 8, border: '1px solid var(--border)',
        background: 'var(--bg-base)', alignItems: 'center',
        marginBottom: 6, transition: 'border-color 0.15s',
      }}
      onMouseLeave={() => setConfirm(false)}
    >
      <a href={ytUrl} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }}>
        <img
          src={video.thumbnail ?? `https://img.youtube.com/vi/${video.video_id}/mqdefault.jpg`}
          alt={video.title}
          style={{ width: 50, height: 36, borderRadius: 5, objectFit: 'cover', display: 'block' }}
          onError={e => { e.target.style.display = 'none' }}
        />
      </a>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: 11, fontWeight: 600, color: 'var(--text-primary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          lineHeight: 1.3,
        }}>
          {video.title}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <StatusBadge status={video.status} />
          {video.status === 'ready' && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              · {video.chunk_count} chunks
            </span>
          )}
        </div>
      </div>

      <div style={{ flexShrink: 0 }}>
        {confirm ? (
          <button
            onClick={handleDelete}
            disabled={deleting}
            style={{
              fontSize: 10, padding: '3px 7px', borderRadius: 5,
              background: 'var(--danger)', color: '#fff',
              border: 'none', cursor: 'pointer', fontWeight: 700,
            }}
          >
            {deleting ? '...' : 'Yes'}
          </button>
        ) : (
          <button
            onClick={handleDelete}
            title="Remove video from DB"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', padding: 4, borderRadius: 5,
              display: 'flex', alignItems: 'center', transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = 'var(--danger)'
              e.currentTarget.style.background = 'rgba(220,38,38,0.1)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--text-muted)'
              e.currentTarget.style.background = 'none'
            }}
          >
            <TrashIcon size={12} />
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
        padding: '8px 4px', fontSize: 11, color: 'var(--text-muted)',
      }}>
        <Loader2Icon size={12} style={{ animation: 'spin 0.8s linear infinite' }} />
        Loading indexed videos...
      </div>
    )
  }
  if (videos.length === 0) {
    return (
      <p style={{
        fontSize: 11, color: 'var(--text-muted)',
        textAlign: 'center', padding: '8px 0',
      }}>
        No videos indexed yet.
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