import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ImagePlus, Info, MessageSquarePlus, Phone, Search, Send, Trash2, UsersRound, Video, X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useChats } from '../context/ChatsContext';
import { useCall } from '../context/CallContext';
import { clockTime, dayLabel, extOf, fileKind, timeAgo, uid8, validateMedia } from '../lib/utils';
import Avatar from '../components/Avatar';
import { ChatMedia } from '../components/Media';
import NewChatModal from '../components/NewChatModal';
import NewGroupModal from '../components/NewGroupModal';
import GroupInfo from '../components/GroupInfo';
import Splash from '../components/Splash';

function previewText(chat, myId) {
  const m = chat.last;
  if (!m) return 'No messages yet';
  if (m.kind !== 'text') return m.content || 'Call';
  const prefix = m.sender_id === myId ? 'You: ' : '';
  if (m.content) return prefix + m.content;
  return prefix + (m.media_type === 'video' ? 'Sent a video' : 'Sent a photo');
}

function mergeMsgs(a, b) {
  const map = new Map();
  [...a, ...b].forEach((m) => map.set(m.id, m));
  return [...map.values()].sort((x, y) => Date.parse(x.created_at) - Date.parse(y.created_at));
}

export default function Messages() {
  const { chatId } = useParams();
  const { chats, loading } = useChats();
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null); // 'dm' | 'group'

  const active = chats.find((c) => c.id === chatId);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? chats.filter((c) => c.title.toLowerCase().includes(s)) : chats;
  }, [chats, q]);

  return (
    <div className={`msgs ${chatId ? 'has-chat' : ''}`}>
      <aside className="msgs-list" aria-label="Conversations">
        <header className="msgs-head">
          <h1 className="display">Messages</h1>
          <div className="btn-row tight">
            <button className="icon-btn filled" onClick={() => setModal('dm')} aria-label="New message">
              <MessageSquarePlus size={20} />
            </button>
            <button className="icon-btn filled" onClick={() => setModal('group')} aria-label="New group">
              <UsersRound size={20} />
            </button>
          </div>
        </header>
        <label className="search">
          <Search size={18} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" aria-label="Search chats" />
        </label>
        <ul className="rows scroll">
          {list.map((c) => (
            <li key={c.id}>
              <Link className={`row ${c.id === chatId ? 'current' : ''}`} to={`/messages/${c.id}`}>
                <Avatar profile={c.type === 'group' ? null : c.other} label={c.title} size={46} />
                <span className="row-main">
                  <span className="row-top">
                    <strong className={c.unread ? 'unread' : ''}>{c.title}</strong>
                    {c.last && <span className="muted small">{timeAgo(c.last.created_at)}</span>}
                  </span>
                  <span className="clamp muted">{previewText(c, user.id)}</span>
                </span>
                {c.unread && <span className="dot" aria-label="Unread messages" />}
              </Link>
            </li>
          ))}
          {!loading && chats.length === 0 && (
            <li className="empty-inline">No conversations yet. Start a new message or create a group.</li>
          )}
          {!loading && chats.length > 0 && list.length === 0 && <li className="empty-inline">No chats match your search.</li>}
        </ul>
      </aside>

      <section className="msgs-pane">
        {active ? (
          <Conversation key={active.id} chat={active} />
        ) : chatId && loading ? (
          <Splash text="Opening chat" />
        ) : chatId ? (
          <div className="pane-empty">
            <h2 className="display">Chat not found</h2>
            <p className="muted">It may have been removed, or you are no longer a member.</p>
            <Link className="btn" to="/messages">Back to messages</Link>
          </div>
        ) : (
          <div className="pane-empty">
            <h2 className="display">Pick a conversation</h2>
            <p className="muted">Send a private message, or create a group to talk with several people at once.</p>
            <div className="btn-row">
              <button className="btn primary" onClick={() => setModal('dm')}>New message</button>
              <button className="btn" onClick={() => setModal('group')}>New group</button>
            </div>
          </div>
        )}
      </section>

      {modal === 'dm' && <NewChatModal onClose={() => setModal(null)} />}
      {modal === 'group' && <NewGroupModal onClose={() => setModal(null)} />}
    </div>
  );
}

