import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useChats } from '../context/ChatsContext';
import Modal from './Modal';
import Avatar from './Avatar';
import UserPicker from './UserPicker';

export default function GroupInfo({ chat, onClose }) {
  const { user } = useAuth();
  const { reload } = useChats();
  const navigate = useNavigate();
  const isAdmin = chat.members.find((m) => m.id === user.id)?.role === 'admin';
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function leave() {
    if (!window.confirm(`Leave "${chat.title}"? You will stop receiving its messages.`)) return;
    setBusy(true);
    const { error } = await supabase.from('chat_members').delete().match({ chat_id: chat.id, user_id: user.id });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    await reload();
    onClose();
    navigate('/messages');
  }

  async function addMembers() {
    if (!picked.length) return;
    setBusy(true);
    setError('');
    const { error } = await supabase.rpc('add_group_members', {
      _chat_id: chat.id,
      member_ids: picked.map((p) => p.id),
    });
    setBusy(false);
    if (error) return setError(error.message);
    await reload();
    setPicked([]);
    setAdding(false);
  }

  const toggle = (p) =>
    setPicked((cur) => (cur.some((x) => x.id === p.id) ? cur.filter((x) => x.id !== p.id) : [...cur, p]));

  return (
    <Modal title={chat.title} onClose={onClose}>
      {error && <p className="error-banner">{error}</p>}
      {adding ? (
        <>
          <UserPicker
            excludeIds={chat.members.map((m) => m.id)}
            selectedIds={picked.map((p) => p.id)}
            onPick={toggle}
          />
          <div className="btn-row">
            <button className="btn ghost" onClick={() => setAdding(false)}>Cancel</button>
            <button className="btn primary" onClick={addMembers} disabled={busy || !picked.length}>
              Add {picked.length || ''} {picked.length === 1 ? 'person' : 'people'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">{chat.members.length} members</p>
          <ul className="rows">
            {chat.members.map((m) => (
              <li key={m.id} className="row static">
                <Avatar profile={m} size={40} />
                <span className="row-main">
                  <strong>{m.display_name}{m.id === user.id ? ' (you)' : ''}</strong>
                  <span className="muted">@{m.username}</span>
                </span>
                {m.role === 'admin' && <span className="tag">Admin</span>}
              </li>
            ))}
          </ul>
          <div className="btn-row">
            {isAdmin && <button className="btn" onClick={() => setAdding(true)}>Add people</button>}
            <button className="btn danger" onClick={leave} disabled={busy}>Leave group</button>
          </div>
        </>
      )}
    </Modal>
  );
}
