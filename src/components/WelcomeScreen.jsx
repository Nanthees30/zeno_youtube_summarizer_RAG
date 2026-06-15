const SUGGESTIONS = [
  'Summarize the main points of the video',
  'What are the key topics covered?',
  'Explain the most important ideas in detail',
  'What does the video say about [topic]?',
]

export function WelcomeScreen({ onSuggestion, indexReady, sessionVideoId }) {
  const statusText = sessionVideoId
    ? (indexReady === true  ? 'Video indexed and ready. Try a suggestion or ask your own question.'
     : indexReady === null  ? 'Indexing in progress… Please wait.'
     : 'Video indexing failed. Check the video list in the sidebar for details.')
    : 'No video context available in this tab. Add a YouTube URL from the sidebar to get started.'

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      height: '100%', padding: '48px 24px', gap: 22,
    }}>
      {/* Logo mark */}
      <div style={{
        width: 52, height: 52, borderRadius: 16,
        background: 'var(--accent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 22, fontWeight: 700, color: '#fff',
        fontFamily: 'var(--font-mono)',
        boxShadow: '0 8px 28px var(--accent-glow)',
      }}>
        Z
      </div>

      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <h2 style={{
          fontSize: 19, fontWeight: 600,
          color: 'var(--text-primary)', marginBottom: 8,
        }}>
          Ask your YouTube videos anything
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          {statusText}
        </p>
      </div>

      {/* Suggestion chips — only when this tab has a video and it's ready */}
      {sessionVideoId && indexReady && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 8,
          width: '100%', maxWidth: 480,
        }}>
          {SUGGESTIONS.map(s => (
            <button
              key={s}
              onClick={() => onSuggestion(s)}
              style={{
                textAlign: 'left', padding: '10px 14px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-strong)',
                borderRadius: 10, cursor: 'pointer',
                fontSize: 13, color: 'var(--text-secondary)',
                transition: 'border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--accent)'
                e.currentTarget.style.color = 'var(--text-primary)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--border-strong)'
                e.currentTarget.style.color = 'var(--text-secondary)'
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
