import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [booting, setBooting] = useState(true);
  const [profileState, setProfileState] = useState('idle'); // idle | loading | ready | error
  const uid = session?.user?.id ?? null;

  // Session handling. Never await Supabase calls inside onAuthStateChange.
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setBooting(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setBooting(false);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const fetchProfile = useCallback(async (id, user) => {
    setProfileState('loading');
    let { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
    if (!data && !error && user) {
      // Safety net if the signup trigger did not create a profile.
      const fallback = `u_${id.replace(/-/g, '').slice(0, 8)}`;
      const ins = await supabase
        .from('profiles')
        .insert({
          id,
          username: fallback,
          display_name: user.user_metadata?.display_name || user.email?.split('@')[0] || fallback,
        })
        .select()
        .single();
      data = ins.data;
      error = ins.error;
    }
    if (error || !data) {
      setProfileState('error');
      return;
    }
    setProfile(data);
    setProfileState('ready');
  }, []);

  useEffect(() => {
    if (uid) fetchProfile(uid, session.user);
    else {
      setProfile(null);
      setProfileState('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, fetchProfile]);

  const refreshProfile = useCallback(() => (uid ? fetchProfile(uid, session?.user) : null), [uid, session, fetchProfile]);
  const signOut = useCallback(() => supabase.auth.signOut(), []);

  const loading = booting || (Boolean(uid) && profileState !== 'ready' && profileState !== 'error');

  return (
    <AuthCtx.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        profileError: profileState === 'error',
        refreshProfile,
        signOut,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}
