import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useChats } from '../context/ChatsContext';
import { greeting, timeAgo } from '../lib/utils';
import Avatar from '../components/Avatar';

function previewText(chat, myId) {
  const m = chat.last;
  if (!m) return 'No messages yet';
  const prefix = m.sender_id === myId ? 'You: ' : '';
  if (m.kind !== 'text') return m.content || 'Call';
  if (m.content) return prefix + m.content;
  return prefix + (m.media_type === 'video' ? 'Sent a video' : 'Sent a photo');
}

export default function Home() {
  const { profile } = useAuth();
  const { chats } = useChats();
  const [posts, setPosts] = useState([]);
  const [people, setPeople] = useState(null);

  useEffect(() => {
    let off = false;
    (async () => {
      const [p, c] = await Promise.all([
        supabase
          .from('posts')
          .select('id, content, media_type, created_at, author:profiles!user_id(id, display_name, username, avatar_url)')
          .order('created_at', { ascending: false })
          .limit(4),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
      ]);
      if (off) return;
      setPosts(p.data || []);
      setPeople(c.count ?? null);
    })();
    return () => {
      off = true;
    };
  }, []);

  const first = (profile?.display_name || '').split(' ')[0];

  return (
    <div className="page">
      <header className="home-hero">
        <h1 className="display huge">
          {greeting()}, {first}.
        </h1>
        <p className="muted lead">
          {people ? `${people} ${people === 1 ? 'person is' : 'people are'} on iChat.` : 'Catch up with your people.'}
        </p>
        <div className="btn-row">
          <Link className="btn primary" to="/posts">Write a post</Link>
          <Link className="btn" to="/messages">Open messages</Link>
        </div>
      </header>

      <div className="home-grid">
        <section className="card">
          <header className="card-head">
            <h2>From the feed</h2>
            <Link className="link" to="/posts">See all posts</Link>
          </header>
          {posts.length === 0 ? (
            <p className="empty-inline">Nothing posted yet. Be the first to share something.</p>
          ) : (
            <ul className="rows">
              {posts.map((p) => (
                <li key={p.id} className="row static top">
                  <Avatar profile={p.author} size={36} />
                  <span className="row-main">
                    <strong>{p.author?.display_name}</strong>
                    <span className="clamp">
                      {p.content || (p.media_type === 'video' ? 'Shared a video' : 'Shared a photo')}
                    </span>
                    <span className="muted small">{timeAgo(p.created_at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <header className="card-head">
            <h2>Recent chats</h2>
            <Link className="link" to="/messages">All messages</Link>
          </header>
          {chats.length === 0 ? (
            <p className="empty-inline">No chats yet. Start one from Messages.</p>
          ) : (
            <ul className="rows">
              {chats.slice(0, 5).map((c) => (
                <li key={c.id}>
                  <Link className="row" to={`/messages/${c.id}`}>
                    <Avatar profile={c.type === 'group' ? null : c.other} label={c.title} size={36} />
                    <span className="row-main">
                      <strong>{c.title}</strong>
                      <span className="clamp muted">{previewText(c, profile.id)}</span>
                    </span>
                    {c.unread && <span className="dot" aria-label="Unread messages" />}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
