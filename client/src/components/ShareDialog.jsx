import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Owner-only dialog: grant access, change a role, or remove someone.
export default function ShareDialog({ documentId, documentTitle, onClose }) {
  const [users, setUsers] = useState([]);
  const [shares, setShares] = useState(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api('/users'), api(`/documents/${documentId}/shares`)])
      .then(([u, s]) => {
        setUsers(u.users);
        setShares(s.shares);
      })
      .catch((err) => setError(err.message));
  }, [documentId]);

  useEffect(() => {
    const onKeyDown = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const sharedIds = new Set((shares || []).map((s) => s.id));
  const available = users.filter((u) => !sharedIds.has(u.id));

  async function run(action) {
    setError('');
    setBusy(true);
    try {
      const data = await action();
      setShares(data.shares);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const grant = (e) => {
    e.preventDefault();
    if (!email) {
      setError('Choose a person to share with.');
      return;
    }
    run(async () => {
      const data = await api(`/documents/${documentId}/shares`, { method: 'PUT', body: { email, role } });
      setEmail('');
      return data;
    });
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Share ${documentTitle}`}>
        <div className="modal-head">
          <h2>Share "{documentTitle}"</h2>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <form className="share-form" onSubmit={grant}>
          <select value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Person">
            <option value="">{available.length ? 'Choose a person…' : 'Everyone already has access'}</option>
            {available.map((u) => (
              <option key={u.id} value={u.email}>
                {u.name} ({u.email})
              </option>
            ))}
          </select>
          <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Access level">
            <option value="viewer">Can view</option>
            <option value="editor">Can edit</option>
          </select>
          <button className="btn btn-primary" disabled={busy || !available.length}>
            Share
          </button>
        </form>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <h3>People with access</h3>
        <ul className="share-list">
          <li>
            <span>You</span>
            <span className="badge badge-owner">Owner</span>
          </li>
          {shares === null && !error && <li className="muted">Loading…</li>}
          {shares?.map((s) => (
            <li key={s.id}>
              <span>
                {s.name} <span className="muted small">{s.email}</span>
              </span>
              <span className="share-controls">
                <select
                  value={s.role}
                  disabled={busy}
                  aria-label={`Access level for ${s.name}`}
                  onChange={(e) =>
                    run(() => api(`/documents/${documentId}/shares`, { method: 'PUT', body: { email: s.email, role: e.target.value } }))
                  }
                >
                  <option value="viewer">Can view</option>
                  <option value="editor">Can edit</option>
                </select>
                <button
                  className="btn btn-ghost btn-danger"
                  disabled={busy}
                  onClick={() => run(() => api(`/documents/${documentId}/shares/${s.id}`, { method: 'DELETE' }))}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
        {shares?.length === 0 && <p className="muted small">Only you can see this document right now.</p>}
      </div>
    </div>
  );
}
