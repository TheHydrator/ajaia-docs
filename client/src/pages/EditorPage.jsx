import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { api } from '../api.js';
import ShareDialog from '../components/ShareDialog.jsx';

const AUTOSAVE_DELAY_MS = 800;

const STATUS_TEXT = {
  saved: 'All changes saved',
  unsaved: 'Unsaved changes…',
  saving: 'Saving…',
  error: 'Could not save',
  conflict: 'Out of date',
};

export default function EditorPage({ user }) {
  const { id } = useParams();
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setError('');
    api(`/documents/${id}`)
      .then((data) => !cancelled && setDoc(data.document))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <main className="center-note">
        <p className="error">{error}</p>
        <Link to="/" className="btn">
          Back to documents
        </Link>
      </main>
    );
  }
  if (!doc) return <main className="center-note">Opening document…</main>;

  // key forces a fresh editor (and fresh save state) per document.
  return <DocumentEditor key={doc.id} initial={doc} user={user} />;
}

function DocumentEditor({ initial }) {
  const canEdit = initial.role === 'owner' || initial.role === 'editor';
  const isOwner = initial.role === 'owner';

  const [title, setTitle] = useState(initial.title);
  const [savedTitle, setSavedTitle] = useState(initial.title);
  const [titleError, setTitleError] = useState('');
  const [status, setStatus] = useState('saved');
  const [saveError, setSaveError] = useState('');
  const [shareOpen, setShareOpen] = useState(false);

  // Save state lives in refs so the debounced save always sees current values.
  const versionRef = useRef(initial.version);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const blockedRef = useRef(false); // set after a conflict: stop autosaving
  const timerRef = useRef(null);
  const editorRef = useRef(null);

  const save = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || savingRef.current || !dirtyRef.current || blockedRef.current) return;
    savingRef.current = true;
    dirtyRef.current = false;
    setStatus('saving');
    setSaveError('');
    let retry = false;
    try {
      const { document } = await api(`/documents/${initial.id}`, {
        method: 'PATCH',
        body: { content: editor.getHTML(), baseVersion: versionRef.current },
      });
      versionRef.current = document.version;
      // If the user kept typing while the request was in flight, save again.
      retry = dirtyRef.current;
      setStatus(retry ? 'unsaved' : 'saved');
    } catch (err) {
      dirtyRef.current = true;
      if (err.status === 409) {
        blockedRef.current = true;
        setStatus('conflict');
        setSaveError(
          'Someone else saved this document after you opened it. Copy anything you want to keep, then reload to get the latest version.'
        );
      } else {
        setStatus('error');
        setSaveError(err.message);
      }
    } finally {
      savingRef.current = false;
      if (retry) timerRef.current = setTimeout(save, AUTOSAVE_DELAY_MS);
    }
  }, [initial.id]);

  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false } })],
    content: initial.content,
    editable: canEdit,
    editorProps: { attributes: { class: 'doc-content', 'aria-label': 'Document content', spellcheck: 'true' } },
    onUpdate: () => {
      if (blockedRef.current) return;
      dirtyRef.current = true;
      setStatus('unsaved');
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(save, AUTOSAVE_DELAY_MS);
    },
  });
  editorRef.current = editor;

  // Flush pending changes when leaving the page, and warn before closing the tab with unsaved work.
  useEffect(() => {
    const beforeUnload = (event) => {
      if (dirtyRef.current || savingRef.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      clearTimeout(timerRef.current);
      save();
    };
  }, [save]);

  // Ctrl/Cmd+S saves immediately instead of opening the browser's save dialog.
  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        clearTimeout(timerRef.current);
        save();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save]);

  async function commitTitle() {
    const next = title.trim();
    if (next === savedTitle) {
      setTitle(savedTitle);
      return;
    }
    if (!next) {
      setTitle(savedTitle);
      setTitleError('Title cannot be empty, so the previous title was kept.');
      return;
    }
    try {
      const { document } = await api(`/documents/${initial.id}`, { method: 'PATCH', body: { title: next } });
      setSavedTitle(document.title);
      setTitle(document.title);
      setTitleError('');
    } catch (err) {
      setTitle(savedTitle);
      setTitleError(err.message);
    }
  }

  useEffect(() => {
    document.title = `${savedTitle} · Ajaia Docs`;
    return () => {
      document.title = 'Ajaia Docs';
    };
  }, [savedTitle]);

  return (
    <main className="editor-page">
      <div className="editor-header">
        <Link to="/" className="btn btn-ghost" aria-label="Back to documents">
          ← Documents
        </Link>
        <div className="title-wrap">
          <input
            className="title-input"
            value={title}
            maxLength={200}
            readOnly={!canEdit}
            aria-label="Document title"
            title={canEdit ? 'Click to rename' : 'You have view-only access'}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                setTitle(savedTitle);
                e.currentTarget.blur();
              }
            }}
          />
          <div className="doc-meta">
            {isOwner ? (
              <span className="badge badge-owner">Owner</span>
            ) : (
              <>
                <span className={`badge badge-${initial.role}`}>{initial.role === 'editor' ? 'Can edit' : 'Can view'}</span>
                <span className="muted small">Owned by {initial.owner.name}</span>
              </>
            )}
            {canEdit && (
              <span className={`save-status save-${status}`} role="status" data-testid="save-status">
                {STATUS_TEXT[status]}
              </span>
            )}
          </div>
        </div>
        {isOwner && (
          <button className="btn btn-primary" onClick={() => setShareOpen(true)}>
            Share
          </button>
        )}
      </div>

      {titleError && (
        <p className="error banner" role="alert">
          {titleError}
        </p>
      )}
      {saveError && (
        <p className="error banner" role="alert">
          {saveError}{' '}
          {status === 'conflict' ? (
            <button className="btn btn-small" onClick={() => window.location.reload()}>
              Reload latest
            </button>
          ) : (
            <button className="btn btn-small" onClick={save}>
              Retry
            </button>
          )}
        </p>
      )}
      {!canEdit && <p className="banner info">You have view-only access. Ask {initial.owner.name} for edit access to make changes.</p>}

      {canEdit && editor && <Toolbar editor={editor} />}
      <div className="page">
        <EditorContent editor={editor} />
      </div>

      {shareOpen && <ShareDialog documentId={initial.id} documentTitle={savedTitle} onClose={() => setShareOpen(false)} />}
    </main>
  );
}

