import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useChats } from '../context/ChatsContext';
import Modal from './Modal';
import UserPicker from './UserPicker';

export default function NewGroupModal({ onClose }) {
  const { user } = useAuth();
  const { reload } = useChats();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (p) =>
    setPicked((cur) => (cur.some((x) => x.id === p.id) ? cur.filter((x) => x.id !== p.id) : [...cur, p]));

  async function create() {
    if (!name.trim()) return setError('Give the group a name.');
    if (picked.length < 1) return setError('Pick at least one person to add.');
    setBusy(true);
    setError('');
    const { data, error } = await supabase.rpc('create_group', {
      group_name: name.trim(),
      member_ids: picked.map((p) => p.id),
    });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    await reload();
    onClose();
    navigate(`/messages/${data}`);
  }

  return (
    <Modal title="Create a group" onClose={onClose}>
      <label className="field">
        <span>Group name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Weekend plans" />
      </label>
      {picked.length > 0 && (
        <p className="muted small">
          {picked.length} selected: {picked.map((p) => p.display_name).join(', ')}
        </p>
      )}
      {error && <p className="error-banner">{error}</p>}
      <UserPicker excludeIds={[user.id]} selectedIds={picked.map((p) => p.id)} onPick={toggle} autoFocus={false} />
      <button className="btn primary block" onClick={create} disabled={busy}>
        {busy ? 'Creating…' : 'Create group'}
      </button>
    </Modal>
  );
}
