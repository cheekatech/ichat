import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && key);

// When a verification/reset link is expired, Supabase redirects back with
// #error_description=... in the URL. Capture it before the router rewrites the URL.
export const linkError = (() => {
  try {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return params.get('error_description') || '';
  } catch {
    return '';
  }
})();

export const supabase = createClient(url || 'http://localhost:54321', key || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
