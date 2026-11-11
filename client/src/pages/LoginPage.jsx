import { useState } from 'react';
import { api } from '../api.js';

// Seeded demo accounts. Identities are mocked for this review build, so the
// credentials are shown here on purpose to make the sharing flow easy to test.
const DEMO_PASSWORD = 'demo1234';
const DEMO_USERS = [
  { email: 'alice@ajaia.test', name: 'Alice Chen', note: 'Owns the welcome document' },
  { email: 'bob@ajaia.test', name: 'Bob Okafor', note: 'Has edit access to the welcome document' },
  { email: 'carol@ajaia.test', name: 'Carol Diaz', note: 'Starts with nothing shared' },
];

export default function LoginPage({ onSignIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn(nextEmail, nextPassword) {
    setError('');
    setBusy(true);
    try {
      onSignIn(await api('/auth/login', { method: 'POST', body: { email: nextEmail, password: nextPassword } }));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <div className="login-card">
        <h1>
          <span className="brand-mark">A</span> Ajaia Docs
        </h1>
        <p className="muted">A lightweight collaborative document editor.</p>

        <h2>Demo accounts</h2>
        <p className="muted small">Click one to sign in. Use two different accounts to try sharing.</p>
        <div className="demo-users">
          {DEMO_USERS.map((u) => (
            <button key={u.email} className="demo-user" disabled={busy} onClick={() => signIn(u.email, DEMO_PASSWORD)}>
              <span className="avatar">{u.name[0]}</span>
              <span>
                <strong>{u.name}</strong>
                <span className="muted small block">{u.email}</span>
                <span className="muted small block">{u.note}</span>
              </span>
            </button>
          ))}
        </div>

        <h2>Or sign in manually</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            signIn(email, password);
          }}
        >
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="alice@ajaia.test" required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={DEMO_PASSWORD} required />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="muted small">
          Password for every demo account: <code>{DEMO_PASSWORD}</code>
        </p>
      </div>
    </main>
  );
}
