import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSupabaseConfig } from './supabase.js';

test('missing config is rejected', () => {
  const result = resolveSupabaseConfig({});
  assert.equal(result.isConfigured, false);
  assert.equal(result.url, '');
  assert.equal(result.key, '');
});

test('valid config is accepted', () => {
  const result = resolveSupabaseConfig({
    VITE_SUPABASE_URL: 'https://example.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'anon-key',
  });
  assert.equal(result.isConfigured, true);
  assert.equal(result.url, 'https://example.supabase.co');
  assert.equal(result.key, 'anon-key');
});
