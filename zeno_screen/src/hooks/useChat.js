import { useState, useCallback, useEffect, useRef } from 'react'
import { api } from '../service/api'

const VISUAL_RE = /\b(visual|diagram|illustrate|explain how|show me|how does|draw|chart)\b/i

function makeMsg(role, content, extras = {}) {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: new Date(),
    ...extras,
  }
}

export function useChat({ initialMessages = [], onMessagesChange, sessionId, sessionVideoId } = {}) {
  const [messages, setMessages]     = useState(initialMessages || [])
  const [isLoading, setIsLoading]   = useState(false)
  const [isThinking, setIsThinking] = useState(false)  // true between send and first token
  const [error, setError]           = useState(null)
  const [indexReady, setIndexReady] = useState(null)

  const prevSessionId  = useRef(sessionId)
  const pollRef        = useRef(null)
  const isThinkingRef  = useRef(false)   // mutable ref — readable inside async callbacks

  // Reset when session changes
  useEffect(() => {
    if (sessionId !== prevSessionId.current) {
      prevSessionId.current = sessionId
      setMessages(initialMessages || [])
      setError(null)
      setIsLoading(false)
    }
  }, [sessionId, initialMessages])

  useEffect(() => {
    let cancelled = false
    if (!sessionVideoId) {
      setIndexReady(false)
      return
    }
    api.videoStatus(sessionVideoId)
      .then(d => { if (!cancelled) setIndexReady(d.indexing ? null : d.ready) })
      .catch(() => { if (!cancelled) setIndexReady(false) })
    return () => { cancelled = true }
  }, [sessionVideoId]) 

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current.interval)
        clearTimeout(pollRef.current.timeout)
      }
    }
  }, [])

  const update = useCallback((msgs) => {
    setMessages(msgs)
    onMessagesChange?.(msgs)
  }, [onMessagesChange])

  const sendMessage = useCallback(async (query, mode = 'chain') => {
    if (indexReady === null) {
      setError('Checking index status — please wait a moment.')
      return
    }
    if (!sessionVideoId) {
      setError('No video selected — add a YouTube URL from the sidebar first.')
      return
    }
    setError(null)
    const userMsg = makeMsg('user', query)
    const next    = [...messages, userMsg]
    update(next)
    setIsLoading(true)
    setIsThinking(true)
    isThinkingRef.current = true

    try {
      const effectiveMode = VISUAL_RE.test(query) ? 'agent' : mode
      // Last 3 conversation pairs (6 messages) for context; always sent with every request
      const historyForApi = messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-6)
        .map(m => ({ role: m.role, content: m.content }))
      const response = await api.chatStream(query, effectiveMode, sessionVideoId, historyForApi)

      if (!response.ok) {
        if (response.status === 401) {
          localStorage.removeItem('zeno_token')
          localStorage.removeItem('zeno_user')
          window.location.href = '/login'
          return
        }
        const body = await response.json().catch(() => ({}))
        throw new Error(body.detail || `Server error ${response.status}`)
      }

      const reader   = response.body.getReader()
      const decoder  = new TextDecoder()

      let answer    = ''
      let sources   = []
      let sseBuffer = ''     // C-5: accumulates bytes across TCP fragments

      // aiMsg is not added to messages until first token arrives — TypingIndicator
      // (controlled by isThinking) is shown until then, giving instant feedback.
      const aiMsg = makeMsg('assistant', '', { sources: [], model: '', streaming: true })

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        // C-5: append decoded bytes to buffer; { stream: true } handles multi-byte chars
        sseBuffer += decoder.decode(value, { stream: true })

        // SSE messages are separated by '\n\n' — split there, keep incomplete tail
        const parts = sseBuffer.split('\n\n')
        sseBuffer = parts.pop()   // last element is always the incomplete remainder

        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue

            // C-4: separate JSON parse from event handling so a throw in the
            // event handler propagates outward instead of being swallowed here
            let event
            try {
              event = JSON.parse(line.slice(6))
            } catch {
              continue   // genuinely malformed JSON — skip only this line
            }

            // Event handling is OUTSIDE the JSON try/catch so errors propagate
            if (event.type === 'sources') {
              sources = event.sources
            } else if (event.type === 'token') {
              answer += event.content
              // First token: hide thinking indicator, show streaming bubble
              if (isThinkingRef.current) {
                setIsThinking(false)
                isThinkingRef.current = false
              }
              update([...next, { ...aiMsg, content: answer, sources, streaming: true }])
            } else if (event.type === 'done') {
              update([...next, { ...aiMsg, content: answer, sources, model: event.model, streaming: false }])
            } else if (event.type === 'error') {
              // C-4: this throw now reaches the outer catch correctly
              throw new Error(event.detail || 'Stream error')
            }
          }
        }
      }
    } catch (err) {
      const detail = err?.response?.data?.detail || err.message || 'Request failed'
      setError(detail)
      update([...next, makeMsg('error', detail)])
    } finally {
      setIsThinking(false)
      isThinkingRef.current = false
      setIsLoading(false)
    }
  }, [messages, update, indexReady, sessionVideoId])

  const clearMessages = useCallback(() => {
    update([])
    setError(null)
  }, [update])

  // C-3: accept the video ID as an explicit parameter so the polling interval
  // never relies on a stale closure value — Sidebar calls onVideoIndexed(video_id)
  // immediately after onVideoLinked(video_id), before React re-renders.
  const onVideoIndexed = useCallback((videoId) => {
    // videoId passed from Sidebar; fall back to hook's own sessionVideoId
    const vidId = videoId ?? sessionVideoId

    if (pollRef.current) {
      clearInterval(pollRef.current.interval)
      clearTimeout(pollRef.current.timeout)
      pollRef.current = null
    }

    setIndexReady(null)

    const interval = setInterval(async () => {
      try {
        const d = await api.videoStatus(vidId)   // C-3: uses stable local var
        if (d.ready && !d.indexing) {
          setIndexReady(true)
          clearInterval(pollRef.current?.interval)
          clearTimeout(pollRef.current?.timeout)
          pollRef.current = null
        } else if (d.failed) {
          setIndexReady(false)
          setError(d.error_msg || 'Video indexing failed — try a different video.')
          clearInterval(pollRef.current?.interval)
          clearTimeout(pollRef.current?.timeout)
          pollRef.current = null
        }
      } catch {
        // keep polling
      }
    }, 8000)

    const timeout = setTimeout(() => {
      clearInterval(interval)
      pollRef.current = null
      setIndexReady(false)
    }, 120_000)

    pollRef.current = { interval, timeout }
  }, [sessionVideoId])  

  return {
    messages,
    isLoading,
    isThinking,
    error,
    indexReady,
    sendMessage,
    clearMessages,
    onVideoIndexed,
  }
}