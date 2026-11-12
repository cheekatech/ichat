import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

// Note: React.StrictMode is intentionally not used. Its double-mount in dev
// conflicts with Supabase Realtime channels that must keep exact topic names (call rooms).
ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
    <App />
  </BrowserRouter>
);
