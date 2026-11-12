import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Home, MessageCircle, Newspaper, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useChats } from '../context/ChatsContext';
import Avatar from './Avatar';

export default function Layout() {
  const { profile } = useAuth();
  const { unreadCount } = useChats();
  const { pathname } = useLocation();
  const inMessages = pathname.startsWith('/messages');
  const inConversation = /^\/messages\/.+/.test(pathname);

  const links = [
    { to: '/', label: 'Home', icon: Home, end: true },
    { to: '/posts', label: 'Posts', icon: Newspaper },
    { to: '/messages', label: 'Messages', icon: MessageCircle, badge: unreadCount },
    { to: '/account', label: 'Account', icon: User },
  ];

  return (
    <div className={`app ${inConversation ? 'in-chat' : ''}`}>
      <nav className="nav" aria-label="Main">
        <NavLink to="/" className="brand" aria-label="iChat home">
          <span className="brand-mark">i</span>Chat
        </NavLink>
        <div className="nav-links">
          {links.map(({ to, label, icon: Icon, end, badge }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <span className="nav-icon">
                <Icon size={22} />
                {badge > 0 && <span className="badge" aria-label={`${badge} unread`}>{badge > 9 ? '9+' : badge}</span>}
              </span>
              <span className="nav-label">{label}</span>
            </NavLink>
          ))}
        </div>
        <NavLink to="/account" className="nav-me">
          <Avatar profile={profile} size={36} />
          <span className="row-main">
            <strong>{profile?.display_name}</strong>
            <span className="muted">@{profile?.username}</span>
          </span>
        </NavLink>
      </nav>
      <main className={`main ${inMessages ? 'flush' : ''}`}>
        <Outlet />
      </main>
    </div>
  );
}
