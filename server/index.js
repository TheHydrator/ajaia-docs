import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3001;
const DATABASE_URL = process.env.DATABASE_URL || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data', 'pglite');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('WARNING: JWT_SECRET is not set. Using an insecure development secret.');
}

if (!DATABASE_URL) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = await createDb({ databaseUrl: DATABASE_URL || undefined, dataDir: DATA_DIR });
const app = createApp({ db, jwtSecret: JWT_SECRET });

app.listen(PORT, () => {
  console.log(`Ajaia Docs listening on http://localhost:${PORT} (database: ${db.driver})`);
});
