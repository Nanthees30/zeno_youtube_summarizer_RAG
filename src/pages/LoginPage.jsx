import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import bgVideo from '../assets/zeno_original_background.mp4';

export default function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode]         = useState('login');
  const [formData, setFormData] = useState({ username: '', email: '', password: '' });
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [videoOpacity, setVideoOpacity] = useState(1);

  const videoRef  = useRef(null);
  const fadingRef = useRef(false);

  // ── Seamless video loop with fade ──────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const FADE_BEFORE_END = 1.2;

    const handleTimeUpdate = () => {
      if (!video.duration) return;
      if ((video.duration - video.currentTime) <= FADE_BEFORE_END && !fadingRef.current) {
        fadingRef.current = true;
        setVideoOpacity(0);
      }
    };
    const handleEnded = () => {
      video.currentTime = 0;
      video.play();
      setTimeout(() => { fadingRef.current = false; setVideoOpacity(1); }, 200);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended',      handleEnded);
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended',      handleEnded);
    };
  }, []);

  const handleChange = (e) =>
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { username, email, password } = formData;
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        if (!username.trim()) { setError('Username is required'); setLoading(false); return; }
        await register(username.trim(), email, password);
      }
      navigate('/', { replace: true });
    } catch (err) {
      const detail = err?.response?.data?.detail;
      const msg = Array.isArray(detail)
        ? detail.map(d => d.msg ?? String(d)).join(', ')
        : (detail ?? 'Something went wrong — please try again.');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const toggleMode = () => {
    setMode(p => p === 'login' ? 'register' : 'login');
    setError(null);
  };

  // Input focus/blur — uses --accent token from index.css
  const onFocus = (e) => {
    e.target.style.borderColor = 'var(--accent)';
    e.target.style.boxShadow   = '0 0 0 3px var(--accent-glow)';
  };
  const onBlur = (e) => {
    e.target.style.borderColor = 'var(--border-strong)';
    e.target.style.boxShadow   = 'none';
  };

  const inputBase = {
    width:        '100%',
    padding:      '13px 16px',
    borderRadius: 'var(--radius-md)',
    border:       '1px solid var(--border-strong)',
    background:   'var(--bg-elevated)',
    color:        'var(--text-primary)',
    fontSize:     14,
    outline:      'none',
    boxSizing:    'border-box',
    fontFamily:   'var(--font-sans)',
    transition:   'border-color 0.2s, box-shadow 0.2s',
  };

  return (
    <div className="relative min-h-screen w-screen overflow-hidden flex">

      {/* ── Background Video ─────────────────────────────────────────────── */}
      <video
        ref={videoRef}
        autoPlay muted playsInline
        src={bgVideo}
        className="absolute inset-0 w-full h-full object-cover z-0 transition-opacity duration-700"
        style={{ opacity: videoOpacity }}
      />

      {/* ── Overlay ──────────────────────────────────────────────────────── */}
      <div
        className="absolute inset-0 z-10"
        style={{
          background: 'linear-gradient(135deg, rgba(12,14,26,0.30) 0%, rgba(12,14,26,0.75) 100%)',
        }}
      />

      {/* ── Glass Card — uses index.css tokens ───────────────────────────── */}
      <div
        className="absolute z-20 flex flex-col items-center w-full"
        style={{
          bottom:              '8%',
          right:               '6%',
          maxWidth:            430,
          gap:                 24,
          padding:             '48px 44px',
          borderRadius:        'var(--radius-xl)',
          background:          'var(--bg-surface)',   // #11131f — from token
          backdropFilter:      'blur(24px)',
          WebkitBackdropFilter:'blur(24px)',
          border:              '1px solid var(--border-strong)',
          boxShadow:           '0 32px 64px rgba(0,0,0,0.6), 0 0 48px var(--accent-glow)',
          boxSizing:           'border-box',
        }}
      >

        {/* ── Z Logo ───────────────────────────────────────────────────── */}
        <div
          className="flex items-center justify-center shrink-0 text-white"
          style={{
            width:        68,
            height:       68,
            borderRadius: 'var(--radius-lg)',
            fontSize:     28,
            fontWeight:   800,
            fontFamily:   'var(--font-mono)',
            background:   'linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%)',
            boxShadow:    '0 8px 28px var(--accent-glow)',
            border:       '1px solid var(--border-strong)',
          }}
        >
          Z
        </div>

        {/* ── Heading ──────────────────────────────────────────────────── */}
        <div className="text-center w-full">
          <h1
            className="font-bold text-center mb-2"
            style={{
              fontSize:      26,
              color:         'var(--text-primary)',
              fontFamily:    'var(--font-display)',
              letterSpacing: '-0.3px',
            }}
          >
            {mode === 'login' ? 'Welcome back' : 'Create account'}
          </h1>
          <p
            className="text-sm leading-relaxed"
            style={{ color: 'var(--text-secondary)' }}
          >
            {mode === 'login' ? 'Sign in to continue to Zeno' : 'Get started with Zeno'}
          </p>
        </div>

        {/* ── Form ─────────────────────────────────────────────────────── */}
        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">

          {/* {mode === 'register' && (
            <input
              type="text" name="username" placeholder="Username"
              value={formData.username} onChange={handleChange} required
              style={inputBase}
              onFocus={onFocus} onBlur={onBlur}
            />
          )} */}

          <input
            type="email" name="email" placeholder="Email"
            value={formData.email} onChange={handleChange} required
            style={inputBase}
            onFocus={onFocus} onBlur={onBlur}
          />

          <input
            type="password" name="password" placeholder="Password"
            value={formData.password} onChange={handleChange}
            required minLength={8}
            style={inputBase}
            onFocus={onFocus} onBlur={onBlur}
          />

          {/* Error */}
          {error && (
            <p
              className="text-xs text-center font-medium"
              style={{ color: 'var(--danger)', marginTop: -4 }}
            >
              {error}
            </p>
          )}

          {/* ── Sign in button ─────────────────────────────────────────── */}
          <button
            type="submit" disabled={loading}
            className="w-full font-bold tracking-wide transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none"
            style={{
              padding:      '14px',
              borderRadius: 'var(--radius-md)',
              border:       'none',
              marginTop:    4,
              background:   'var(--accent)',
              color:        '#ffffff',
              fontSize:     15,
              boxShadow:    '0 6px 20px var(--accent-glow)',
              cursor:       loading ? 'not-allowed' : 'pointer',
              fontFamily:   'var(--font-sans)',
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.background = 'var(--accent-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent)'; }}
          >
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        {/* ── Divider ──────────────────────────────────────────────────── */}
        <div className="w-full" style={{ height: 1, background: 'var(--border)' }} />

        {/* ── Toggle mode ──────────────────────────────────────────────── */}
        <p
          className="text-sm text-center m-0"
          style={{ color: 'var(--text-secondary)', marginTop: -8 }}
        >
          {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}
          <button
            type="button" onClick={toggleMode}
            className="ml-1.5 bg-transparent border-none font-semibold text-sm cursor-pointer p-0 transition-opacity duration-200 hover:opacity-75"
            style={{ color: 'var(--accent)', fontFamily: 'var(--font-sans)' }}
          >
            {mode === 'login' ? 'Register' : 'Sign in'}
          </button>
        </p>

      </div>
    </div>
  );
}