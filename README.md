# Ajaia Docs

A lightweight collaborative document editor: create and format documents in the browser, import files as new documents, and share them with other users as view-only or editable.

Built for the Ajaia AI-Native Full Stack Developer assignment.

- **Live app:** https://ajaia-docs-hzw3.onrender.com
- **Walkthrough video:** see `VIDEO_URL.txt`
- **Architecture note:** [ARCHITECTURE.md](ARCHITECTURE.md)
- **AI workflow note:** [AI_WORKFLOW.md](AI_WORKFLOW.md)
- **Submission index:** [SUBMISSION.md](SUBMISSION.md)

> The live app runs on Render's free tier, which sleeps after 15 minutes without traffic. The first request after a sleep can take up to a minute. After that it is fast.

## Demo accounts

Identities are seeded so the sharing flow can be reviewed without signing up. The login screen lists the same accounts and signs you in with one click.

| Name | Email | Password | Starting state |
| --- | --- | --- | --- |
| Alice Chen | `alice@ajaia.test` | `demo1234` | Owns "Welcome to Ajaia Docs" |
| Bob Okafor | `bob@ajaia.test` | `demo1234` | Has edit access to Alice's welcome document |
| Carol Diaz | `carol@ajaia.test` | `demo1234` | Nothing owned, nothing shared |

To review sharing: sign in as Alice, open a document, click **Share**, give Carol access, then sign out and sign in as Carol. A second browser profile or a private window lets you keep both users open at once.

## What it does

| Area | Behavior |
| --- | --- |
| Documents | Create, rename (click the title), edit, autosave, reopen, delete (owner only) |
| Formatting | Bold, italic, underline, headings (H1 to H3), bulleted lists, numbered lists, undo and redo |
| File upload | Import a `.txt`, `.md` or `.docx` file (up to 2 MB) as a new editable document |
| Sharing | Owner grants access to another user as **Can view** or **Can edit**, changes the role, or removes access |
| Owned vs shared | Dashboard has separate "My documents" and "Shared with me" lists with role badges and the owner's name |
| Persistence | Postgres. Documents, formatting and shares survive refreshes, restarts and redeploys |
| Safety | All saved and imported HTML is sanitized on the server. Stale saves are rejected instead of overwriting newer work |

### Supported file types for import

Only **`.txt`**, **`.md`** and **`.docx`**, up to **2 MB**. This is stated next to the Import button, and anything else is rejected with a message that lists the supported types.

- `.txt`: blank lines become paragraph breaks, single line breaks are kept
- `.md`: headings, bold, italic, lists, links, quotes and code blocks are converted
- `.docx`: headings, bold, italic, underline and lists are converted. Images, tables, fonts and colors are dropped

Two sample files are in [`samples/`](samples/).

## Run it locally

Requirements: **Node.js 20 or newer**. Nothing else. There is no database to install: without a `DATABASE_URL`, the app uses an embedded Postgres (PGlite) that stores its data in `./data/pglite`.

```bash
npm install
npm run build
npm start
```

Open <http://localhost:3001> and click a demo account.

To reset local data, stop the server and delete the `data/` folder. The demo users and welcome document are re-created on the next start.

### Development mode (hot reload)

Run these in two terminals, then open <http://localhost:5173>:

```bash
npm run dev:server   # API on :3001, restarts on change
npm run dev:client   # Vite dev server on :5173, proxies /api to :3001
```

### Tests

```bash
npm test
```

Eight API tests run the real Express app against an in-memory Postgres. They cover auth, create/rename/save/reopen with formatting preserved, the full sharing matrix (no access, viewer, editor, revoke), stale-save conflicts, HTML sanitization, input validation and file import.

To run the same suite against a real Postgres (use an empty database):

```bash
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/ajaia_test npm test
```

### Environment variables

All optional locally. See [`.env.example`](.env.example).

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | Server port |
| `DATABASE_URL` | unset | Postgres connection string. Unset means embedded PGlite |
| `DATA_DIR` | `./data/pglite` | Where embedded PGlite stores data |
| `JWT_SECRET` | dev-only value | Signs session tokens. Must be set in any deployed environment |

## Deploy

The repo includes a Render Blueprint ([`render.yaml`](render.yaml)) that creates a free web service and a free Postgres database and wires them together. No paid service is needed.

1. Push this folder to a GitHub repository.
2. In Render: **New > Blueprint**, select the repository, click **Apply**.
3. Wait for the first deploy, then open the service URL.

Any other host works if it can run `npm install && npm run build` and then `npm start` with `DATABASE_URL` and `JWT_SECRET` set (for example a free Neon database with any Node host).

Render's free Postgres expires 30 days after it is created, which is fine for a review build.

## Project structure

```
server/
  index.js      Entry point: reads env, opens the database, starts Express
  app.js        All API routes, access control and error handling
  db.js         Schema, seed data, and the Postgres / PGlite driver switch
  content.js    Validation, HTML sanitization and file-to-HTML import
client/
  src/App.jsx                    Session handling and routes
  src/api.js                     Fetch wrapper with consistent errors
  src/pages/LoginPage.jsx        Demo account picker and manual sign-in
  src/pages/DashboardPage.jsx    Owned and shared lists, new document, import
  src/pages/EditorPage.jsx       TipTap editor, toolbar, rename, autosave, conflicts
  src/components/ShareDialog.jsx Grant, change and remove access
test/api.test.js                 API tests
samples/                         Files to try the importer with
screenshots/                     Screens from an automated browser run
render.yaml                      One-click deployment blueprint
```

## API summary

All routes except login require `Authorization: Bearer <token>`.

| Method and path | Who | Purpose |
| --- | --- | --- |
| `POST /api/auth/login` | anyone | Sign in, returns a token |
| `GET /api/documents` | signed in | `{ owned, shared }` lists |
| `POST /api/documents` | signed in | Create a document |
| `POST /api/documents/import` | signed in | Upload a file, creates a document |
| `GET /api/documents/:id` | owner, editor, viewer | Read a document |
| `PATCH /api/documents/:id` | owner, editor | Rename and/or save content |
| `DELETE /api/documents/:id` | owner | Delete |
| `GET /api/documents/:id/shares` | owner | List people with access |
| `PUT /api/documents/:id/shares` | owner | Grant access or change a role |
| `DELETE /api/documents/:id/shares/:userId` | owner | Remove access |

## Known limitations

- **No live co-editing.** Two people can edit the same document, but not at the same moment. The second person to save is told the document changed and is asked to reload. See the architecture note for why.
- **Mocked identities.** Three seeded accounts with a shared demo password. No sign-up, password reset or email invites.
- **Import creates a new document.** It does not merge into an existing one, and `.docx` images and tables are dropped.
- **No comments, version history or export.**

What I would build next is in [SUBMISSION.md](SUBMISSION.md).
