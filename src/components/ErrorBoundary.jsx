import { Component } from 'react'

/**
 * ErrorBoundary — catches any render/lifecycle throw inside the tree.
 *
 * Without this, a single component error in production causes React to
 * unmount the entire root → blank white DOM. This component intercepts
 * the crash and shows a recovery UI instead.
 *
 * Must be a class component — React has no functional equivalent yet.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        height: '100vh', gap: 16,
        background: 'var(--bg-base)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-sans)',
        padding: 24,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: 'rgba(248,113,113,0.15)',
          border: '1px solid rgba(248,113,113,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20,
        }}>
          ⚠
        </div>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
            Something went wrong
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
        </div>
        <button
          onClick={() => this.setState({ error: null })}
          style={{
            padding: '8px 18px', borderRadius: 8,
            background: 'var(--accent)', color: '#fff',
            border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 500,
          }}
        >
          Try again
        </button>
      </div>
    )
  }
}
