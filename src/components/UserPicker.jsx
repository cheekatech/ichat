import { useEffect, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { cleanSearch } from '../lib/utils';
import Avatar from './Avatar';

export default function UserPicker({ excludeIds = [], selectedIds = [], onPick, autoFocus = true }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const excludeKey = excludeIds.join(',');

  useEffect(() => {
    let off = false;
    const t = setTimeout(async () => {
      setLoading(true);
      let query = supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .order('display_name')
        .limit(30);
      const s = cleanSearch(q);
      if (s) query = query.or(`username.ilike.%${s}%,display_name.ilike.%${s}%`);
      const { data } = await query;
      if (off) return;
      const ex = new Set(excludeKey ? excludeKey.split(',') : []);
      setResults((data || []).filter((p) => !ex.has(p.id)));
      setLoading(false);
    }, 250);
    return () => {
      off = true;
      clearTimeout(t);
    };
  }, [q, excludeKey]);

  return (
    <div className="picker">
      <label className="search">
        <Search size={18} aria-hidden="true" />
        <input
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or username"
          aria-label="Search people"
        />
      </label>
      <ul className="rows picker-list">
        {results.map((p) => {
          const selected = selectedIds.includes(p.id);
          return (
            <li key={p.id}>
              <button className="row" onClick={() => onPick(p)} aria-pressed={selected}>
                <Avatar profile={p} size={40} />
                <span className="row-main">
                  <strong>{p.display_name}</strong>
                  <span className="muted">@{p.username}</span>
                </span>
                {selected && <Check size={18} className="tick" aria-label="Selected" />}
              </button>
            </li>
          );
        })}
        {!loading && results.length === 0 && <li className="empty-inline">No one found. Try a different name.</li>}
        {loading && results.length === 0 && <li className="empty-inline">Searching…</li>}
      </ul>
    </div>
  );
}
