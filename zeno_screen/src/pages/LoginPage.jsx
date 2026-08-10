import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import bgVideo from '../assets/zeno_original_background.mp4';

export default function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState('login');
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [videoOpacity, setVideoOpacity] = useState(1);

  const videoRef = useRef(null);
  const fadingRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const FADE_BEFORE_END = 1.2;

    const handleTimeUpdate = () => {
      if (!video.duration) return;

      if (
        video.duration - video.currentTime <= FADE_BEFORE_END &&
        !fadingRef.current
      ) {
        fadingRef.current = true;
        setVideoOpacity(0);
      }
    };

    const handleEnded = () => {
      video.currentTime = 0;
      video.play().catch(() => {});

      setTimeout(() => {
        fadingRef.current = false;
        setVideoOpacity(1);
      }, 200);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('ended', handleEnded);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('ended', handleEnded);
    };
  }, []);

  const handleChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { username, email, password } = formData;

    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        if (!username.trim()) {
          setError('Username is required');
          setLoading(false);
          return;
        }

        await register(
          username.trim(),
          email,
          password,
          username.trim()
        );
      }

      navigate('/', { replace: true });
    } catch (err) {
      console.error('[Auth Error]', err);

      const detail = err?.response?.data?.detail;
      let msg = '';

      if (Array.isArray(detail)) {
        msg = detail
          .map(
            (d) =>
              `${d.loc?.[d.loc.length - 1] ?? 'field'}: ${d.msg}`
          )
          .join(', ');
      } else if (typeof detail === 'string') {
        msg = detail;
      } else if (err?.message === 'Network Error' || !err?.response) {
        msg =
          'Cannot connect to backend server. Please check your network.';
      } else {
        msg =
          err?.message || 'Something went wrong — please try again.';
      }

      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const toggleMode = () => {
    setMode((prev) => (prev === 'login' ? 'register' : 'login'));
    setError(null);
  };

  const onFocus = (e) => {
    e.target.style.borderColor = 'var(--accent)';
    e.target.style.boxShadow =
      '0 0 0 3px var(--accent-glow)';
    e.target.style.background = 'rgba(20, 20, 20, 0.95)';
  };

  const onBlur = (e) => {
    e.target.style.borderColor = 'var(--border-strong)';
    e.target.style.boxShadow = 'none';
    e.target.style.background = 'rgba(20, 20, 20, 0.85)';
  };

  const inputBase = {
    width: '100%',
    height: 46,
    padding: '0 14px',
    borderRadius: 10,
    border: '1px solid var(--border-strong)',
    background: 'rgba(20, 20, 20, 0.85)',
    color: 'var(--text-primary)',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'var(--font-sans)',
    transition:
      'border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease',
  };

  return (
    <div
      className="relative w-full flex"
      style={{
        minHeight: '100dvh',
        background: '#000000',
        overflow: 'hidden',
      }}
    >
      {/* ================= BACKGROUND VIDEO ================= */}
      <div
        className="absolute inset-0 z-0"
        style={{ overflow: 'hidden' }}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          loop={false}
          src={bgVideo}
          className="w-full h-full object-cover transition-opacity duration-700"
          style={{
            opacity: videoOpacity,
          }}
        />

        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(90deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.5) 52%, rgba(0,0,0,0.95) 100%)',
          }}
        />
      </div>

      {/* ================= LEFT BRAND PANEL ================= */}
      <div className="hidden md:flex relative z-10 flex-col justify-between w-[58%] p-14">
        <div className="flex items-center gap-3">
          <img
            src="/zeno_logo.png"
            alt="Zeno"
            style={{
              width: 36,
              height: 36,
              objectFit: 'contain',
            }}
            onError={(e) => {
              e.target.src = '/logo.png';
            }}
          />

          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 18,
              letterSpacing: '1px',
              color: 'var(--text-primary)',
            }}
          >
            ZENO
          </span>
        </div>

        <div
          style={{
            maxWidth: 420,
            marginBottom: 20,
          }}
        >
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 32,
              lineHeight: 1.15,
              color: 'var(--text-primary)',
              marginBottom: 10,
            }}
          >
            {/* Your voice, */}
            <br />
            {/* understood instantly. */}
          </h2>

          <p
            style={{
              fontSize: 14,
              color: 'var(--text-muted)',
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            {/* Sign in to pick up right where you left off. */}
          </p>
        </div>
      </div>

      {/* ================= FORM PANEL ================= */}
      <div
        className="relative z-10 w-full md:w-[42%] flex items-center justify-center px-7 py-8 sm:px-8 md:px-12 md:py-10"
        style={{
          minHeight: '100dvh',
          boxSizing: 'border-box',
        }}
      >
        <div
          className="w-full flex flex-col items-center"
          style={{
            maxWidth: 380,
            padding: '30px 28px',
            gap: 18,
            borderRadius: 18,
            background: 'rgba(12, 12, 12, 0.88)',
            backdropFilter: 'blur(28px)',
            WebkitBackdropFilter: 'blur(28px)',
            border: '1px solid rgba(255,255,255,0.09)',
            boxShadow:
              '0 24px 60px rgba(0,0,0,0.8), 0 0 32px var(--accent-glow)',
            boxSizing: 'border-box',
          }}
        >
          {/* ================= MOBILE LOGO ================= */}
          <img
            src="/zeno_logo.png"
            alt="Zeno Logo"
            className="md:hidden"
            style={{
              width: 42,
              height: 42,
              objectFit: 'contain',
              filter:
                'drop-shadow(0 6px 20px var(--accent-glow))',
              marginBottom: 2,
            }}
            onError={(e) => {
              e.target.src = '/logo.png';
            }}
          />

          {/* ================= HEADING ================= */}
          <div
            style={{
              textAlign: 'center',
              width: '100%',
            }}
          >
            <h1
              className="text-[19px] md:text-[22px]"
              style={{
                fontWeight: 700,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-display)',
                letterSpacing: '-0.35px',
                margin: 0,
                marginBottom: 5,
              }}
            >
              {mode === 'login'
                ? 'Welcome back'
                : 'Create account'}
            </h1>

            <p
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                lineHeight: 1.4,
                margin: 0,
              }}
            >
              {mode === 'login'
                ? 'Sign in to continue to Zeno'
                : 'Get started with Zeno'}
            </p>
          </div>

          {/* ================= FORM ================= */}
          <form
            onSubmit={handleSubmit}
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {/* Username */}
            {mode === 'register' && (
              <div style={{ width: '100%' }}>
                <label
                  htmlFor="username"
                  style={{
                    display: 'block',
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    marginBottom: 6,
                  }}
                >
                  Username
                </label>

                <input
                  id="username"
                  type="text"
                  name="username"
                  placeholder="Enter your username"
                  value={formData.username}
                  onChange={handleChange}
                  required
                  autoComplete="username"
                  style={inputBase}
                  onFocus={onFocus}
                  onBlur={onBlur}
                />
              </div>
            )}

            {/* Email */}
            <div style={{ width: '100%' }}>
              <label
                htmlFor="email"
                style={{
                  display: 'block',
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  marginBottom: 6,
                }}
              >
                Email
              </label>

              <input
                id="email"
                type="email"
                name="email"
                placeholder="Enter your email"
                value={formData.email}
                onChange={handleChange}
                required
                autoComplete="email"
                style={inputBase}
                onFocus={onFocus}
                onBlur={onBlur}
              />
            </div>

            {/* Password */}
            <div style={{ width: '100%' }}>
              <label
                htmlFor="password"
                style={{
                  display: 'block',
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  marginBottom: 6,
                }}
              >
                Password
              </label>

              <input
                id="password"
                type="password"
                name="password"
                placeholder="Enter your password"
                value={formData.password}
                onChange={handleChange}
                required
                minLength={8}
                autoComplete={
                  mode === 'login'
                    ? 'current-password'
                    : 'new-password'
                }
                style={inputBase}
                onFocus={onFocus}
                onBlur={onBlur}
              />
            </div>

            {/* Error */}
            {error && (
              <div
                style={{
                  width: '100%',
                  padding: '9px 11px',
                  borderRadius: 8,
                  background: 'rgba(255, 70, 70, 0.08)',
                  border:
                    '1px solid rgba(255, 70, 70, 0.18)',
                  boxSizing: 'border-box',
                }}
              >
                <p
                  style={{
                    fontSize: 11,
                    color: 'var(--danger)',
                    textAlign: 'center',
                    fontWeight: 500,
                    lineHeight: 1.4,
                    margin: 0,
                  }}
                >
                  {error}
                </p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                height: 46,
                padding: '0 14px',
                borderRadius: 10,
                border: 'none',
                marginTop: 2,
                background: 'var(--accent)',
                color: '#000000',
                fontSize: 13,
                fontWeight: 700,
                boxShadow:
                  '0 7px 22px var(--accent-glow)',
                cursor: loading
                  ? 'not-allowed'
                  : 'pointer',
                fontFamily: 'var(--font-sans)',
                transition:
                  'transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease',
                opacity: loading ? 0.7 : 1,
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.currentTarget.style.background =
                    'var(--accent-hover)';
                  e.currentTarget.style.transform =
                    'translateY(-1px)';
                  e.currentTarget.style.boxShadow =
                    '0 9px 26px var(--accent-glow)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background =
                  'var(--accent)';
                e.currentTarget.style.transform =
                  'translateY(0)';
                e.currentTarget.style.boxShadow =
                  '0 7px 22px var(--accent-glow)';
              }}
            >
              {loading
                ? 'Please wait...'
                : mode === 'login'
                  ? 'Sign in'
                  : 'Create account'}
            </button>
          </form>

          {/* ================= DIVIDER ================= */}
          <div
            style={{
              width: '100%',
              height: 1,
              background: 'var(--border)',
              opacity: 0.8,
            }}
          />

          {/* ================= TOGGLE ================= */}
          <p
            style={{
              fontSize: 11.5,
              color: 'var(--text-muted)',
              textAlign: 'center',
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            {mode === 'login'
              ? "Don't have an account?"
              : 'Already have an account?'}

            <button
              type="button"
              onClick={toggleMode}
              style={{
                marginLeft: 5,
                background: 'none',
                border: 'none',
                fontWeight: 700,
                fontSize: 11.5,
                cursor: 'pointer',
                color: 'var(--accent)',
                fontFamily: 'var(--font-sans)',
                padding: 0,
              }}
            >
              {mode === 'login' ? 'Register' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}