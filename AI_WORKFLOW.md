# AI workflow note

## Tools used

- **Claude (Anthropic), in the Claude app, working as a coding agent.** It had a sandbox where it could install packages, run the server, run tests and drive a real browser. It wrote the large majority of the code and the first drafts of these documents.
- No other AI tools.

I want to be direct about the split: Claude did most of the typing. My part was giving it the brief and constraints, deciding what stayed in scope, reviewing what came back, deploying, and checking the result by hand.

## How the work was broken down

1. **Scope first.** Before any code, the brief was reduced to a short list of what must work end to end (edit, save, reopen, import, share, deploy) and what would be cut (live co-editing, comments, history, export, real sign-up).
2. **Server before UI.** Database, access rules and API were written and tested first, so the hardest logic to get right was covered by tests before any screen depended on it.
3. **UI second,** against the working API.
4. **Verification third:** API tests, then a scripted browser run of the full user flow, then manual review.
5. **Documents last,** written from what was actually built.

## Where AI materially sped things up

- **Boilerplate and wiring:** Express routes, the React pages, CSS, and the Render blueprint. This is hours of work by hand and minutes with AI.
- **Test writing:** the sharing test walks the whole permission matrix (no access, viewer, editor, revoked). Writing that many cases by hand is the kind of thing that gets skipped under time pressure.
- **Library knowledge:** converting `.docx` with mammoth, Markdown with marked, sanitizing with sanitize-html, and TipTap setup, without reading four sets of docs.
- **Browser verification:** Claude scripted a headless Chrome run (sign in, create, format, reload, share, import, switch users, force a conflict) and produced the screenshots in `screenshots/`.

## AI output that was changed or rejected

| What the AI first produced or proposed | What happened | Why |
| --- | --- | --- |
| SQLite as the database | Rejected for Postgres plus embedded PGlite | Free hosts wipe local disk on restart. The app would have looked like it lost documents. Checked against Render's own docs before deciding |
| Installed `@tiptap/extension-underline` as a separate package | Removed | TipTap v3's StarterKit already includes underline. The AI's habit came from v2. Keeping both registers the extension twice |
| Toolbar buttons reading `editor.isActive()` directly during render | Replaced with `useEditorState` | TipTap v3 no longer re-renders React on every keystroke, so the Bold button would not have lit up when the cursor moved into bold text |
| `npm test` script as `node --test test/` | Changed to `node --test test/*.test.js` | The first version failed on Node 22 with "Cannot find module". Caught by running it, not by reading it |
| Plain last-write-wins saving | Replaced with a version check that returns 409 | With sharing, last-write-wins means one editor silently erases another's work |
| Returning 403 for documents the user has no access to | Changed to 404 | 403 confirms the document exists, which leaks information to people who were never invited |
| Trusting HTML from the editor | Added server-side sanitization on every write path | Shared documents render one user's HTML in another user's browser |
| Browser test selectors | Fixed three times | The script failed on an aria-label mismatch and on text that matched two elements. The app was right and the test was wrong, which is why a failing test gets read before the code gets changed |

## How correctness was verified

**Automated**

- `npm test`: 8 API tests against in-memory Postgres, all passing.
- The same 8 tests against a real Postgres 16 server, all passing. This matters because production uses a different driver (`pg`) than local development (PGlite).
- A scripted run in real Chrome covering the main flow for three users, including the view-only state and the conflict state. It also failed the run on any unexpected browser console error.
- A real `.docx` file generated with headings, bold, italic and bullets, imported, and the stored HTML inspected.
- Server restarted mid-session to confirm documents persisted on disk.

**By hand, on the deployed app, before submitting**

- [x] Signed in as each of the three demo users
- [x] Created, renamed and formatted a document, refreshed, confirmed nothing was lost
- [x] Imported `samples/meeting-notes.md` and a `.docx` of my own
- [x] Tried an unsupported file and confirmed the error message is clear
- [x] Shared as view-only, confirmed the other user cannot edit, upgraded to edit, confirmed they can
- [x] Removed access and confirmed the document disappears for the other user
- [x] Opened the same document in two tabs and confirmed the second save is blocked with a clear message
- [x] Ran the app locally with `npm install`, `npm run build` and `npm start` and confirmed it works

**UX quality**

Checked from screenshots of each screen and from using the deployed app: empty states have instructions, every error is a readable sentence, the save status is always visible, and controls a user cannot use are not shown.

## What I would not delegate

- **Scope cuts.** The AI will happily build everything on the stretch list. Deciding that live co-editing was out and conflict detection was in is a product call.
- **Security review of access rules.** These were tested against the API directly by the automated tests and checked by hand with three users, not assumed correct because the UI hides the buttons.
- **Claims in these documents.** Anything stated here as verified was actually run.
