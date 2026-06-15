import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-base)',
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          border: '2px solid var(--accent)',
          borderTopColor: 'transparent',
          animation: 'spin 0.7s linear infinite',
        }} />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  return children
}
