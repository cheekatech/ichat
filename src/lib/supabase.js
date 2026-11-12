import { createClient } from '@supabase/supabase-js';

export function resolveSupabaseConfig(env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {}) {
  const rawUrl = String(env.VITE_SUPABASE_URL ?? '').trim();
  const rawKey = String(env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  const url = /^https?:\/\//.test(rawUrl) ? rawUrl : '';
  const key = rawKey;

  return {
    url,
    key,
    isConfigured: Boolean(url && key),
  };
}

const { url, key, isConfigured } = resolveSupabaseConfig();

// When a verification/reset link is expired, Supabase redirects back with
// #error_description=... in the URL. Capture it before the router rewrites the URL.
export const linkError = (() => {
  if (typeof window === 'undefined' || !window.location) return '';
  try {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return params.get('error_description') || '';
  } catch {
    return '';
  }
})();

export { isConfigured };

export const supabase = isConfigured
  ? createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
