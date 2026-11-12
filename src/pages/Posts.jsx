import { useCallback, useEffect, useRef, useState } from 'react';
import { Heart, ImagePlus, Trash2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { extOf, fileKind, timeAgo, uid8, validateMedia } from '../lib/utils';
import Avatar from '../components/Avatar';
import { PublicMedia } from '../components/Media';

const SELECT = '*, author:profiles!user_id(id, username, display_name, avatar_url), post_likes(user_id)';

function PostCard({ post, me, onLike, onDelete }) {
  const liked = post.post_likes.some((l) => l.user_id === me);
  return (
    <article className="card post">
      <header className="post-head">
        <Avatar profile={post.author} size={42} />
        <div className="row-main">
          <strong>{post.author?.display_name}</strong>
          <span className="muted small">
            @{post.author?.username} <span className="sep" /> {timeAgo(post.created_at)}
          </span>
        </div>
        {post.user_id === me && (
          <button className="icon-btn" onClick={() => onDelete(post)} aria-label="Delete post">
            <Trash2 size={18} />
          </button>
        )}
      </header>
      {post.content && <p className="post-body">{post.content}</p>}
      {post.media_path && <PublicMedia path={post.media_path} type={post.media_type} />}
      <footer className="post-foot">
        <button className={`like ${liked ? 'on' : ''}`} onClick={() => onLike(post)} aria-pressed={liked} aria-label={liked ? 'Unlike' : 'Like'}>
          <Heart size={18} fill={liked ? 'currentColor' : 'none'} />
          <span>{post.post_likes.length}</span>
        </button>
      </footer>
    </article>
  );
}

export default function Posts() {
  const { user, profile } = useAuth();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('posts')
      .select(SELECT)
      .order('created_at', { ascending: false })
      .limit(60);
    if (error) setError(error.message);
    else setPosts(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`posts-feed-${uid8()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, async ({ new: row }) => {
        const { data } = await supabase.from('posts').select(SELECT).eq('id', row.id).maybeSingle();
        if (data) setPosts((p) => (p.some((x) => x.id === data.id) ? p : [data, ...p]));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'posts' }, ({ old }) => {
        setPosts((p) => p.filter((x) => x.id !== old.id));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'post_likes' }, ({ new: row }) => {
        setPosts((p) =>
          p.map((x) =>
            x.id === row.post_id && !x.post_likes.some((l) => l.user_id === row.user_id)
              ? { ...x, post_likes: [...x.post_likes, { user_id: row.user_id }] }
              : x
          )
        );
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'post_likes' }, ({ old }) => {
        setPosts((p) =>
          p.map((x) =>
            x.id === old.post_id ? { ...x, post_likes: x.post_likes.filter((l) => l.user_id !== old.user_id) } : x
          )
        );
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview({ url, kind: fileKind(file) });
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pickFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const problem = validateMedia(f);
    if (problem) return setError(problem);
    setError('');
    setFile(f);
  }

  async function publish(e) {
    e.preventDefault();
    const body = text.trim();
    if ((!body && !file) || posting) return;
    setPosting(true);
    setError('');
    let uploaded = null;
    try {
      let media_path = null;
      let media_type = null;
      if (file) {
        const path = `${user.id}/posts/${crypto.randomUUID()}.${extOf(file)}`;
        const { error: upErr } = await supabase.storage
          .from('public-media')
          .upload(path, file, { contentType: file.type, cacheControl: '31536000' });
        if (upErr) throw upErr;
        uploaded = path;
        media_path = path;
        media_type = fileKind(file);
      }
      const { data, error: insErr } = await supabase
        .from('posts')
        .insert({ user_id: user.id, content: body || null, media_path, media_type })
        .select(SELECT)
        .single();
      if (insErr) throw insErr;
      setPosts((p) => (p.some((x) => x.id === data.id) ? p : [data, ...p]));
      setText('');
      setFile(null);
    } catch (err) {
      if (uploaded) await supabase.storage.from('public-media').remove([uploaded]);
      setError(err.message || 'Your post was not published. Try again.');
    } finally {
      setPosting(false);
    }
  }

  async function like(post) {
    const liked = post.post_likes.some((l) => l.user_id === user.id);
    setPosts((p) =>
      p.map((x) =>
        x.id === post.id
          ? {
              ...x,
              post_likes: liked
                ? x.post_likes.filter((l) => l.user_id !== user.id)
                : [...x.post_likes, { user_id: user.id }],
            }
          : x
      )
    );
    const { error: e } = liked
      ? await supabase.from('post_likes').delete().match({ post_id: post.id, user_id: user.id })
      : await supabase.from('post_likes').insert({ post_id: post.id, user_id: user.id });
    if (e) load();
  }

  async function remove(post) {
    if (!window.confirm('Delete this post? This cannot be undone.')) return;
    const { error: e } = await supabase.from('posts').delete().eq('id', post.id);
    if (e) return setError(e.message);
    setPosts((p) => p.filter((x) => x.id !== post.id));
    if (post.media_path) await supabase.storage.from('public-media').remove([post.media_path]);
  }

  return (
    <div className="page narrow">
      <header className="page-head">
        <h1 className="display">Posts</h1>
        <p className="muted">Everything you share here is visible to everyone on iChat.</p>
      </header>

      <form className="card composer" onSubmit={publish}>
        <div className="composer-row">
          <Avatar profile={profile} size={42} />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What's on your mind?"
            maxLength={2000}
            rows={2}
            aria-label="Write a post"
          />
        </div>
        {preview && (
          <div className="attach-preview">
            {preview.kind === 'video' ? <video src={preview.url} controls playsInline /> : <img src={preview.url} alt="Selected attachment" />}
            <button type="button" className="icon-btn float" onClick={() => setFile(null)} aria-label="Remove attachment">
              <X size={18} />
            </button>
          </div>
        )}
        {error && <p className="error-banner" role="alert">{error}</p>}
        <div className="composer-actions">
          <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/gif,image/webp,image/avif,video/mp4,video/webm,video/quicktime" onChange={pickFile} />
          <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()}>
            <ImagePlus size={18} /> Photo or video
          </button>
          <button className="btn primary" disabled={posting || (!text.trim() && !file)}>
            {posting ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </form>

      {loading ? (
        <p className="empty-inline">Loading posts…</p>
      ) : posts.length === 0 ? (
        <p className="empty-block">No posts yet. Publish the first one above.</p>
      ) : (
        <div className="feed">
          {posts.map((p) => (
            <PostCard key={p.id} post={p} me={user.id} onLike={like} onDelete={remove} />
          ))}
        </div>
      )}
    </div>
  );
}
