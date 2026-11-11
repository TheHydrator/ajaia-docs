// HTTP API. createApp() takes its dependencies as arguments so tests can run the
// real app against an in-memory database without starting a server.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { verifyPassword } from './db.js';
import {
  HttpError,
  MAX_UPLOAD_BYTES,
  SUPPORTED_EXTENSIONS,
  cleanTitle,
  importFile,
  sanitizeContent,
} from './content.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'dist');
const SHARE_ROLES = ['viewer', 'editor'];

export function createApp({ db, jwtSecret }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  });

  // ---------- helpers ----------

  function requireAuth(req, _res, next) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'Please sign in.');
    try {
      const payload = jwt.verify(token, jwtSecret);
      req.user = { id: payload.sub, email: payload.email, name: payload.name };
    } catch {
      throw new HttpError(401, 'Your session has expired. Please sign in again.');
    }
    next();
  }

  /**
   * The single place access is decided. Returns { doc, role } where role is
   * 'owner' | 'editor' | 'viewer', or throws 404.
   *
   * No access and "does not exist" both return 404 so that document ids
   * cannot be probed by people who were never given access.
   */
  async function loadDocument(docId, userId) {
    const { rows } = await db.query(
      `SELECT d.*, u.name AS owner_name, u.email AS owner_email, s.role AS share_role
         FROM documents d
         JOIN users u ON u.id = d.owner_id
         LEFT JOIN shares s ON s.document_id = d.id AND s.user_id = $2
        WHERE d.id = $1`,
      [docId, userId]
    );
    const doc = rows[0];
    const role = !doc ? null : doc.owner_id === userId ? 'owner' : doc.share_role;
    if (!role) throw new HttpError(404, 'Document not found, or you do not have access to it.');
    return { doc, role };
  }

  function requireRole(role, allowed, message) {
    if (!allowed.includes(role)) throw new HttpError(403, message);
  }

  function toDocument(doc, role) {
    return {
      id: doc.id,
      title: doc.title,
      content: doc.content,
      version: doc.version,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
      owner: { id: doc.owner_id, name: doc.owner_name, email: doc.owner_email },
      role,
    };
  }

  async function listShares(docId) {
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.email, s.role
         FROM shares s JOIN users u ON u.id = s.user_id
        WHERE s.document_id = $1
        ORDER BY u.name`,
      [docId]
    );
    return rows;
  }

  // ---------- auth ----------

  app.get('/api/health', (_req, res) => res.json({ ok: true, database: db.driver }));

  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      throw new HttpError(400, 'Email and password are required.');
    }
    const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'Incorrect email or password.');
    }
    const profile = { id: user.id, email: user.email, name: user.name };
    const token = jwt.sign({ sub: user.id, email: user.email, name: user.name }, jwtSecret, { expiresIn: '7d' });
    res.json({ token, user: profile });
  });

  app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.user }));

  // People you can share with (everyone except yourself).
  app.get('/api/users', requireAuth, async (req, res) => {
    const { rows } = await db.query('SELECT id, name, email FROM users WHERE id <> $1 ORDER BY name', [req.user.id]);
    res.json({ users: rows });
  });

  // ---------- documents ----------

  app.get('/api/documents', requireAuth, async (req, res) => {
    const owned = await db.query(
      `SELECT d.id, d.title, d.updated_at AS "updatedAt",
              (SELECT COUNT(*)::int FROM shares s WHERE s.document_id = d.id) AS "sharedWithCount"
         FROM documents d
        WHERE d.owner_id = $1
        ORDER BY d.updated_at DESC`,
      [req.user.id]
    );
    const shared = await db.query(
      `SELECT d.id, d.title, d.updated_at AS "updatedAt", s.role,
              u.name AS "ownerName", u.email AS "ownerEmail"
         FROM shares s
         JOIN documents d ON d.id = s.document_id
         JOIN users u ON u.id = d.owner_id
        WHERE s.user_id = $1
        ORDER BY d.updated_at DESC`,
      [req.user.id]
    );
    res.json({ owned: owned.rows, shared: shared.rows });
  });

  async function insertDocument({ title, content, ownerId }) {
    const id = crypto.randomUUID();
    await db.query('INSERT INTO documents (id, title, content, owner_id) VALUES ($1, $2, $3, $4)', [
      id,
      title,
      content,
      ownerId,
    ]);
    return loadDocument(id, ownerId);
  }

  app.post('/api/documents', requireAuth, async (req, res) => {
    const body = req.body || {};
    const title = body.title === undefined ? 'Untitled document' : cleanTitle(body.title);
    const content = body.content === undefined ? '' : sanitizeContent(body.content);
    const { doc, role } = await insertDocument({ title, content, ownerId: req.user.id });
    res.status(201).json({ document: toDocument(doc, role) });
  });

  // File upload: a .txt, .md or .docx file becomes a new editable document owned by the uploader.
  app.post('/api/documents/import', requireAuth, upload.single('file'), async (req, res) => {
    if (!req.file) {
      throw new HttpError(400, `Choose a file to import. Supported types: ${SUPPORTED_EXTENSIONS.join(', ')}.`);
    }
    const { title, content } = await importFile(req.file);
    const { doc, role } = await insertDocument({ title, content, ownerId: req.user.id });
    res.status(201).json({ document: toDocument(doc, role) });
  });

  app.get('/api/documents/:id', requireAuth, async (req, res) => {
    const { doc, role } = await loadDocument(req.params.id, req.user.id);
    res.json({ document: toDocument(doc, role) });
  });

  // Rename and/or save content. Owners and editors only.
  //
  // Content saves carry the version the client last saw (baseVersion). The UPDATE only
  // succeeds if that is still the current version, so two people editing the same
  // document cannot silently overwrite each other: the second save gets a 409.
  app.patch('/api/documents/:id', requireAuth, async (req, res) => {
    const { doc, role } = await loadDocument(req.params.id, req.user.id);
    requireRole(role, ['owner', 'editor'], 'You have view-only access to this document.');

    const body = req.body || {};
    const hasTitle = body.title !== undefined;
    const hasContent = body.content !== undefined;
    if (!hasTitle && !hasContent) throw new HttpError(400, 'Nothing to update. Send a title or content.');

    const title = hasTitle ? cleanTitle(body.title) : doc.title;

    if (hasContent) {
      if (!Number.isInteger(body.baseVersion)) {
        throw new HttpError(400, 'baseVersion (integer) is required when saving content.');
      }
      const content = sanitizeContent(body.content);
      const result = await db.query(
        `UPDATE documents
            SET title = $1, content = $2, version = version + 1, updated_at = now()
          WHERE id = $3 AND version = $4
        RETURNING id`,
        [title, content, doc.id, body.baseVersion]
      );
      if (result.rows.length === 0) {
        throw new HttpError(409, 'This document was changed somewhere else since you opened it.', {
          currentVersion: doc.version,
        });
      }
    } else {
      await db.query('UPDATE documents SET title = $1, updated_at = now() WHERE id = $2', [title, doc.id]);
    }

    const fresh = await loadDocument(doc.id, req.user.id);
    res.json({ document: toDocument(fresh.doc, fresh.role) });
  });

  app.delete('/api/documents/:id', requireAuth, async (req, res) => {
    const { doc, role } = await loadDocument(req.params.id, req.user.id);
    requireRole(role, ['owner'], 'Only the owner can delete this document.');
    await db.query('DELETE FROM documents WHERE id = $1', [doc.id]);
    res.status(204).end();
  });

  // ---------- sharing (owner only) ----------

  app.get('/api/documents/:id/shares', requireAuth, async (req, res) => {
    const { doc, role } = await loadDocument(req.params.id, req.user.id);
    requireRole(role, ['owner'], 'Only the owner can see who this document is shared with.');
    res.json({ shares: await listShares(doc.id) });
  });

  // Grant access, or change the role of someone who already has it.
  app.put('/api/documents/:id/shares', requireAuth, async (req, res) => {
    const { doc, role } = await loadDocument(req.params.id, req.user.id);
    requireRole(role, ['owner'], 'Only the owner can share this document.');

    const { email, role: shareRole = 'viewer' } = req.body || {};
    if (typeof email !== 'string' || !email.trim()) throw new HttpError(400, 'Enter the email of the person to share with.');
    if (!SHARE_ROLES.includes(shareRole)) throw new HttpError(400, 'Role must be "viewer" or "editor".');

    const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    const target = rows[0];
    if (!target) throw new HttpError(404, `No user found with the email ${email.trim()}.`);
    if (target.id === doc.owner_id) throw new HttpError(400, 'You already own this document.');

    await db.query(
      `INSERT INTO shares (document_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (document_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [doc.id, target.id, shareRole]
    );
    res.json({ shares: await listShares(doc.id) });
  });

  app.delete('/api/documents/:id/shares/:userId', requireAuth, async (req, res) => {
    const { doc, role } = await loadDocument(req.params.id, req.user.id);
    requireRole(role, ['owner'], 'Only the owner can change sharing.');
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId)) throw new HttpError(400, 'Invalid user id.');
    await db.query('DELETE FROM shares WHERE document_id = $1 AND user_id = $2', [doc.id, userId]);
    res.json({ shares: await listShares(doc.id) });
  });

  // ---------- static frontend + errors ----------

  app.use('/api', (_req, _res) => {
    throw new HttpError(404, 'Unknown API route.');
  });

  if (fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    app.use(express.static(DIST_DIR));
    // Single-page app fallback: any other GET returns index.html so deep links survive a refresh.
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(DIST_DIR, 'index.html'));
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...err.extra });
    }
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `That file is too large. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`
          : 'Upload failed. Please send a single file in the "file" field.';
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: message });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'This document is too large to save.' });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Request body is not valid JSON.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  });

  return app;
}
