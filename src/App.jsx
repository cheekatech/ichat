import { Navigate, Route, Routes } from 'react-router-dom';
import { isConfigured } from './lib/supabase';
import { AuthProvider } from './context/AuthContext';
import { ChatsProvider } from './context/ChatsContext';
import { CallProvider } from './context/CallContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Auth from './pages/Auth';
import Home from './pages/Home';
import Posts from './pages/Posts';
import Messages from './pages/Messages';
import Account from './pages/Account';

function ConfigMissing() {
  return (
    <div className="splash">
      <h1 className="display">iChat is not connected to Supabase yet</h1>
      <p className="muted">
        Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your environment (see README), then rebuild.
      </p>
    </div>
  );
}

export default function App() {
  if (!isConfigured) return <ConfigMissing />;
  return (
    <AuthProvider>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route
          element={
            <ProtectedRoute>
              <ChatsProvider>
                <CallProvider>
                  <Layout />
                </CallProvider>
              </ChatsProvider>
            </ProtectedRoute>
          }
        >
          <Route index element={<Home />} />
          <Route path="posts" element={<Posts />} />
          <Route path="messages/:chatId?" element={<Messages />} />
          <Route path="account" element={<Account />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
