import { useState } from 'react'
import { PlusIcon, Loader2Icon, AlertCircleIcon, CheckCircle2Icon } from 'lucide-react'
import { api } from '../service/api'

export function YoutubeInput({ onSuccess }) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [lastAdded, setLastAdded] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!url.trim() || loading) return
    setLoading(true)
    setError(null)
    setLastAdded(null)
    try {
      const data = await api.indexVideo(url.trim())
      const title = data.title ?? 'Video Chat'
      setLastAdded({
        title,
        already: data.already_indexed ?? false,
      })
      setUrl('')
      // Pass video_id and title so a new chat session is created
      onSuccess?.(data.video_id, title)
    } catch (err) {
      setError(err?.response?.data?.detail ?? 'Could not add video — check the URL.')
    } finally {
      setLoading(false)
    }
  }

  const disabled = loading || !url.trim()

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      <div style={{ display: 'flex', gap: 6, width: '100%', minWidth: 0, boxSizing: 'border-box' }}>
        <input
          type="text"
          value={url}
          onChange={e => { setUrl(e.target.value); setError(null); setLastAdded(null) }}
          placeholder="Paste YouTube URL..."
          disabled={loading}
          style={{
            flex: 1, minWidth: 0, width: '100%',
            padding: '8px 10px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-strong)',
            background: 'var(--bg-base)',
            color: 'var(--text-primary)', fontSize: 12,
            outline: 'none', transition: 'border-color 0.15s',
            boxSizing: 'border-box',
          }}
          onFocus={e => e.target.style.borderColor = 'var(--accent)'}
          onBlur={e => e.target.style.borderColor = 'var(--border-strong)'}
        />

        <button
          type="submit"
          disabled={disabled}
          style={{
            padding: '8px 10px', borderRadius: 'var(--radius-sm)',
            background: disabled ? 'var(--bg-active)' : 'var(--accent)',
            color: disabled ? 'var(--text-muted)' : '#000000',
            border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: 12, fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 4,
            transition: 'background 0.15s',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'var(--accent-hover)' }}
          onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = 'var(--accent)' }}
        >
          {loading
            ? <Loader2Icon size={13} style={{ animation: 'spin 0.8s linear infinite' }} />
            : <PlusIcon size={14} />
          }
          {loading ? 'Adding' : 'Add'}
        </button>
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--danger)', padding: '2px 4px', fontWeight: 500 }}>
          <AlertCircleIcon size={12} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}
      {lastAdded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--success)', padding: '2px 4px', fontWeight: 500 }}>
          <CheckCircle2Icon size={12} style={{ flexShrink: 0 }} />
          <span>{lastAdded.already ? 'Linked: ' : 'Indexing started: '} <strong>{lastAdded.title}</strong></span>
        </div>
      )}
    </form>
  )
}