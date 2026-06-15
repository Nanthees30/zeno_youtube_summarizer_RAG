import { useState } from 'react'
import { PlayCircleIcon, Loader2Icon } from 'lucide-react'
import { api } from '../service/api'

export function YoutubeInput({ onSuccess }) {
  const [url, setUrl]           = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [lastAdded, setLastAdded] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!url.trim() || loading) return
    setLoading(true)
    setError(null)
    setLastAdded(null)
    try {
      const data = await api.indexVideo(url.trim())
      setLastAdded({
        title:   data.title ?? 'Video',
        already: data.already_indexed ?? false,
      })
      setUrl('')
      onSuccess?.(data.video_id)
    } catch (err) {
      setError(err?.response?.data?.detail ?? 'Could not add video — check the URL.')
    } finally {
      setLoading(false)
    }
  }

  const disabled = loading || !url.trim()

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>

      <div style={{ display: 'flex', gap: 5 }}>
        <input
          type="text"
          value={url}
          onChange={e => { setUrl(e.target.value); setError(null); setLastAdded(null) }}
          placeholder="Paste YouTube URL…"
          disabled={loading}
          style={{
            flex: 1, padding: '7px 9px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)',
            background: 'var(--bg-base)',
            color: 'var(--text-primary)', fontSize: 12,
            outline: 'none', transition: 'border-color 0.15s',
          }}
          onFocus={e  => e.target.style.borderColor = 'var(--accent)'}
          onBlur={e   => e.target.style.borderColor = 'var(--border)'}
        />

        <button
          type="submit"
          disabled={disabled}
          style={{
            padding: '7px 11px', borderRadius: 'var(--radius-sm)',
            background: disabled ? 'var(--bg-elevated)' : 'var(--accent)',
            color: disabled ? 'var(--text-muted)' : '#fff',
            border: 'none', cursor: disabled ? 'default' : 'pointer',
            fontSize: 12, fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 4,
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'var(--accent-hover)' }}
          onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = 'var(--accent)' }}
        >
          {loading
            ? <Loader2Icon size={12} style={{ animation: 'spin 0.8s linear infinite' }} />
            : <PlayCircleIcon size={12} />
          }
          {loading ? 'Adding…' : 'Add'}
        </button>
      </div>

      {error && (
        <p style={{ fontSize: 11, color: 'var(--danger)', padding: '0 2px' }}>{error}</p>
      )}
      {lastAdded && (
        <p style={{ fontSize: 11, color: 'var(--success)', padding: '0 2px' }}>
          {lastAdded.already ? 'Already indexed: ' : 'Indexing: '}
          <span style={{ fontWeight: 500 }}>{lastAdded.title}</span>
        </p>
      )}
    </form>
  )
}
