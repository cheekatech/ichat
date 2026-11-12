import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export function PublicMedia({ path, type }) {
  const url = supabase.storage.from('public-media').getPublicUrl(path).data.publicUrl;
  if (type === 'video') {
    return <video className="media" src={url} controls preload="metadata" playsInline />;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img className="media" src={url} alt="Attached to post" loading="lazy" />
    </a>
  );
}

const cache = new Map();

async function signedUrl(path) {
  const hit = cache.get(path);
  if (hit && hit.exp > Date.now() + 60_000) return hit.url;
  const { data, error } = await supabase.storage.from('chat-media').createSignedUrl(path, 3600);
  if (error) throw error;
  cache.set(path, { url: data.signedUrl, exp: Date.now() + 3600_000 });
  return data.signedUrl;
}

export function ChatMedia({ path, type }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let off = false;
    signedUrl(path)
      .then((u) => !off && setUrl(u))
      .catch(() => !off && setFailed(true));
    return () => {
      off = true;
    };
  }, [path]);

  if (failed) return <div className="media-missing">Media unavailable</div>;
  if (!url) return <div className="media-skeleton" />;
  if (type === 'video') return <video className="media" src={url} controls preload="metadata" playsInline />;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img className="media" src={url} alt="Shared in chat" />
    </a>
  );
}
