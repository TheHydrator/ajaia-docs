# Submission: AI-Native Full Stack Developer Assignment

**Candidate:** Rohit Goutam Maity (maityrohit99@gmail.com)
**Project:** Ajaia Docs, a lightweight collaborative document editor

## Links

| Item | Link |
| --- | --- |
| Live app | `REPLACE_WITH_LIVE_URL` |
| Google Drive folder | `REPLACE_WITH_DRIVE_FOLDER_URL` |
| Walkthrough video (3 to 5 min) | `REPLACE_WITH_VIDEO_URL` |

The live app is on a free tier that sleeps when idle. The first load can take up to a minute.

## Test accounts

Click a name on the login screen, or sign in manually. Password for all three: `demo1234`

| User | Email | Starting state |
| --- | --- | --- |
| Alice Chen | `alice@ajaia.test` | Owns "Welcome to Ajaia Docs" |
| Bob Okafor | `bob@ajaia.test` | Can edit Alice's welcome document |
| Carol Diaz | `carol@ajaia.test` | Nothing owned or shared |

**Fastest way to review sharing (about 2 minutes):**

1. Sign in as **Alice**. The welcome document shows under "My documents" with an Owner badge.
2. Open it, click **Share**, choose Carol, leave "Can view", click Share.
3. Sign out, sign in as **Carol**. The document is under "Shared with me", marked "Can view", owned by Alice. Open it: no toolbar, read-only.
4. Sign in as **Bob**. The same document is marked "Can edit", and his edits save.

## What is in the Drive folder

| Path | What it is |
| --- | --- |
| `README.md` | Overview, demo accounts, local setup, tests, deployment |
| `ARCHITECTURE.md` | What I prioritized and why, data model, access rules, tradeoffs |
| `AI_WORKFLOW.md` | AI tools used, what was changed or rejected, how it was verified |
| `SUBMISSION.md` | This file |
| `VIDEO_URL.txt` | Walkthrough video link |
| `server/` | Express API, database layer, validation, file import |
| `client/` | React + TipTap frontend |
| `test/api.test.js` | 8 automated API tests |
| `samples/` | A `.md` and a `.txt` file for trying the importer |
| `screenshots/` | 8 screens: login, editor, share dialog, import, dashboards, view-only, conflict |
| `render.yaml` | Deployment blueprint (free web service + free Postgres) |
| `package.json`, `package-lock.json`, `vite.config.js`, `.env.example`, `.gitignore` | Project config |

`node_modules/`, `dist/` and `data/` are not included. They are recreated by `npm install`, `npm run build` and the first run.

## Run locally

Requires Node.js 20+. No database to install.

```bash
npm install
npm run build
npm start        # http://localhost:3001
npm test         # 8 tests
```

## Requirement coverage

| Requirement | Status | Notes |
| --- | --- | --- |
| Create a document | Working | "New document" on the dashboard |
| Rename a document | Working | Click the title in the editor. Enter or click away to save, Escape to cancel |
| Edit in the browser | Working | TipTap editor |
| Save and reopen | Working | Autosave with visible status. Ctrl/Cmd+S saves immediately |
| Bold, italic, underline | Working | Toolbar and keyboard shortcuts |
| Headings | Working | H1, H2, H3 and Normal |
| Bulleted and numbered lists | Working | |
| File upload | Working | `.txt`, `.md`, `.docx` up to 2 MB become a new document. Limits stated in the UI and README |
| Document owner | Working | Owner badge. Only the owner can share or delete |
| Grant another user access | Working | Share dialog, with view or edit access, change role, remove |
| Owned vs shared distinction | Working | Separate dashboard lists, role badges, owner name |
| Persistence | Working | Postgres. Survives refresh, restart and redeploy |
| Setup and run instructions | Done | README |
| Working deployment | Done | Link above |
| Validation and error handling | Working | Title, content size, file type and size, share input. Readable error messages throughout |
| Automated test | Done | 8 API tests, also run against real Postgres |
| Architecture note | Done | ARCHITECTURE.md |
| AI workflow note | Done | AI_WORKFLOW.md |
| Walkthrough video | Done | Link above |
| Stretch: role-based sharing | Working | Viewer and editor roles, enforced on the server |

## Scope decisions

**Went deep on**

- **Sharing that is enforced on the server.** One function decides access for every route. The test suite walks the full matrix: no access, viewer, editor, revoked.
- **Not losing work.** Autosave with status, a flush on navigation, and version checking so a stale save is rejected instead of overwriting someone else's edits.
- **Safe shared content.** All HTML is sanitized on the server before it is stored.

**Deliberately left out**

- Real-time co-editing and presence
- Sign-up, password reset, email invitations (identities are seeded)
- Comments, version history, export
- Importing into an existing document, images and tables from `.docx`

## Partial or incomplete

**Working:** everything in the table above.

**Incomplete:** simultaneous editing. Two people with edit access can both work on a document, but not at the same moment. If they do, the second person to save sees "This document was changed somewhere else", keeps their text on screen, and is asked to reload. Nothing is lost silently, but there is no merge.

**With another 2 to 4 hours I would build:**

1. Version history with restore, so a conflict can be resolved inside the app
2. A presence indicator showing who else has the document open
3. Export to Markdown or PDF
4. The browser test script added to the repo and run in CI
