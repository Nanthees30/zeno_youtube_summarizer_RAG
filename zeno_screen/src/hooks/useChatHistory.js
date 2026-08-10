import { useState, useCallback, useMemo } from 'react'
import { api } from '../service/api'

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

function loadSessions(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? deserialize(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

function persist(sessions, key) {
  try {
    localStorage.setItem(key, JSON.stringify(sessions))
  } catch { /* ignore */ }
}

function generateId() {
  if (typeof crypto?.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Date.now().toString() + '-' + Math.random().toString(36).slice(2)
}

function newSession(videoId = null, title = 'New Chat') {
  return {
    id: generateId(),
    title: title || 'New Chat',
    messages: [],
    videoId: videoId ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export function useChatHistory(userId) {
  const STORAGE_KEY = userId ? `zeno_sessions_${userId}` : null

  const [sessions, setSessions] = useState(() =>
    STORAGE_KEY ? loadSessions(STORAGE_KEY) : []
  )

  const [activeId, setActiveId] = useState(() => {
    if (!STORAGE_KEY) return null
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw)[0]?.id ?? null : null
    } catch {
      return null
    }
  })

  const save = useCallback((next) => {
    setSessions(next)
    if (STORAGE_KEY) persist(next, STORAGE_KEY)
  }, [STORAGE_KEY])

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

  // Automatically create or assign a new video chat session when a video is added
  const createSessionForVideo = useCallback((videoId, videoTitle = '') => {
    const activeSession = sessions.find(s => s.id === activeId)
    
    // If current session is completely empty with no video, attach video to it
    if (activeSession && (!activeSession.messages || activeSession.messages.length === 0) && !activeSession.videoId) {
      const updatedTitle = videoTitle || activeSession.title
      save(sessions.map(s => s.id === activeId ? { ...s, videoId, title: updatedTitle } : s))
      return activeId
    } else {
      // Create brand new chat session for this new video
      const s = newSession(videoId, videoTitle || 'Video Chat')
      save([s, ...sessions])
      setActiveId(s.id)
      return s.id
    }
  }, [activeId, sessions, save])

  const selectSession = useCallback((id) => {
    setActiveId(id)
  }, [])

  const saveMessages = useCallback((msgs) => {
    if (!activeId) return
    const activeSession = sessions.find(s => s.id === activeId)
    const existingTitle = activeSession?.title !== 'New Chat' ? activeSession?.title : null
    const title = existingTitle || msgs.find(m => m.role === 'user')?.content?.slice(0, 45) || 'Video Chat'

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

  // Delete chat session AND clean up video DB details if no other session uses it
  const deleteSession = useCallback((id) => {
    const sessionToDelete = sessions.find(s => s.id === id)
    const videoId = sessionToDelete?.videoId

    const next = sessions.filter(s => s.id !== id)
    save(next)

    if (activeId === id) setActiveId(next[0]?.id ?? null)

    if (videoId) {
      const usedInOtherSession = next.some(s => s.videoId === videoId)
      if (!usedInOtherSession) {
        api.deleteVideo(videoId).catch(() => {})
      }
    }
  }, [activeId, sessions, save])

  return {
    sessions,
    activeId,
    activeMessages,
    sessionVideoId,
    createSession,
    createSessionForVideo,
    selectSession,
    saveMessages,
    setSessionVideo,
    deleteSession,
  }
}