function Conversation({ chat }) {
  const { user } = useAuth();
  const { markRead } = useChats();
  const { startCall, joinCall, active: callActive } = useCall();
  const navigate = useNavigate();
  const [msgs, setMsgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState(false);
  const bottomRef = useRef(null);
  const fileRef = useRef(null);
  const firstScroll = useRef(true);

  const members = useMemo(() => Object.fromEntries(chat.members.map((m) => [m.id, m])), [chat.members]);
  const isGroup = chat.type === 'group';

  useEffect(() => {
    let off = false;
    const ch = supabase
      .channel(`chat-${chat.id}-${uid8()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chat.id}` },
        ({ new: m }) => {
          setMsgs((p) => mergeMsgs(p, [m]));
          if (m.sender_id !== user.id) markRead(chat.id);
        }
      )
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, ({ old }) => {
        setMsgs((p) => p.filter((x) => x.id !== old.id));
      })
      .subscribe();

    (async () => {
      const { data, error: e } = await supabase
        .from('messages')
        .select('*')
        .eq('chat_id', chat.id)
        .order('created_at', { ascending: false })
        .limit(150);
      if (off) return;
      if (e) setError(e.message);
      else setMsgs((p) => mergeMsgs(p, (data || []).reverse()));
      setLoading(false);
      markRead(chat.id);
    })();

    return () => {
      off = true;
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: firstScroll.current ? 'auto' : 'smooth', block: 'end' });
    if (msgs.length) firstScroll.current = false;
  }, [msgs.length]);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview({ url, kind: fileKind(file) });
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const endedCalls = useMemo(
    () => new Set(msgs.filter((m) => m.kind === 'call_end').map((m) => m.call_id)),
    [msgs]
  );
  const canJoin = (m) =>
    m.kind === 'call_start' &&
    !callActive &&
    !endedCalls.has(m.call_id) &&
    Date.now() - Date.parse(m.created_at) < 30 * 60 * 1000;

  function pickFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const problem = validateMedia(f);
    if (problem) return setError(problem);
    setError('');
    setFile(f);
  }

  async function send(e) {
    e?.preventDefault();
    const body = text.trim();
    if ((!body && !file) || sending) return;
    setSending(true);
    setError('');
    let uploaded = null;
    try {
      let media_path = null;
      let media_type = null;
      if (file) {
        const path = `${chat.id}/${crypto.randomUUID()}.${extOf(file)}`;
        const { error: upErr } = await supabase.storage
          .from('chat-media')
          .upload(path, file, { contentType: file.type, cacheControl: '3600' });
        if (upErr) throw upErr;
        uploaded = path;
        media_path = path;
        media_type = fileKind(file);
      }
      const { data, error: insErr } = await supabase
        .from('messages')
        .insert({ chat_id: chat.id, sender_id: user.id, content: body || null, media_path, media_type })
        .select()
        .single();
      if (insErr) throw insErr;
      setMsgs((p) => mergeMsgs(p, [data]));
      setText('');
      setFile(null);
    } catch (err) {
      if (uploaded) await supabase.storage.from('chat-media').remove([uploaded]);
      setError(err.message || 'Message not sent. Try again.');
    } finally {
      setSending(false);
    }
  }

  async function removeMessage(m) {
    if (!window.confirm('Delete this message for everyone?')) return;
    const { error: e } = await supabase.from('messages').delete().eq('id', m.id);
    if (e) return setError(e.message);
    setMsgs((p) => p.filter((x) => x.id !== m.id));
    if (m.media_path) await supabase.storage.from('chat-media').remove([m.media_path]);
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  const autosize = (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
  };

  let lastDay = '';

  return (
    <div className="convo">
      <header className="convo-head">
        <button className="icon-btn back" onClick={() => navigate('/messages')} aria-label="Back to conversations">
          <ArrowLeft size={22} />
        </button>
        <Avatar profile={isGroup ? null : chat.other} label={chat.title} size={42} />
        <div className="row-main">
          <strong>{chat.title}</strong>
          <span className="muted small">
            {isGroup ? `${chat.members.length} members` : `@${chat.other?.username ?? ''}`}
          </span>
        </div>
        <div className="btn-row tight">
          <button className="icon-btn" onClick={() => startCall(chat, 'audio')} disabled={Boolean(callActive)} aria-label="Start voice call">
            <Phone size={20} />
          </button>
          <button className="icon-btn" onClick={() => startCall(chat, 'video')} disabled={Boolean(callActive)} aria-label="Start video call">
            <Video size={20} />
          </button>
          {isGroup && (
            <button className="icon-btn" onClick={() => setInfo(true)} aria-label="Group info">
              <Info size={20} />
            </button>
          )}
        </div>
      </header>

      <div className="thread" role="log" aria-live="polite">
        {loading && <p className="empty-inline">Loading messages…</p>}
        {!loading && msgs.length === 0 && <p className="empty-inline">No messages yet. Say hello.</p>}
        {msgs.map((m) => {
          const day = dayLabel(m.created_at);
          const showDay = day !== lastDay;
          lastDay = day;
          const mine = m.sender_id === user.id;
          const sender = members[m.sender_id];
          return (
            <div key={m.id}>
              {showDay && <div className="day"><span>{day}</span></div>}
              {m.kind !== 'text' ? (
                <div className="sys">
                  <span>
                    {m.kind === 'call_start'
                      ? `${mine ? 'You' : sender?.display_name || 'Someone'} started a ${m.call_media === 'video' ? 'video' : 'voice'} call`
                      : m.content}
                  </span>
                  <span className="muted small">{clockTime(m.created_at)}</span>
                  {canJoin(m) && (
                    <button className="btn small" onClick={() => joinCall({ callId: m.call_id, chatId: chat.id, kind: m.call_media || 'audio' })}>
                      Join call
                    </button>
                  )}
                </div>
              ) : (
                <div className={`msg ${mine ? 'mine' : ''}`}>
                  <div className="bubble-wrap">
                    {isGroup && !mine && <span className="msg-from">{sender?.display_name || 'Former member'}</span>}
                    <div className={`bubble ${mine ? 'out' : 'in'}`}>
                      {m.media_path && <ChatMedia path={m.media_path} type={m.media_type} />}
                      {m.content && <p>{m.content}</p>}
                      <span className="stamp">{clockTime(m.created_at)}</span>
                    </div>
                  </div>
                  {mine && (
                    <button className="icon-btn tiny" onClick={() => removeMessage(m)} aria-label="Delete message">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form className="compose" onSubmit={send}>
        {preview && (
          <div className="attach-preview small">
            {preview.kind === 'video' ? <video src={preview.url} playsInline /> : <img src={preview.url} alt="Selected attachment" />}
            <button type="button" className="icon-btn float" onClick={() => setFile(null)} aria-label="Remove attachment">
              <X size={16} />
            </button>
          </div>
        )}
        {error && <p className="error-banner" role="alert">{error}</p>}
        <div className="compose-row">
          <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/gif,image/webp,image/avif,video/mp4,video/webm,video/quicktime" onChange={pickFile} />
          <button type="button" className="icon-btn" onClick={() => fileRef.current?.click()} aria-label="Attach photo or video">
            <ImagePlus size={22} />
          </button>
          <textarea
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onInput={autosize}
            onKeyDown={onKeyDown}
            placeholder="Write a message"
            maxLength={4000}
            aria-label="Message"
          />
          <button className="icon-btn send" disabled={sending || (!text.trim() && !file)} aria-label="Send message">
            <Send size={20} />
          </button>
        </div>
      </form>

      {info && <GroupInfo chat={chat} onClose={() => setInfo(false)} />}
    </div>
  );
}
