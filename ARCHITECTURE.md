# Architecture note

## Summary

One Node service serves both the JSON API and the built React app, backed by Postgres. The editor is TipTap. Documents are stored as sanitized HTML. Access is decided in one server function and enforced on every route.

The brief asks for depth in a few areas over shallow coverage. I put the depth into three things a reviewer will actually exercise:

1. **An editing flow that feels trustworthy:** formatting that survives a save and reload, autosave with a visible status, and no silent data loss.
2. **Sharing logic that is correct on the server,** not only hidden in the UI.
3. **A deployment that keeps its data,** so the sharing flow can be tested days later.

## Stack and why

| Choice | Why | What I gave up |
| --- | --- | --- |
| React + Vite | Fast to build, small surface, matches the role | No server rendering, which this app does not need |
| TipTap (ProseMirror) | Reliable rich text with a real document model. Hand-rolling `contenteditable` is where editors go wrong | A 680 kB bundle, acceptable for an internal tool |
| Express, one service | The API and static files deploy as one unit with one URL and no CORS setup | Not independently scalable, irrelevant at this size |
| Postgres | Free hosted Postgres is persistent. A SQLite file on a free host is wiped on every restart | A little more setup than a file |
| PGlite for local and tests | Embedded Postgres in WASM. `npm install` is the whole local setup, and tests run the same SQL as production | One extra dependency |
| Seeded users + JWT | The brief allows mocked auth. Real sign-up would cost an hour and show nothing about documents | No account management |

### Why not SQLite

It was the first idea because it is the least setup. It fails the deployment requirement: free web hosts have ephemeral disks, so a reviewer's documents would vanish when the service sleeps. Postgres in production and PGlite locally keeps a single SQL dialect and a zero-install local run.

## Data model

```
users      (id, email, name, password_hash)
documents  (id, title, content, owner_id -> users, version, created_at, updated_at)
shares     (document_id -> documents, user_id -> users, role 'viewer'|'editor')
           primary key (document_id, user_id), deleted with the document
```

The owner is a column on the document, not a row in `shares`. A document always has exactly one owner, and that cannot be removed by editing shares.

## Access control

`loadDocument(docId, userId)` in `server/app.js` is the only place a role is computed. It returns `owner`, `editor` or `viewer`, or throws.

| Action | Owner | Editor | Viewer | No access |
| --- | --- | --- | --- | --- |
| Read | yes | yes | yes | 404 |
| Edit content, rename | yes | yes | 403 | 404 |
| Share, change roles, remove access | yes | 403 | 403 | 404 |
| Delete | yes | 403 | 403 | 404 |

People without access get 404, not 403, so document ids cannot be probed. The UI hides controls a user cannot use (viewers get no toolbar and a read-only editor), but that is convenience. The server rejects the request either way, and the tests assert this directly against the API.

## Saving and conflicts

The editor autosaves 800 ms after the last keystroke and shows "Saving…", "All changes saved" or an error with a Retry button. Leaving the page flushes pending changes, and closing the tab with unsaved work triggers the browser warning.

Every content save sends the `version` the client last loaded. The update runs as:

```sql
UPDATE documents SET content = ..., version = version + 1
 WHERE id = ... AND version = <the version the client saw>
```

If someone else saved in between, no row matches and the API returns 409. The editor stops autosaving, keeps the user's text on screen so it can be copied, and offers "Reload latest".

This is the main tradeoff in the project. Real-time co-editing (CRDTs or operational transforms over websockets) is the feature people associate with Google Docs, and it is not achievable to a trustworthy standard in this timebox. The dangerous failure of a shared editor without it is last-write-wins, where one person's work silently disappears. Version checking removes that failure for the cost of one integer column. It is honest about what the product does: shared access, not simultaneous editing.

## Content format and safety

Content is stored as HTML because both ends already speak it: TipTap reads and writes HTML, and Markdown and Word files convert to HTML. That keeps import to a single conversion step.

Because shared documents render one user's content in another user's browser, stored HTML is a cross-site scripting risk. Every write path (create, save, import) goes through one sanitizer with an allow-list of formatting tags. Scripts, event handlers, styles and `javascript:` links are stripped before anything is stored. There is a test for this.

## File upload

Upload means "turn a file into a new document". It is the most product-relevant of the options in the brief because it gets existing work into the tool. Supported types are `.txt`, `.md` and `.docx`, capped at 2 MB, checked in the browser for a fast message and again on the server by extension and by actually parsing the file. Files are held in memory, converted, sanitized and discarded. Nothing is written to disk, so there is no file storage to manage or clean up.

## Validation and errors

- Titles: trimmed, 1 to 200 characters. Content: 1 MB limit. Uploads: 2 MB limit and type check.
- Every API error is JSON with a sentence a user can read. The client shows that message as-is.
- An expired session signs the user out instead of failing silently.

## What I deliberately left out

| Left out | Reason |
| --- | --- |
| Real-time co-editing and presence | Too large to do well here. Conflict detection covers the data-loss risk |
| Sign-up, password reset, email invites | Allowed to mock. Not what the brief evaluates |
| Comments, version history, export | Stretch items. I chose one stretch (viewer and editor roles) because it deepens sharing, which is core |
| Import into an existing document, images, tables | Each adds edge cases. One clean import path is better than three partial ones |
| Search, folders, pagination | Not needed at demo scale |
| Rate limiting, CSRF hardening, audit logs | Needed before real use. Tokens are sent in a header, not a cookie, so CSRF does not apply today |

## With another 2 to 4 hours

1. **Version history:** keep a snapshot on each save and allow restore. The `version` column is already there, and it would make conflict recovery friendlier than "copy and reload".
2. **Presence indicator:** show who else has the document open, to warn people before they collide.
3. **Export to Markdown or PDF**, so documents can leave the tool.
4. **Browser tests in CI:** the automated browser run used during development should live in the repo and run on every push.
