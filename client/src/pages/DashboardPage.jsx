import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';

const ROLE_LABEL = { viewer: 'Can view', editor: 'Can edit' };
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const SUPPORTED = ['.txt', '.md', '.docx'];

function formatDate(value) {
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function DashboardPage() {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const fileInput = useRef(null);
  const navigate = useNavigate();

  async function load() {
    try {
      setDocs(await api('/documents'));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createDocument() {
    setError('');
    setBusy('create');
    try {
      const { document } = await api('/documents', { method: 'POST', body: {} });
      navigate(`/d/${document.id}`);
    } catch (err) {
      setError(err.message);
      setBusy('');
    }
  }

  async function importFile(event) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow picking the same file again
    if (!file) return;
    setError('');

    // Check on the client first for a fast, clear message. The server checks again.
    const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : '';
    if (!SUPPORTED.includes(ext)) {
      setError(`"${file.name}" is not a supported file type. Supported types: ${SUPPORTED.join(', ')}.`);
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`"${file.name}" is too large. The limit is 2 MB.`);
      return;
    }

    setBusy('import');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { document } = await api('/documents/import', { method: 'POST', formData });
      navigate(`/d/${document.id}`);
    } catch (err) {
      setError(err.message);
      setBusy('');
    }
  }

  async function deleteDocument(doc) {
    if (!window.confirm(`Delete "${doc.title}"? This cannot be undone, and anyone it is shared with will lose access.`)) return;
    setError('');
    try {
      await api(`/documents/${doc.id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="dashboard">
      <div className="dashboard-actions">
        <button className="btn btn-primary" onClick={createDocument} disabled={Boolean(busy)}>
          {busy === 'create' ? 'Creating…' : '+ New document'}
        </button>
        <button className="btn" onClick={() => fileInput.current?.click()} disabled={Boolean(busy)}>
          {busy === 'import' ? 'Importing…' : 'Import file'}
        </button>
        <input ref={fileInput} type="file" accept=".txt,.md,.docx" hidden onChange={importFile} data-testid="import-input" />
        <span className="muted small">
          Import turns a <strong>.txt</strong>, <strong>.md</strong> or <strong>.docx</strong> file (up to 2 MB) into a new editable document.
        </span>
      </div>

      {error && (
        <p className="error banner" role="alert">
          {error}
        </p>
      )}

      {!docs && !error && <p className="muted">Loading documents…</p>}

      {docs && (
        <>
          <section>
            <h2>
              My documents <span className="count">{docs.owned.length}</span>
            </h2>
            {docs.owned.length === 0 ? (
              <p className="empty">You have not created any documents yet. Start with "New document" or import a file.</p>
            ) : (
              <ul className="doc-list">
                {docs.owned.map((doc) => (
                  <li key={doc.id} className="doc-row">
                    <Link to={`/d/${doc.id}`} className="doc-link">
                      <span className="doc-title">{doc.title}</span>
                      <span className="doc-meta">
                        <span className="badge badge-owner">Owner</span>
                        {doc.sharedWithCount > 0 && (
                          <span className="badge">
                            Shared with {doc.sharedWithCount} {doc.sharedWithCount === 1 ? 'person' : 'people'}
                          </span>
                        )}
                        <span className="muted small">Edited {formatDate(doc.updatedAt)}</span>
                      </span>
                    </Link>
                    <button className="btn btn-ghost btn-danger" onClick={() => deleteDocument(doc)} aria-label={`Delete ${doc.title}`}>
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2>
              Shared with me <span className="count">{docs.shared.length}</span>
            </h2>
            {docs.shared.length === 0 ? (
              <p className="empty">Nothing has been shared with you yet.</p>
            ) : (
              <ul className="doc-list">
                {docs.shared.map((doc) => (
                  <li key={doc.id} className="doc-row">
                    <Link to={`/d/${doc.id}`} className="doc-link">
                      <span className="doc-title">{doc.title}</span>
                      <span className="doc-meta">
                        <span className={`badge badge-${doc.role}`}>{ROLE_LABEL[doc.role]}</span>
                        <span className="muted small">Owned by {doc.ownerName}</span>
                        <span className="muted small">Edited {formatDate(doc.updatedAt)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
