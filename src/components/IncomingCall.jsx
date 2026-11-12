import { useEffect } from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { startRingtone } from '../lib/ringtone';
import Avatar from './Avatar';

export default function IncomingCall({ incoming, chat, caller, onAccept, onDecline, onExpire }) {
  useEffect(() => {
    const stop = startRingtone();
    const timer = setTimeout(onExpire, 45_000);
    return () => {
      stop();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isGroup = chat?.type === 'group';
  const who = caller?.display_name || 'Someone';
  const video = incoming.kind === 'video';

  return (
    <div className="incoming" role="alertdialog" aria-label={`Incoming ${video ? 'video' : 'voice'} call`}>
      <Avatar profile={isGroup ? null : caller} label={isGroup ? chat?.title : who} size={56} />
      <div className="incoming-text">
        <strong>{isGroup ? chat.title : who}</strong>
        <span>
          {isGroup ? `${who} started a ` : 'Incoming '}
          {video ? 'video' : 'voice'} call
        </span>
      </div>
      <button className="round danger" onClick={onDecline} aria-label="Decline call">
        <PhoneOff size={22} />
      </button>
      <button className="round ok" onClick={onAccept} aria-label="Accept call">
        {video ? <Video size={22} /> : <Phone size={22} />}
      </button>
    </div>
  );
}
