import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Splash from './Splash';

export default function ProtectedRoute({ children }) {
  const { session, loading, profileError, refreshProfile, signOut } = useAuth();
  if (loading) return <Splash />;
  if (!session) return <Navigate to="/auth" replace />;
  if (profileError) {
    return (
      <div className="splash">
        <h1 className="display">We could not load your profile</h1>
        <p className="muted">Check your connection, then try again.</p>
        <div className="btn-row">
          <button className="btn primary" onClick={refreshProfile}>Try again</button>
          <button className="btn ghost" onClick={signOut}>Log out</button>
        </div>
      </div>
    );
  }
  return children;
}
