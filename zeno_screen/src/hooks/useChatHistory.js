import { useState, useCallback, useMemo } from 'react'

const STORAGE_KEY = 'zeno_sessions'

function deserialize(sessions) {
  return sessions.map(s => ({
    ...s,
    videoId: s.videoId ?? null,
    messages: (s.messages || []).map(m => ({
      ...m,
      timestamp: new Date(m.timestamp),
    })),
  }))
}

function loadSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? deserialize(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

function persist(sessions) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  } catch { /* storage full — silently skip */ }
}

function newSession() {
  return {
    id: crypto.randomUUID(),
    title: 'New chat',
    messages: [],
    videoId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export function useChatHistory() {
  const [sessions, setSessions] = useState(loadSessions)
  // L-7: derive initial activeId from the same raw storage read — avoids a
  // second full JSON parse just to get the first session id.
  const [activeId, setActiveId] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw)[0]?.id ?? null : null
    } catch {
      return null
    }
  })

  const save = useCallback((next) => {
    setSessions(next)
    persist(next)
  }, [])

  const activeMessages = useMemo(() => {
    if (!activeId) return []
    return sessions.find(s => s.id === activeId)?.messages ?? []
  }, [activeId, sessions])

  const sessionVideoId = useMemo(() => {
    if (!activeId) return null
    return sessions.find(s => s.id === activeId)?.videoId ?? null
  }, [activeId, sessions])

  const createSession = useCallback(() => {
    const s = newSession()
    save([s, ...sessions])
    setActiveId(s.id)
    return s
  }, [sessions, save])

  const selectSession = useCallback((id) => {
    setActiveId(id)
  }, [])

  const saveMessages = useCallback((msgs) => {
    if (!activeId) return
    const title =
      msgs.find(m => m.role === 'user')?.content?.slice(0, 45) || 'New chat'
    save(
      sessions.map(s =>
        s.id === activeId
          ? { ...s, messages: msgs, title, updatedAt: new Date().toISOString() }
          : s
      )
    )
  }, [activeId, sessions, save])

  const setSessionVideo = useCallback((videoId) => {
    if (!activeId) return
    save(
      sessions.map(s =>
        s.id === activeId ? { ...s, videoId } : s
      )
    )
  }, [activeId, sessions, save])

  const deleteSession = useCallback((id) => {
    const next = sessions.filter(s => s.id !== id)
    save(next)
    if (activeId === id) setActiveId(next[0]?.id ?? null)
  }, [activeId, sessions, save])

  return {
    sessions,
    activeId,
    activeMessages,
    sessionVideoId,
    createSession,
    selectSession,
    saveMessages,
    setSessionVideo,
    deleteSession,
  }
}
