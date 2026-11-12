import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { uid8 } from '../lib/utils';
import { useAuth } from './AuthContext';

const Ctx = createContext(null);
export const useChats = () => useContext(Ctx);

export function ChatsProvider({ children }) {
  const { user } = useAuth();
  const uid = user?.id;
  const [raw, setRaw] = useState([]);
  const [previews, setPreviews] = useState({});
  const [reads, setReads] = useState({});
  const [loading, setLoading] = useState(true);
  const knownRef = useRef(new Set());

  const load = useCallback(async () => {
    if (!uid) return;
    const [mem, prev] = await Promise.all([
      supabase
        .from('chat_members')
        .select(
          'last_read_at, chats(id, type, name, created_by, created_at, chat_members(user_id, role, profiles(id, username, display_name, avatar_url)))'
        )
        .eq('user_id', uid),
      supabase.rpc('my_chat_previews'),
    ]);
    if (mem.error) {
      console.error('Could not load chats', mem.error);
      setLoading(false);
      return;
    }
    const chats = [];
    const rd = {};
    for (const row of mem.data || []) {
      const c = row.chats;
      if (!c) continue;
      rd[c.id] = row.last_read_at;
      chats.push({
        id: c.id,
        type: c.type,
        name: c.name,
        createdBy: c.created_by,
        createdAt: c.created_at,
        members: (c.chat_members || [])
          .filter((m) => m.profiles)
          .map((m) => ({ ...m.profiles, role: m.role })),
      });
    }
    const pv = {};
    for (const m of prev.data || []) pv[m.chat_id] = m;
    knownRef.current = new Set(chats.map((c) => c.id));
    setRaw(chats);
    setReads(rd);
    setPreviews(pv);
    setLoading(false);
  }, [uid]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!uid) return;
    const ch = supabase
      .channel(`chats-${uid}-${uid8()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: m }) => {
        setPreviews((p) => ({ ...p, [m.chat_id]: m }));
        if (!knownRef.current.has(m.chat_id)) load();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_members' }, () => load())
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_members' }, () => load())
      .subscribe();

    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(ch);
    };
  }, [uid, load]);

  const markRead = useCallback(async (chatId) => {
    const { data, error } = await supabase.rpc('mark_chat_read', { _chat_id: chatId });
    if (!error && data) setReads((r) => ({ ...r, [chatId]: data }));
  }, []);

  const chats = useMemo(() => {
    return raw
      .map((c) => {
        const other = c.type === 'direct' ? c.members.find((m) => m.id !== uid) || c.members[0] : null;
        const last = previews[c.id] || null;
        const readAt = reads[c.id] ? Date.parse(reads[c.id]) : 0;
        const unread = Boolean(last) && last.sender_id !== uid && Date.parse(last.created_at) > readAt;
        return {
          ...c,
          other,
          last,
          unread,
          title: c.type === 'group' ? c.name || 'Group' : other?.display_name || 'Unknown user',
          sortKey: Date.parse(last?.created_at || c.createdAt),
        };
      })
      .sort((a, b) => b.sortKey - a.sortKey);
  }, [raw, previews, reads, uid]);

  const unreadCount = useMemo(() => chats.filter((c) => c.unread).length, [chats]);

  return (
    <Ctx.Provider value={{ chats, loading, reload: load, markRead, unreadCount }}>{children}</Ctx.Provider>
  );
}
