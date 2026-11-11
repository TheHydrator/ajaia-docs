// API tests. These run the real Express app against an in-memory Postgres (PGlite),
// so they exercise the same SQL and access rules as production.
//
// Run with: npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createDb, DEMO_PASSWORD } from '../server/db.js';

let db;
let app;
const tokens = {};

async function login(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: DEMO_PASSWORD });
  assert.equal(res.status, 200);
  return res.body.token;
}

const as = (name) => ({ Authorization: `Bearer ${tokens[name]}` });

before(async () => {
  // In-memory by default. Set TEST_DATABASE_URL to run the same suite against a real (empty) Postgres.
  db = await createDb({ databaseUrl: process.env.TEST_DATABASE_URL || undefined });
  app = createApp({ db, jwtSecret: 'test-secret' });
  tokens.alice = await login('alice@ajaia.test');
  tokens.bob = await login('bob@ajaia.test');
  tokens.carol = await login('carol@ajaia.test');
});

after(async () => {
  await db.close();
});

test('requests without a valid session are rejected', async () => {
  assert.equal((await request(app).get('/api/documents')).status, 401);
  const bad = await request(app).post('/api/auth/login').send({ email: 'alice@ajaia.test', password: 'wrong' });
  assert.equal(bad.status, 401);
});

test('create, rename, save and reopen a document with formatting preserved', async () => {
  const created = await request(app).post('/api/documents').set(as('alice')).send({});
  assert.equal(created.status, 201);
  const { id, version } = created.body.document;
  assert.equal(created.body.document.title, 'Untitled document');
  assert.equal(created.body.document.role, 'owner');

  const html = '<h1>Plan</h1><p><strong>Bold</strong>, <em>italic</em>, <u>underline</u></p><ul><li><p>One</p></li></ul>';
  const saved = await request(app)
    .patch(`/api/documents/${id}`)
    .set(as('alice'))
    .send({ title: '  Q3 plan  ', content: html, baseVersion: version });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.document.title, 'Q3 plan');
  assert.equal(saved.body.document.version, version + 1);

  const reopened = await request(app).get(`/api/documents/${id}`).set(as('alice'));
  assert.equal(reopened.body.document.content, html);
});

test('sharing: no access by default, viewer can read but not write, editor can write', async () => {
  const created = await request(app).post('/api/documents').set(as('alice')).send({ title: 'Roadmap' });
  const { id } = created.body.document;

  // Bob has not been given access yet.
  assert.equal((await request(app).get(`/api/documents/${id}`).set(as('bob'))).status, 404);

  // Only the owner can share. Bob cannot grant himself access.
  const selfGrant = await request(app)
    .put(`/api/documents/${id}/shares`)
    .set(as('bob'))
    .send({ email: 'bob@ajaia.test', role: 'editor' });
  assert.equal(selfGrant.status, 404);

  // Alice shares with Bob as a viewer.
  const share = await request(app)
    .put(`/api/documents/${id}/shares`)
    .set(as('alice'))
    .send({ email: 'bob@ajaia.test', role: 'viewer' });
  assert.equal(share.status, 200);
  assert.deepEqual(
    share.body.shares.map((s) => [s.email, s.role]),
    [['bob@ajaia.test', 'viewer']]
  );

  // Bob can now read it, and it shows up under "shared", not "owned".
  const bobView = await request(app).get(`/api/documents/${id}`).set(as('bob'));
  assert.equal(bobView.status, 200);
  assert.equal(bobView.body.document.role, 'viewer');
  const bobList = await request(app).get('/api/documents').set(as('bob'));
  assert.ok(bobList.body.shared.some((d) => d.id === id && d.role === 'viewer' && d.ownerName === 'Alice Chen'));
  assert.ok(!bobList.body.owned.some((d) => d.id === id));

  // A viewer cannot edit, rename, re-share or delete.
  const { version } = bobView.body.document;
  const viewerEdit = await request(app)
    .patch(`/api/documents/${id}`)
    .set(as('bob'))
    .send({ content: '<p>hacked</p>', baseVersion: version });
  assert.equal(viewerEdit.status, 403);
  assert.equal((await request(app).patch(`/api/documents/${id}`).set(as('bob')).send({ title: 'x' })).status, 403);
  assert.equal((await request(app).delete(`/api/documents/${id}`).set(as('bob'))).status, 403);
  const reshare = await request(app)
    .put(`/api/documents/${id}/shares`)
    .set(as('bob'))
    .send({ email: 'carol@ajaia.test', role: 'viewer' });
  assert.equal(reshare.status, 403);

  // Upgrade Bob to editor: now he can save.
  await request(app).put(`/api/documents/${id}/shares`).set(as('alice')).send({ email: 'bob@ajaia.test', role: 'editor' });
  const editorEdit = await request(app)
    .patch(`/api/documents/${id}`)
    .set(as('bob'))
    .send({ content: '<p>Edited by Bob</p>', baseVersion: version });
  assert.equal(editorEdit.status, 200);

  // Carol was never involved and still has no access.
  assert.equal((await request(app).get(`/api/documents/${id}`).set(as('carol'))).status, 404);

  // Revoking access takes effect immediately.
  const bobId = share.body.shares[0].id;
  await request(app).delete(`/api/documents/${id}/shares/${bobId}`).set(as('alice'));
  assert.equal((await request(app).get(`/api/documents/${id}`).set(as('bob'))).status, 404);
});

