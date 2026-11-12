import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fmtDuration, uid8 } from '../lib/utils';
import { useAuth } from './AuthContext';
import { useChats } from './ChatsContext';
import CallRoom from '../components/CallRoom';
import IncomingCall from '../components/IncomingCall';

const Ctx = createContext(null);
export const useCall = () => useContext(Ctx);

export function CallProvider({ children }) {
  const { user, profile } = useAuth();
  const { chats } = useChats();
  const [active, setActive] = useState(null);
  const [incoming, setIncoming] = useState(null);

  const activeRef = useRef(null);
  activeRef.current = active;
  const chatsRef = useRef(chats);
  chatsRef.current = chats;

  // Incoming calls arrive as "call_start" messages (delivered by Realtime, protected by RLS).
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`calls-${user.id}-${uid8()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: m }) => {
        if (m.kind === 'call_start' && m.sender_id !== user.id) {
          if (activeRef.current) return; // already in a call
          setIncoming({ callId: m.call_id, chatId: m.chat_id, fromId: m.sender_id, kind: m.call_media || 'audio' });
        } else if (m.kind === 'call_end') {
          setIncoming((cur) => (cur && cur.callId === m.call_id ? null : cur));
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user?.id]);

  const startCall = useCallback(
    async (chat, kind) => {
      if (activeRef.current || !user) return;
      const callId = crypto.randomUUID();
      setActive({ callId, chatId: chat.id, kind, title: chat.title, direct: chat.type === 'direct', caller: true });
      const { error } = await supabase.from('messages').insert({
        chat_id: chat.id,
        sender_id: user.id,
        kind: 'call_start',
        call_id: callId,
        call_media: kind,
        content: kind === 'video' ? 'Video call' : 'Voice call',
      });
      if (error) console.error('Could not announce call', error);
    },
    [user]
  );

  const joinCall = useCallback(({ callId, chatId, kind }) => {
    if (activeRef.current) return;
    const chat = chatsRef.current.find((c) => c.id === chatId);
    setIncoming(null);
    setActive({
      callId,
      chatId,
      kind,
      title: chat?.title || 'Call',
      direct: chat ? chat.type === 'direct' : true,
      caller: false,
    });
  }, []);

  const decline = useCallback(() => {
    const inc = incoming;
    setIncoming(null);
    if (!inc || !user) return;
    // Tell the caller through the private call room, then leave it.
    const ch = supabase.channel(`call:${inc.chatId}:${inc.callId}`, { config: { private: true } });
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        Promise.resolve(ch.send({ type: 'broadcast', event: 'signal', payload: { type: 'decline', from: user.id } }))
          .catch(() => {})
          .then(() => supabase.removeChannel(ch));
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        supabase.removeChannel(ch);
      }
    });
  }, [incoming, user]);

  const leave = useCallback(
    async (info) => {
      const a = activeRef.current;
      setActive(null);
      if (!a || !user || !info?.alone) return;
      if (!a.caller && !info.connectedOnce) return;
      let content;
      if (info.declined) content = 'Call declined';
      else if (info.connectedOnce) content = `Call ended · ${fmtDuration(info.duration || 0)}`;
      else content = 'Missed call';
      const { error } = await supabase.from('messages').insert({
        chat_id: a.chatId,
        sender_id: user.id,
        kind: 'call_end',
        call_id: a.callId,
        call_media: a.kind,
        content,
      });
      if (error) console.error('Could not log call end', error);
    },
    [user]
  );

  const activeChat = active ? chats.find((c) => c.id === active.chatId) : null;
  const incChat = incoming ? chats.find((c) => c.id === incoming.chatId) : null;

  return (
    <Ctx.Provider value={{ active, startCall, joinCall }}>
      {children}
      {active && profile && (
        <CallRoom key={active.callId} call={active} me={profile} members={activeChat?.members || []} onLeave={leave} />
      )}
      {incoming && !active && (
        <IncomingCall
          incoming={incoming}
          chat={incChat}
          caller={incChat?.members.find((m) => m.id === incoming.fromId)}
          onAccept={() => joinCall(incoming)}
          onDecline={decline}
          onExpire={() => setIncoming(null)}
        />
      )}
    </Ctx.Provider>
  );
}
