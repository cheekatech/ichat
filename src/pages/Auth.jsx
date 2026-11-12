import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { supabase, linkError } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { siteUrl } from '../lib/utils';

export default function Auth() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('signup');
  const [form, setForm] = useState({ displayName: '', username: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(linkError || '');
  const [info, setInfo] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [unconfirmed, setUnconfirmed] = useState(false);

  if (session) return <Navigate to="/" replace />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const switchMode = (m) => {
    setMode(m);
    setError('');
    setInfo('');
    setUnconfirmed(false);
  };

  async function signUp() {
    const username = form.username.trim().toLowerCase();
    const displayName = form.displayName.trim();
    const email = form.email.trim();
    if (!displayName) return setError('Enter your name.');
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      return setError('Usernames are 3 to 20 characters: lowercase letters, numbers or underscores.');
    }
    if (form.password.length < 8) return setError('Use a password with at least 8 characters.');

    const { data: free, error: e1 } = await supabase.rpc('username_available', { u: username });
    if (e1) throw e1;
    if (!free) return setError('That username is taken. Try another one.');

    const { data, error: e2 } = await supabase.auth.signUp({
      email,
      password: form.password,
      options: { emailRedirectTo: siteUrl(), data: { username, display_name: displayName } },
    });
    if (e2) throw e2;
    // Supabase returns an empty identities list when the email is already registered.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return setError('An account with this email already exists. Log in instead.');
    }
    if (data.session) {
      navigate('/', { replace: true });
      return;
    }
    setSentTo(email);
  }

  async function logIn() {
    const { error: e } = await supabase.auth.signInWithPassword({
      email: form.email.trim(),
      password: form.password,
    });
    if (e) {
      if (/not confirmed/i.test(e.message)) {
        setUnconfirmed(true);
        return setError('Verify your email first. We sent you a link when you created your account.');
      }
      if (/invalid login/i.test(e.message)) return setError('Email or password is incorrect.');
      throw e;
    }
    navigate('/', { replace: true });
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    try {
      if (mode === 'signup') await signUp();
      else await logIn();
    } catch (err) {
      setError(err.message || 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function resend(email) {
    setError('');
    const { error: e } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: siteUrl() },
    });
    if (e) setError(e.message);
    else setInfo('Verification email sent. It can take a minute to arrive.');
  }

  async function forgot() {
    if (!form.email.trim()) return setError('Enter your email above, then select "Forgot password".');
    setError('');
    const { error: e } = await supabase.auth.resetPasswordForEmail(form.email.trim(), {
      redirectTo: `${siteUrl()}account`,
    });
    if (e) setError(e.message);
    else setInfo('Password reset link sent. Check your inbox.');
  }

  return (
    <div className="auth">
      <section className="auth-art" aria-hidden="true">
        <div className="wordmark"><span className="brand-mark big">i</span>Chat</div>
        <div className="demo">
          <p className="bubble in">Did you verify your email yet?</p>
          <p className="bubble out">Just did. I&apos;m in.</p>
          <p className="bubble in">Join the group. We&apos;re about to call.</p>
        </div>
      </section>

      <section className="auth-panel">
        {sentTo ? (
          <div className="auth-card">
            <h1 className="display">Check your inbox</h1>
            <p>
              We sent a verification link to <strong>{sentTo}</strong>. Open it and you will land on your iChat home page,
              signed in.
            </p>
            {error && <p className="error-banner" role="alert">{error}</p>}
            {info && <p className="notice" role="status">{info}</p>}
            <div className="btn-row">
              <button className="btn" onClick={() => resend(sentTo)}>Resend email</button>
              <button className="btn ghost" onClick={() => { setSentTo(''); switchMode('login'); }}>
                I have verified, log in
              </button>
            </div>
          </div>
        ) : (
          <form className="auth-card" onSubmit={submit} noValidate>
            <h1 className="display">{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => switchMode('signup')}>
                Create account
              </button>
              <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'on' : ''} onClick={() => switchMode('login')}>
                Log in
              </button>
            </div>

            {mode === 'signup' && (
              <>
                <label className="field">
                  <span>Your name</span>
                  <input value={form.displayName} onChange={set('displayName')} autoComplete="name" maxLength={50} required />
                </label>
                <label className="field">
                  <span>Username</span>
                  <input value={form.username} onChange={set('username')} autoComplete="username" maxLength={20} placeholder="ada_l" autoCapitalize="none" required />
                </label>
              </>
            )}
            <label className="field">
              <span>Email</span>
              <input type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={form.password}
                onChange={set('password')}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                minLength={8}
                required
              />
            </label>

            {error && <p className="error-banner" role="alert">{error}</p>}
            {info && <p className="notice" role="status">{info}</p>}

            <button className="btn primary block" disabled={busy}>
              {busy ? 'One moment…' : mode === 'signup' ? 'Create account' : 'Log in'}
            </button>

            {mode === 'login' && (
              <div className="btn-row spread">
                <button type="button" className="link" onClick={forgot}>Forgot password?</button>
                {unconfirmed && (
                  <button type="button" className="link" onClick={() => resend(form.email.trim())}>
                    Resend verification email
                  </button>
                )}
              </div>
            )}
          </form>
        )}
      </section>
    </div>
  );
}
