import { useEffect, useRef, useState } from 'react';
import { Camera, LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { applyTheme, prefs } from '../lib/prefs';
import { extOf } from '../lib/utils';
import Avatar from '../components/Avatar';

export default function Account() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const [form, setForm] = useState({ display_name: '', username: '', bio: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { type, text }
  const [uploading, setUploading] = useState(false);
  const [theme, setTheme] = useState(prefs.get('theme', 'system'));
  const [ring, setRing] = useState(prefs.get('ring', true));
  const [pw, setPw] = useState({ next: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (profile) setForm({ display_name: profile.display_name, username: profile.username, bio: profile.bio || '' });
  }, [profile]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function saveProfile(e) {
    e.preventDefault();
    setMsg(null);
    const username = form.username.trim().toLowerCase();
    const display_name = form.display_name.trim();
    if (!display_name) return setMsg({ type: 'error', text: 'Your name cannot be empty.' });
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      return setMsg({ type: 'error', text: 'Usernames are 3 to 20 characters: lowercase letters, numbers or underscores.' });
    }
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ display_name, username, bio: form.bio.trim() })
      .eq('id', user.id);
    setSaving(false);
    if (error) {
      return setMsg({
        type: 'error',
        text: error.code === '23505' ? 'That username is taken. Try another one.' : error.message,
      });
    }
    await refreshProfile();
    setMsg({ type: 'ok', text: 'Profile saved.' });
  }

  async function uploadAvatar(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(f.type)) {
      return setMsg({ type: 'error', text: 'Choose a JPG, PNG, WebP, GIF or AVIF image.' });
    }
    if (f.size > 5 * 1024 * 1024) return setMsg({ type: 'error', text: 'Profile photos must be 5 MB or smaller.' });
    setUploading(true);
    setMsg(null);
    const path = `${user.id}/avatars/${crypto.randomUUID()}.${extOf(f)}`;
    const { error: upErr } = await supabase.storage.from('public-media').upload(path, f, { contentType: f.type });
    if (upErr) {
      setUploading(false);
      return setMsg({ type: 'error', text: upErr.message });
    }
    const url = supabase.storage.from('public-media').getPublicUrl(path).data.publicUrl;
    const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', user.id);
    setUploading(false);
    if (error) return setMsg({ type: 'error', text: error.message });
    await refreshProfile();
    setMsg({ type: 'ok', text: 'Profile photo updated.' });
  }

  async function changePassword(e) {
    e.preventDefault();
    setPwMsg(null);
    if (pw.next.length < 8) return setPwMsg({ type: 'error', text: 'Use at least 8 characters.' });
    if (pw.next !== pw.confirm) return setPwMsg({ type: 'error', text: 'The passwords do not match.' });
    const { error } = await supabase.auth.updateUser({ password: pw.next });
    if (error) return setPwMsg({ type: 'error', text: error.message });
    setPw({ next: '', confirm: '' });
    setPwMsg({ type: 'ok', text: 'Password updated.' });
  }

  function chooseTheme(t) {
    setTheme(t);
    prefs.set('theme', t);
    applyTheme(t);
  }

  if (!profile) return null;

  return (
    <div className="page narrow">
      <header className="page-head">
        <h1 className="display">Account</h1>
        <p className="muted">Your profile, preferences and security.</p>
      </header>

      <form className="card stack" onSubmit={saveProfile}>
        <h2>Profile</h2>
        <div className="avatar-edit">
          <Avatar profile={profile} size={84} />
          <div>
            <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp,image/gif,image/avif" onChange={uploadAvatar} />
            <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Camera size={18} /> {uploading ? 'Uploading…' : 'Change photo'}
            </button>
          </div>
        </div>
        <label className="field">
          <span>Name</span>
          <input value={form.display_name} onChange={set('display_name')} maxLength={50} />
        </label>
        <label className="field">
          <span>Username</span>
          <input value={form.username} onChange={set('username')} maxLength={20} autoCapitalize="none" />
        </label>
        <label className="field">
          <span>Bio</span>
          <textarea value={form.bio} onChange={set('bio')} maxLength={200} rows={3} />
        </label>
        {msg && <p className={msg.type === 'ok' ? 'notice' : 'error-banner'} role="status">{msg.text}</p>}
        <div className="btn-row">
          <button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>

      <section className="card stack">
        <h2>Account details</h2>
        <dl className="details">
          <div><dt>Email</dt><dd>{user.email}</dd></div>
          <div><dt>Username</dt><dd>@{profile.username}</dd></div>
          <div>
            <dt>Member since</dt>
            <dd>{new Date(profile.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</dd>
          </div>
          <div>
            <dt>Email status</dt>
            <dd>{user.email_confirmed_at ? 'Verified' : 'Not verified'}</dd>
          </div>
        </dl>
      </section>

      <section className="card stack">
        <h2>Settings</h2>
        <fieldset className="seg">
          <legend>Appearance</legend>
          {['system', 'light', 'dark'].map((t) => (
            <button type="button" key={t} className={theme === t ? 'on' : ''} aria-pressed={theme === t} onClick={() => chooseTheme(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </fieldset>
        <label className="toggle">
          <input
            type="checkbox"
            checked={ring}
            onChange={(e) => {
              setRing(e.target.checked);
              prefs.set('ring', e.target.checked);
            }}
          />
          <span>Play a ringtone for incoming calls</span>
        </label>
      </section>

      <form className="card stack" onSubmit={changePassword}>
        <h2>Change password</h2>
        <label className="field">
          <span>New password</span>
          <input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} />
        </label>
        <label className="field">
          <span>Confirm new password</span>
          <input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} />
        </label>
        {pwMsg && <p className={pwMsg.type === 'ok' ? 'notice' : 'error-banner'} role="status">{pwMsg.text}</p>}
        <div className="btn-row">
          <button className="btn">Update password</button>
        </div>
      </form>

      <button className="btn danger block" onClick={signOut}>
        <LogOut size={18} /> Log out
      </button>
    </div>
  );
}