test('a stale save is rejected with 409 instead of overwriting newer content', async () => {
  const created = await request(app).post('/api/documents').set(as('alice')).send({ title: 'Conflict' });
  const { id, version } = created.body.document;

  const first = await request(app)
    .patch(`/api/documents/${id}`)
    .set(as('alice'))
    .send({ content: '<p>first</p>', baseVersion: version });
  assert.equal(first.status, 200);

  const stale = await request(app)
    .patch(`/api/documents/${id}`)
    .set(as('alice'))
    .send({ content: '<p>stale</p>', baseVersion: version });
  assert.equal(stale.status, 409);

  const current = await request(app).get(`/api/documents/${id}`).set(as('alice'));
  assert.equal(current.body.document.content, '<p>first</p>');
});

test('saved content is sanitized: scripts and event handlers are stripped', async () => {
  const created = await request(app).post('/api/documents').set(as('alice')).send({});
  const { id, version } = created.body.document;
  const saved = await request(app)
    .patch(`/api/documents/${id}`)
    .set(as('alice'))
    .send({
      content: '<p onclick="steal()">Hi <strong>there</strong></p><script>alert(1)</script><a href="javascript:alert(1)">x</a>',
      baseVersion: version,
    });
  assert.equal(saved.status, 200);
  const { content } = saved.body.document;
  assert.ok(content.includes('<strong>there</strong>'));
  assert.ok(!content.includes('script'));
  assert.ok(!content.includes('onclick'));
  assert.ok(!content.includes('javascript:'));
});

test('validation: empty and oversized titles, missing baseVersion, bad share input', async () => {
  const created = await request(app).post('/api/documents').set(as('alice')).send({});
  const { id } = created.body.document;
  const patch = (body) => request(app).patch(`/api/documents/${id}`).set(as('alice')).send(body);

  assert.equal((await patch({ title: '   ' })).status, 400);
  assert.equal((await patch({ title: 'x'.repeat(201) })).status, 400);
  assert.equal((await patch({ content: '<p>no version</p>' })).status, 400);
  assert.equal((await patch({})).status, 400);

  const share = (body) => request(app).put(`/api/documents/${id}/shares`).set(as('alice')).send(body);
  assert.equal((await share({ email: 'nobody@ajaia.test' })).status, 404);
  assert.equal((await share({ email: 'bob@ajaia.test', role: 'admin' })).status, 400);
  assert.equal((await share({ email: 'alice@ajaia.test' })).status, 400);
});

test('file import: .md and .txt become editable documents, other types are rejected', async () => {
  const md = await request(app)
    .post('/api/documents/import')
    .set(as('alice'))
    .attach('file', Buffer.from('# Meeting notes\n\n- **Budget** approved\n- Ship on Friday\n'), 'meeting_notes.md');
  assert.equal(md.status, 201);
  assert.equal(md.body.document.title, 'meeting notes');
  assert.equal(md.body.document.role, 'owner');
  assert.match(md.body.document.content, /<h1>Meeting notes<\/h1>/);
  assert.match(md.body.document.content, /<li><strong>Budget<\/strong> approved<\/li>/);

  const txt = await request(app)
    .post('/api/documents/import')
    .set(as('alice'))
    .attach('file', Buffer.from('First paragraph\nsecond line\n\nUse <b> & stay safe'), 'notes.txt');
  assert.equal(txt.status, 201);
  assert.equal(txt.body.document.content, '<p>First paragraph<br />second line</p><p>Use &lt;b&gt; &amp; stay safe</p>');

  const exe = await request(app)
    .post('/api/documents/import')
    .set(as('alice'))
    .attach('file', Buffer.from('MZ'), 'virus.exe');
  assert.equal(exe.status, 415);
  assert.match(exe.body.error, /\.txt, \.md, \.docx/);

  const fakeDocx = await request(app)
    .post('/api/documents/import')
    .set(as('alice'))
    .attach('file', Buffer.from('not a zip'), 'broken.docx');
  assert.equal(fakeDocx.status, 400);

  const tooBig = await request(app)
    .post('/api/documents/import')
    .set(as('alice'))
    .attach('file', Buffer.alloc(2 * 1024 * 1024 + 1, 'a'), 'big.txt');
  assert.equal(tooBig.status, 413);

  assert.equal((await request(app).post('/api/documents/import').set(as('alice'))).status, 400);
});

test('only the owner can delete, and deleting removes access for everyone', async () => {
  const created = await request(app).post('/api/documents').set(as('alice')).send({ title: 'Temp' });
  const { id } = created.body.document;
  await request(app).put(`/api/documents/${id}/shares`).set(as('alice')).send({ email: 'bob@ajaia.test', role: 'editor' });

  assert.equal((await request(app).delete(`/api/documents/${id}`).set(as('bob'))).status, 403);
  assert.equal((await request(app).delete(`/api/documents/${id}`).set(as('alice'))).status, 204);
  assert.equal((await request(app).get(`/api/documents/${id}`).set(as('bob'))).status, 404);
});