function Toolbar({ editor }) {
  // TipTap v3 does not re-render React on every transaction by default,
  // so subscribe to just the state the toolbar needs.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      paragraph: e.isActive('paragraph') && !e.isActive('bulletList') && !e.isActive('orderedList'),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const chain = () => editor.chain().focus();
  const Button = ({ label, title, active, disabled, onClick, className = '' }) => (
    <button
      type="button"
      className={`tool ${active ? 'active' : ''} ${className}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep the text selection
      onClick={onClick}
    >
      {label}
    </button>
  );

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <Button label="B" title="Bold (Ctrl+B)" className="t-bold" active={state.bold} onClick={() => chain().toggleBold().run()} />
      <Button label="I" title="Italic (Ctrl+I)" className="t-italic" active={state.italic} onClick={() => chain().toggleItalic().run()} />
      <Button label="U" title="Underline (Ctrl+U)" className="t-underline" active={state.underline} onClick={() => chain().toggleUnderline().run()} />
      <span className="divider" />
      <Button label="Normal" title="Normal text" active={state.paragraph} onClick={() => chain().setParagraph().run()} />
      <Button label="H1" title="Heading 1" active={state.h1} onClick={() => chain().toggleHeading({ level: 1 }).run()} />
      <Button label="H2" title="Heading 2" active={state.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()} />
      <Button label="H3" title="Heading 3" active={state.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()} />
      <span className="divider" />
      <Button label="• List" title="Bulleted list" active={state.bulletList} onClick={() => chain().toggleBulletList().run()} />
      <Button label="1. List" title="Numbered list" active={state.orderedList} onClick={() => chain().toggleOrderedList().run()} />
      <span className="divider" />
      <Button label="Undo" title="Undo (Ctrl+Z)" disabled={!state.canUndo} onClick={() => chain().undo().run()} />
      <Button label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!state.canRedo} onClick={() => chain().redo().run()} />
    </div>
  );
}
