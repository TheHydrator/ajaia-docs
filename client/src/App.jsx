import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api, clearToken, getToken, setToken, setUnauthorizedHandler } from './api.js';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import EditorPage from './pages/EditorPage.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(getToken()));
  const navigate = useNavigate();

  const signOut = useCallback(() => {
    clearToken();
    setUser(null);
    navigate('/login');
  }, [navigate]);

  // Restore the session on load, and sign out everywhere if the API ever says 401.
  useEffect(() => {
    setUnauthorizedHandler(signOut);
    if (!getToken()) return;
    api('/me')
      .then((data) => setUser(data.user))
      .catch(() => clearToken())
      .finally(() => setChecking(false));
  }, [signOut]);

  const signIn = ({ token, user: profile }) => {
    setToken(token);
    setUser(profile);
    navigate('/');
  };

  if (checking) return <div className="center-note">Loading…</div>;

  return (
    <div className="app">
      {user && (
        <header className="topbar">
          <Link to="/" className="brand">
            <span className="brand-mark">A</span> Ajaia Docs
          </Link>
          <div className="topbar-user">
            <span className="avatar" title={user.email}>
              {user.name[0]}
            </span>
            <span className="topbar-name">{user.name}</span>
            <button className="btn btn-ghost" onClick={signOut}>
              Sign out
            </button>
          </div>
        </header>
      )}
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage onSignIn={signIn} />} />
        <Route path="/" element={user ? <DashboardPage user={user} /> : <Navigate to="/login" replace />} />
        <Route path="/d/:id" element={user ? <EditorPage user={user} /> : <Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
