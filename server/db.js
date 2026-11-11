// Database layer.
//
// One SQL dialect (Postgres) everywhere, two drivers:
//   - DATABASE_URL set   -> real Postgres through `pg` (used in the deployed app)
//   - DATABASE_URL unset -> PGlite, Postgres compiled to WASM, running in-process
//                           (used for local dev and tests, so there is nothing to install)
//
// Both expose the same tiny interface: query(sql, params) -> { rows } and exec(sql).

import crypto from 'node:crypto';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  owner_id   INTEGER NOT NULL REFERENCES users(id),
  version    INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shares (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  role        TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, user_id)
);

CREATE INDEX IF NOT EXISTS documents_owner_idx ON documents(owner_id);
CREATE INDEX IF NOT EXISTS shares_user_idx ON shares(user_id);
`;

// Demo accounts. The password is shown on the login screen on purpose:
// this is a review build with mocked identities, not real auth.
export const DEMO_PASSWORD = 'demo1234';
export const DEMO_USERS = [
  { email: 'alice@ajaia.test', name: 'Alice Chen' },
  { email: 'bob@ajaia.test', name: 'Bob Okafor' },
  { email: 'carol@ajaia.test', name: 'Carol Diaz' },
];

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

const WELCOME_HTML = `
<h1>Welcome to Ajaia Docs</h1>
<p>This document is <strong>owned by Alice</strong> and <em>shared with Bob</em> as an editor, so you can see the sharing model working right away.</p>
<h2>Things to try</h2>
<ul>
  <li>Format text with the toolbar: <strong>bold</strong>, <em>italic</em>, <u>underline</u>, headings and lists.</li>
  <li>Rename the document by clicking its title.</li>
  <li>Open the Share dialog and give Carol view-only access.</li>
  <li>Sign in as Bob or Carol to see the "Shared with me" list.</li>
</ul>
<p>Changes save automatically about a second after you stop typing.</p>
`.trim();

async function seed(db) {
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n > 0) return;

  const ids = {};
  for (const u of DEMO_USERS) {
    const res = await db.query(
      'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [u.email, u.name, hashPassword(DEMO_PASSWORD)]
    );
    ids[u.email] = res.rows[0].id;
  }

  const docId = crypto.randomUUID();
  await db.query('INSERT INTO documents (id, title, content, owner_id) VALUES ($1, $2, $3, $4)', [
    docId,
    'Welcome to Ajaia Docs',
    WELCOME_HTML,
    ids['alice@ajaia.test'],
  ]);
  await db.query('INSERT INTO shares (document_id, user_id, role) VALUES ($1, $2, $3)', [
    docId,
    ids['bob@ajaia.test'],
    'editor',
  ]);
}

/**
 * @param {object} [options]
 * @param {string} [options.databaseUrl] Postgres connection string. If omitted, PGlite is used.
 * @param {string} [options.dataDir]     PGlite data directory. If omitted, the database is in-memory.
 */
export async function createDb({ databaseUrl, dataDir } = {}) {
  let db;

  if (databaseUrl) {
    const { default: pg } = await import('pg');
    const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl);
    const pool = new pg.Pool({
      connectionString: databaseUrl,
      ssl: isLocal || process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
      max: 5,
    });
    db = {
      driver: 'postgres',
      query: (sql, params = []) => pool.query(sql, params),
      exec: (sql) => pool.query(sql),
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const lite = new PGlite(dataDir);
    await lite.waitReady;
    db = {
      driver: dataDir ? 'pglite (file)' : 'pglite (memory)',
      query: (sql, params = []) => lite.query(sql, params),
      exec: (sql) => lite.exec(sql),
      close: () => lite.close(),
    };
  }

  await db.exec(SCHEMA);
  await seed(db);
  return db;
}
