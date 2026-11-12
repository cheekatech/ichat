import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useChats } from '../context/ChatsContext';
import Modal from './Modal';
import UserPicker from './UserPicker';

export default function NewChatModal({ onClose }) {
  const { user } = useAuth();
  const { reload } = useChats();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function pick(p) {
    if (busy) return;
    setBusy(true);
    setError('');
    const { data, error } = await supabase.rpc('get_or_create_direct_chat', { other_user: p.id });
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
    <Modal title="New message" onClose={onClose}>
      {error && <p className="error-banner">{error}</p>}
      <UserPicker excludeIds={[user.id]} onPick={pick} />
    </Modal>
  );
}
