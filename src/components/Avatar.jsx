import { initials } from '../lib/utils';

const HUES = [252, 200, 160, 28, 330, 12, 280, 120];

function hueFor(id = '') {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

export default function Avatar({ profile, size = 40, label }) {
  const name = label || profile?.display_name || profile?.username || '?';
  const style = { width: size, height: size, fontSize: Math.max(12, size * 0.38) };
  if (profile?.avatar_url) {
    return <img className="avatar" style={style} src={profile.avatar_url} alt="" loading="lazy" />;
  }
  const hue = hueFor(profile?.id || name);
  return (
    <span
      className="avatar avatar-fallback"
      style={{ ...style, background: `hsl(${hue} 70% 92%)`, color: `hsl(${hue} 55% 30%)` }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
