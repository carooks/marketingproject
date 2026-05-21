import { useMemo, useRef, useState, useEffect } from 'react';
import { ApprovalStatus, AuditEntry, Draft, FormatId, FORMATS, QualityCheck } from './types';
import { AgentEvent, AgentStepKind, CoherenceReport, DirectorPlan, runAgenticPipeline } from './agent';
import { BRAND } from './brand';
import { askChaddy, ChaddyMessage } from './chaddy';
import { extractPdfText } from './pdf';
import { exportDraftToPdf, exportPackageToPdf } from './pdfExport';
import { detectChannelIntent, chaddyExport } from './chaddyExport';

const SAMPLE = `The future of B2B marketing isn't more content — it's more leverage from the content you already have. Most teams pour weeks into a single thought leadership piece, then publish it once and move on. The highest-performing teams treat every long-form post as a source asset that fuels a dozen downstream artifacts: social posts, sales one-pagers, newsletter sections, and internal enablement. The shift is operational, not creative. It requires a repeatable system that turns one input into many outputs, with human judgment in the loop at every step. This week we break down how to build that system without losing brand voice.`;

type ChannelStatus = Partial<Record<FormatId, AgentStepKind>>;

export default function App() {
  const [source, setSource] = useState('');
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<Set<FormatId>>(
    new Set(FORMATS.map((f) => f.id))
  );
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [channelStatus, setChannelStatus] = useState<ChannelStatus>({});
  const [directorStep, setDirectorStep] = useState<AgentStepKind | undefined>(undefined);
  const [directorPlan, setDirectorPlan] = useState<DirectorPlan | null>(null);
  const [coherence, setCoherence] = useState<CoherenceReport | null>(null);
  const [activeTab, setActiveTab] = useState<FormatId | null>(null);
  const [pdfStatus, setPdfStatus] = useState<
    | { state: 'idle' }
    | { state: 'parsing'; name: string }
    | { state: 'ready'; name: string; pages: number }
    | { state: 'error'; message: string }
  >({ state: 'idle' });
  const logRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, changes: 0 };
    drafts.forEach((d) => {
      if (d.status === 'pending') c.pending++;
      else if (d.status === 'approved') c.approved++;
      else c.changes++;
    });
    return c;
  }, [drafts]);

  function toggleFormat(id: FormatId) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleGenerate() {
    if (!source.trim() || selected.size === 0) return;
    setLoading(true);
    setDrafts([]);
    setEvents([]);
    setChannelStatus({});
    setDirectorStep(undefined);
    setDirectorPlan(null);
    setCoherence(null);
    setActiveTab(null);

    try {
      await runAgenticPipeline({
        sourceText: source,
        sourceTitle: title,
        formats: Array.from(selected),
        onEvent: (e) => {
          setEvents((prev) => [...prev, e]);
          queueMicrotask(() => {
            logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
          });
          if (e.formatId) {
            setChannelStatus((prev) => ({ ...prev, [e.formatId!]: e.step }));
          } else if (e.agent === 'Content Director') {
            setDirectorStep(e.step);
          }
        },
        onDirectorPlan: (plan) => setDirectorPlan(plan),
        onCoherence: (report) => setCoherence(report),
        onDraft: (draft) => {
          setDrafts((prev) => {
            const next = [...prev, draft];
            if (next.length === 1) setActiveTab(draft.formatId);
            return next;
          });
        }
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function updateDraft(formatId: FormatId, patch: Partial<Draft>, auditAction?: string, auditDetail?: string) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.formatId !== formatId) return d;
        const next = { ...d, ...patch };
        if (auditAction) {
          const entry: AuditEntry = {
            timestamp: new Date().toISOString(),
            actor: 'human',
            action: auditAction,
            detail: auditDetail
          };
          next.auditLog = [...d.auditLog, entry];
        }
        return next;
      })
    );
  }
  function setStatus(formatId: FormatId, status: ApprovalStatus) {
    const label =
      status === 'approved' ? 'approved' :
      status === 'changes-requested' ? 'requested changes' :
      'reset to pending review';
    updateDraft(formatId, { status }, label);
  }
  function loadSample() {
    setTitle('Why repurposing beats producing');
    setSource(SAMPLE);
    setPdfStatus({ state: 'idle' });
  }

  async function handlePdfFile(file: File) {
    if (!file) return;
    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setPdfStatus({ state: 'error', message: 'Please choose a PDF file.' });
      return;
    }
    setPdfStatus({ state: 'parsing', name: file.name });
    try {
      const result = await extractPdfText(file);
      if (!result.text) {
        setPdfStatus({ state: 'error', message: 'No selectable text found (scanned PDF?).' });
        return;
      }
      setSource(result.text);
      if (!title && result.title) setTitle(result.title);
      setPdfStatus({ state: 'ready', name: file.name, pages: result.pages });
    } catch (err) {
      console.error(err);
      setPdfStatus({ state: 'error', message: 'Could not read this PDF.' });
    }
  }

  function onPdfInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handlePdfFile(file);
    e.target.value = '';
  }

  function onDropPdf(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handlePdfFile(file);
  }
  function reset() {
    setDrafts([]);
    setEvents([]);
    setChannelStatus({});
    setDirectorStep(undefined);
    setDirectorPlan(null);
    setCoherence(null);
    setActiveTab(null);
  }

  const activeDraft = drafts.find((d) => d.formatId === activeTab) ?? null;
  const showWorkspace = loading || drafts.length > 0 || events.length > 0;

  // --- v0.6 shell state ----------------------------------------------------
  type ViewId = 'chat' | 'pipeline' | 'brand' | 'settings';
  const [view, setView] = useState<ViewId>('chat');
  const [showHelp, setShowHelp] = useState(false);
  const [toasts, setToasts] = useState<Array<{ id: number; kind: 'success' | 'warn' | 'error' | 'info'; title?: string; body: string }>>([]);
  function pushToast(t: { kind?: 'success' | 'warn' | 'error' | 'info'; title?: string; body: string }) {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, kind: t.kind ?? 'info', title: t.title, body: t.body }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4200);
  }
  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }

  // Keyboard shortcuts (Cmd/Ctrl+K → search/help, ? → help, Esc → close)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inEditable =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || (target as HTMLElement).isContentEditable);
      if (e.key === 'Escape') { setShowHelp(false); return; }
      if (e.key === '?' && !inEditable) { e.preventDefault(); setShowHelp((v) => !v); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setShowHelp(true); return;
      }
      // 1/2/3/4 for view switching
      if (!inEditable && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === '1') setView('chat');
        else if (e.key === '2') setView('pipeline');
        else if (e.key === '3') setView('brand');
        else if (e.key === '4') setView('settings');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const VIEW_META: Record<ViewId, { eyebrow: string; title: string }> = {
    chat:     { eyebrow: 'CHADDY', title: 'Brainstorm & draft source content' },
    pipeline: { eyebrow: 'AGENT WORKSPACE', title: 'Repurpose into six channels' },
    brand:    { eyebrow: 'CONTEXT', title: 'OneDigital brand & agent guardrails' },
    settings: { eyebrow: 'SETTINGS', title: 'Prototype configuration' }
  };

  return (
    <div className="app">
      <div className="shell">
        <NavRail view={view} setView={setView} />

        <main className="canvas">
          <TopBar
            meta={VIEW_META[view]}
            counts={counts}
            hasDrafts={drafts.length > 0}
            onHelp={() => setShowHelp(true)}
          />

          {view === 'chat' && (
            <div className="view view-chat">
              <ChaddyPanel
                fullWidth
                onSendToPipeline={(text, t) => {
                  setSource(text);
                  if (t) setTitle(t);
                  setView('pipeline');
                  pushToast({ kind: 'success', title: 'Sent to pipeline', body: 'Source loaded — run the agents whenever you\u2019re ready.' });
                }}
                pushToast={pushToast}
              />
            </div>
          )}

          {view === 'pipeline' && (
            <div className="view">
              {!showWorkspace && !source.trim() && <EmptyHero onSample={loadSample} onChat={() => setView('chat')} />}

              <section className="panel">
                <div className="panel-header">
                  <h2>{Icons.fileText()} Source content</h2>
                  <div className="row">
                    <button className="link" onClick={loadSample} type="button">Load sample</button>
                    <button
                      className="link"
                      onClick={() => { setSource(''); setTitle(''); reset(); }}
                      type="button"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <label className="field">
                  <span>Working title (optional)</span>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Why repurposing beats producing"
                  />
                </label>

                <label
                  className={`dropzone ${pdfStatus.state === 'parsing' ? 'parsing' : ''}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={onDropPdf}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={onPdfInputChange}
                    hidden
                  />
                  <div className="dropzone-icon" aria-hidden>{Icons.upload()}</div>
                  <div className="dropzone-body">
                    {pdfStatus.state === 'parsing' && (
                      <>
                        <strong>Extracting text\u2026</strong>
                        <span className="muted">{pdfStatus.name}</span>
                      </>
                    )}
                    {pdfStatus.state === 'ready' && (
                      <>
                        <strong>Loaded {pdfStatus.name}</strong>
                        <span className="muted">{pdfStatus.pages} page{pdfStatus.pages === 1 ? '' : 's'} \u00b7 text below is editable</span>
                      </>
                    )}
                    {pdfStatus.state === 'error' && (
                      <>
                        <strong>Upload failed</strong>
                        <span className="muted">{pdfStatus.message}</span>
                      </>
                    )}
                    {pdfStatus.state === 'idle' && (
                      <>
                        <strong>Drop a PDF here, or click to browse</strong>
                        <span className="muted">Text-based PDFs only \u00b7 scanned/image PDFs aren\u2019t OCR\u2019d</span>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    className="ghost"
                    onClick={(e) => { e.preventDefault(); fileInputRef.current?.click(); }}
                  >
                    {pdfStatus.state === 'ready' ? 'Replace' : 'Choose PDF'}
                  </button>
                </label>

                <label className="field">
                  <span>Blog post text</span>
                  <textarea
                    value={source}
                    onChange={(e) => { setSource(e.target.value); if (pdfStatus.state === 'ready') setPdfStatus({ state: 'idle' }); }}
                    placeholder="Paste the long-form blog post here, or upload a PDF above."
                    rows={10}
                  />
                  <small className="muted">
                    {source.trim() ? `${source.trim().split(/\s+/).length} words` : 'No content yet'}
                  </small>
                </label>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <h2>{Icons.layers()} Output formats</h2>
                  <span className="muted">{selected.size} selected \u00b7 1 agent per channel</span>
                </div>
                <div className="format-grid">
                  {FORMATS.map((f) => {
                    const on = selected.has(f.id);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        className={`format-card ${on ? 'on' : ''}`}
                        onClick={() => toggleFormat(f.id)}
                        aria-pressed={on}
                        data-channel={f.id}
                      >
                        <div className="format-icon" aria-hidden>{f.icon}</div>
                        <div className="format-meta">
                          <strong>{f.label}</strong>
                          <span className="muted">{f.description}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="actions">
                  <button
                    className="primary"
                    disabled={loading || !source.trim() || selected.size === 0}
                    onClick={handleGenerate}
                    type="button"
                  >
                    {loading ? 'Agents working\u2026' : drafts.length ? 'Re-run agents' : `\u2728 Run ${selected.size} agent${selected.size === 1 ? '' : 's'}`}
                  </button>
                  {(drafts.length > 0 || events.length > 0) && !loading && (
                    <button className="ghost" onClick={reset} type="button">
                      Discard drafts
                    </button>
                  )}
                </div>
              </section>

              {showWorkspace && (
                <section className="panel">
                  <div className="panel-header">
                    <h2>{Icons.cpu()} Agent workspace</h2>
                    <div className="status-summary">
                      <span className="pill pill-pending">{counts.pending} pending</span>
                      <span className="pill pill-approved">{counts.approved} approved</span>
                      <span className="pill pill-changes">{counts.changes} changes</span>
                    </div>
                  </div>

                  <MetricsStrip drafts={drafts} />

                  <div className="agent-grid">
                    <div className="agent-board">
                      <DirectorCard step={directorStep} plan={directorPlan} loading={loading} />
                      {Array.from(selected).map((id) => {
                        const f = FORMATS.find((x) => x.id === id)!;
                        const step = channelStatus[id];
                        const draft = drafts.find((d) => d.formatId === id);
                        return (
                          <AgentCard
                            key={id}
                            label={f.label}
                            icon={f.icon}
                            channelId={f.id}
                            step={step}
                            hasDraft={!!draft}
                            active={activeTab === id}
                            onOpen={() => draft && setActiveTab(id)}
                          />
                        );
                      })}
                    </div>

                    <ActivityLog events={events} logRef={logRef} />
                  </div>

                  {coherence && <CoherenceCard report={coherence} />}

                  {drafts.length > 0 && (
                    <>
                      <div className="tabs">
                        {drafts.map((d) => {
                          const f = FORMATS.find((x) => x.id === d.formatId)!;
                          return (
                            <button
                              key={d.formatId}
                              type="button"
                              className={`tab status-${d.status} ${activeTab === d.formatId ? 'active' : ''}`}
                              onClick={() => setActiveTab(d.formatId)}
                              data-channel={d.formatId}
                            >
                              <span aria-hidden>{f.icon}</span> {f.label}
                              <span className={`dot dot-${d.status}`} aria-hidden />
                            </button>
                          );
                        })}
                      </div>

                      {activeDraft && (
                        <DraftEditor
                          draft={activeDraft}
                          onChange={(patch, auditAction) =>
                            updateDraft(activeDraft.formatId, patch, auditAction)
                          }
                          onApprove={() => { setStatus(activeDraft.formatId, 'approved'); pushToast({ kind: 'success', title: 'Approved', body: `${FORMATS.find(f=>f.id===activeDraft.formatId)?.label} draft approved.` }); }}
                          onRequestChanges={() => { setStatus(activeDraft.formatId, 'changes-requested'); pushToast({ kind: 'warn', title: 'Changes requested', body: 'The draft is marked for revision.' }); }}
                          onReset={() => setStatus(activeDraft.formatId, 'pending')}
                          onExportToast={(label) => pushToast({ kind: 'success', title: 'PDF exported', body: `${label} downloaded.` })}
                        />
                      )}

                      <ExportBar drafts={drafts} onToast={pushToast} />
                    </>
                  )}
                </section>
              )}
            </div>
          )}

          {view === 'brand' && (
            <div className="view">
              <BrandCard />
              <ScopeCard />
            </div>
          )}

          {view === 'settings' && (
            <div className="view">
              <section className="panel">
                <div className="panel-header">
                  <h2>{Icons.settings()} Prototype configuration</h2>
                </div>
                <p className="muted" style={{ lineHeight: 1.6 }}>
                  Powered by a mock LLM provider for the prototype. Swap{' '}
                  <code>MockLLMProvider</code> for <code>AzureOpenAIProvider</code> in{' '}
                  <code>src/llm.ts</code> to run on a real model \u2014 no other code changes.
                  Drafts are never auto-published; approval is required for every channel.
                </p>
                <div className="help-grid" style={{ marginTop: 12 }}>
                  <span className="help-key">1 / 2 / 3 / 4</span><span>Switch views (Chat / Pipeline / Brand / Settings)</span>
                  <span className="help-key">?</span><span>Open keyboard shortcuts</span>
                  <span className="help-key">Ctrl/\u2318 + K</span><span>Open shortcuts</span>
                  <span className="help-key">Enter</span><span>Send message in Chaddy</span>
                  <span className="help-key">Shift + Enter</span><span>New line in Chaddy</span>
                  <span className="help-key">Esc</span><span>Close any overlay</span>
                </div>
              </section>
            </div>
          )}
        </main>

        {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
      </div>
    </div>
  );
}

// --- Shell components -------------------------------------------------------

function NavRail({ view, setView }: { view: 'chat' | 'pipeline' | 'brand' | 'settings'; setView: (v: 'chat' | 'pipeline' | 'brand' | 'settings') => void }) {
  const items: Array<{ id: typeof view; label: string; icon: JSX.Element }> = [
    { id: 'chat',     label: 'Chat with Chaddy',  icon: Icons.message() },
    { id: 'pipeline', label: 'Agent pipeline',    icon: Icons.workflow() },
    { id: 'brand',    label: 'Brand & context',   icon: Icons.palette() },
    { id: 'settings', label: 'Settings',          icon: Icons.settings() }
  ];
  return (
    <nav className="nav-rail" aria-label="Primary navigation">
      <div className="nav-brand" title="OneDigital">
        {Icons.spark()}
      </div>
      <div className="nav-rail-divider" />
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className={`nav-item ${view === it.id ? 'active' : ''}`}
          onClick={() => setView(it.id)}
          aria-label={it.label}
          aria-current={view === it.id ? 'page' : undefined}
        >
          {it.icon}
          <span className="nav-tooltip">{it.label}</span>
        </button>
      ))}
      <div className="nav-rail-spacer" />
    </nav>
  );
}

function TopBar({ meta, counts, hasDrafts, onHelp }: {
  meta: { eyebrow: string; title: string };
  counts: { pending: number; approved: number; changes: number };
  hasDrafts: boolean;
  onHelp: () => void;
}) {
  return (
    <header className="topbar">
      <div className="topbar-title">
        <span className="eyebrow">{meta.eyebrow}</span>
        <h1>{meta.title}</h1>
      </div>
      <div className="topbar-status">
        {hasDrafts && (
          <>
            <span className="pill pill-pending">{counts.pending} pending</span>
            <span className="pill pill-approved">{counts.approved} approved</span>
            {counts.changes > 0 && <span className="pill pill-changes">{counts.changes} changes</span>}
          </>
        )}
      </div>
      <div className="topbar-actions">
        <button type="button" className="icon-btn" onClick={onHelp} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
          {Icons.help()}
        </button>
      </div>
    </header>
  );
}

function EmptyHero({ onSample, onChat }: { onSample: () => void; onChat: () => void }) {
  return (
    <div className="empty-hero">
      <h2>{Icons.spark()} One idea \u2192 six channels, in minutes.</h2>
      <p>Chat with Chaddy to draft, or paste source content below. A team of six AI agents reviews and rewrites it for LinkedIn, X, email, sales, Instagram, and internal comms \u2014 with brand guardrails and a human-in-the-loop approval step on every draft.</p>
      <div className="empty-steps">
        <div className="empty-step"><span className="empty-step-num">1</span><strong>Draft or upload</strong><span>Chat with Chaddy or paste a long-form post / upload a PDF.</span></div>
        <div className="empty-step"><span className="empty-step-num">2</span><strong>Agents repurpose</strong><span>Director plans \u2192 6 channel agents draft \u2192 critic, reviser, coherence check.</span></div>
        <div className="empty-step"><span className="empty-step-num">3</span><strong>Review & export</strong><span>Approve each channel and download a branded PDF package.</span></div>
      </div>
      <div className="empty-cta">
        <button type="button" className="primary" onClick={onSample}>{Icons.spark()} Try a sample brief</button>
        <button type="button" className="ghost" onClick={onChat}>{Icons.message()} Chat with Chaddy first</button>
      </div>
    </div>
  );
}

function ToastStack({ toasts, onDismiss }: { toasts: Array<{ id: number; kind: 'success' | 'warn' | 'error' | 'info'; title?: string; body: string }>; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role="status">
          <span className="toast-icon" aria-hidden>
            {t.kind === 'success' ? Icons.check() : t.kind === 'warn' ? Icons.alert() : t.kind === 'error' ? Icons.x() : Icons.info()}
          </span>
          <div className="toast-body">
            {t.title && <strong>{t.title}</strong>}
            {t.body}
          </div>
          <button type="button" className="toast-close" onClick={() => onDismiss(t.id)} aria-label="Dismiss">\u00d7</button>
        </div>
      ))}
    </div>
  );
}

function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <h3>{Icons.help()} Keyboard shortcuts</h3>
        <div className="help-grid">
          <span className="help-key">1 / 2 / 3 / 4</span><span>Switch views</span>
          <span className="help-key">?</span><span>Toggle this overlay</span>
          <span className="help-key">Ctrl/\u2318 + K</span><span>Open shortcuts</span>
          <span className="help-key">Enter</span><span>Send message (Chaddy)</span>
          <span className="help-key">Shift + Enter</span><span>New line</span>
          <span className="help-key">Esc</span><span>Close overlay</span>
        </div>
        <button type="button" className="ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// --- Icon set (inline SVG, lucide-style) -----------------------------------
const Icons = {
  spark:    () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3"/></svg>,
  message:  () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  workflow: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M9 6h6a3 3 0 0 1 3 3v6"/></svg>,
  palette:  () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2a10 10 0 1 0 10 10c0-1.5-.8-2-2-2h-2a3 3 0 0 1 0-6h0a2 2 0 0 0 2-2A8 8 0 0 0 12 2z"/></svg>,
  settings: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  help:     () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  fileText: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>,
  upload:   () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  layers:   () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>,
  cpu:      () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/></svg>,
  check:    () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  alert:    () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  x:        () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  info:     () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>,
  send:     () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  paperclip:() => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>,
  download: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
};

// --- subcomponents ----------------------------------------------------------

function AgentCard({
  label, icon, step, hasDraft, active, onOpen, channelId
}: {
  label: string;
  icon: string;
  step: AgentStepKind | undefined;
  hasDraft: boolean;
  active: boolean;
  onOpen: () => void;
  channelId?: string;
}) {
  const isWorking = !!step && !['queued', 'done', 'error'].includes(step);
  return (
    <button
      type="button"
      className={`agent-card step-${step ?? 'idle'} ${active ? 'active' : ''}`}
      onClick={onOpen}
      disabled={!hasDraft}
      data-channel={channelId}
    >
      <div className="agent-card-head">
        <span className="agent-card-icon" aria-hidden>{icon}</span>
        <strong>{label}</strong>
      </div>
      <div className="agent-card-status">
        {isWorking && <span className="spinner" aria-hidden />}
        <span>{stepLabel(step)}</span>
      </div>
      <ProgressBar step={step} />
    </button>
  );
}

const STEP_ORDER: AgentStepKind[] = [
  'queued', 'planning', 'drafting', 'critiquing', 'revising', 'done'
];

const DIRECTOR_STEP_ORDER: AgentStepKind[] = [
  'planning', 'delegating', 'reviewing', 'done'
];

function ProgressBar({ step }: { step: AgentStepKind | undefined }) {
  const idx = step ? STEP_ORDER.indexOf(step) : -1;
  const pct = step === 'error' ? 100 : idx >= 0 ? ((idx + 1) / STEP_ORDER.length) * 100 : 0;
  return (
    <div className="progress">
      <div
        className={`progress-fill ${step === 'error' ? 'error' : ''} ${step === 'done' ? 'done' : ''}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function stepLabel(step: AgentStepKind | undefined): string {
  switch (step) {
    case undefined: return 'Idle';
    case 'queued': return 'Queued';
    case 'analyzing': return 'Analyzing source…';
    case 'planning': return 'Planning…';
    case 'delegating': return 'Delegating…';
    case 'drafting': return 'Drafting…';
    case 'critiquing': return 'Self-reviewing…';
    case 'revising': return 'Revising…';
    case 'reviewing': return 'Reviewing all drafts…';
    case 'done': return 'Ready for review';
    case 'error': return 'Error';
  }
}

function DirectorCard({
  step, plan, loading
}: {
  step: AgentStepKind | undefined;
  plan: DirectorPlan | null;
  loading: boolean;
}) {
  const isWorking = !!step && step !== 'done' && step !== 'error';
  const idx = step ? DIRECTOR_STEP_ORDER.indexOf(step) : -1;
  const pct = step === 'error' ? 100 : idx >= 0 ? ((idx + 1) / DIRECTOR_STEP_ORDER.length) * 100 : loading ? 5 : 0;
  const label =
    step === 'planning' ? 'Planning the play…' :
    step === 'delegating' ? 'Delegating to agents…' :
    step === 'reviewing' ? 'Reviewing all drafts…' :
    step === 'done' ? 'Coordination complete' :
    loading ? 'Waiting to start…' : 'Idle';
  return (
    <div className={`agent-card director step-${step ?? 'idle'}`}>
      <div className="agent-card-head">
        <span className="agent-card-icon" aria-hidden>🎭</span>
        <strong>Content Director</strong>
        <span className="director-tag">orchestrator</span>
      </div>
      <div className="agent-card-status">
        {isWorking && <span className="spinner" aria-hidden />}
        <span>{label}</span>
      </div>
      <div className="progress">
        <div
          className={`progress-fill ${step === 'error' ? 'error' : ''} ${step === 'done' ? 'done' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {plan && (
        <div className="director-strategy">{plan.strategy}</div>
      )}
    </div>
  );
}

function CoherenceCard({ report }: { report: CoherenceReport }) {
  const verdictLabel =
    report.verdict === 'ready' ? 'Ready to ship' :
    report.verdict === 'minor-edits' ? 'Minor edits suggested' :
    'Needs rework';
  return (
    <div className={`coherence verdict-${report.verdict}`}>
      <div className="coherence-head">
        <span className="coherence-icon" aria-hidden>🎭</span>
        <div>
          <strong>Director's coherence review</strong>
          <span className="muted"> · cross-channel consistency check</span>
        </div>
        <span className={`pill verdict-pill-${report.verdict}`}>{verdictLabel}</span>
      </div>
      <ul className="coherence-notes">
        {report.notes.map((n, i) => <li key={i}>{n}</li>)}
      </ul>
      {report.publishOrder.length > 0 && (
        <div className="coherence-order muted">
          Suggested publish order:{' '}
          {report.publishOrder.map((id, i) => {
            const f = FORMATS.find((x) => x.id === id);
            return (
              <span key={id}>
                {i > 0 && ' → '}
                <span className="coherence-step">{f?.icon} {f?.label}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActivityLog({
  events, logRef
}: {
  events: AgentEvent[];
  logRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="activity">
      <div className="activity-header">
        <strong>Agent activity</strong>
        <span className="muted">{events.length} event{events.length === 1 ? '' : 's'}</span>
      </div>
      <div className="activity-log" ref={logRef}>
        {events.length === 0 && <div className="muted activity-empty">No activity yet.</div>}
        {events.map((e) => (
          <div key={e.id} className={`activity-row step-${e.step}`}>
            <span className="activity-time">{formatTime(e.timestamp)}</span>
            <span className="activity-agent">{e.agent}</span>
            <span className="activity-msg">
              {e.message}
              {e.detail && <span className="activity-detail"> · {e.detail}</span>}
            </span>
            {typeof e.latencyMs === 'number' && (
              <span className="activity-meta">
                {e.tokensIn}↑ {e.tokensOut}↓ · {e.latencyMs}ms
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour12: false }) + '.' +
    String(d.getMilliseconds()).padStart(3, '0');
}

interface EditorProps {
  draft: Draft;
  onChange: (patch: Partial<Draft>, auditAction?: string) => void;
  onApprove: () => void;
  onRequestChanges: () => void;
  onReset: () => void;
  onExportToast?: (label: string) => void;
}

function DraftEditor({
  draft, onChange, onApprove, onRequestChanges, onReset, onExportToast
}: EditorProps) {
  const def = FORMATS.find((f) => f.id === draft.formatId)!;
  const [showTrace, setShowTrace] = useState(false);
  const [showAudit, setShowAudit] = useState(false);

  // Audit body/notes/reviewer edits once per "session of editing" (on blur).
  function auditBlur(action: string) {
    onChange({}, action);
  }

  return (
    <div className="draft">
      <div className="draft-head">
        <div>
          <h3>{def.label}</h3>
          <span className="muted">For: {def.medium}</span>
        </div>
        <StatusChip status={draft.status} />
      </div>

      <MetadataBlock draft={draft} />
      <FlagsCallout flags={draft.flags} />
      <QualityGate checks={draft.qualityChecks} />

      <label className="field">
        <span>Draft copy</span>
        <textarea
          value={draft.body}
          rows={14}
          onChange={(e) => onChange({ body: e.target.value, editedByHuman: true })}
          onBlur={() => draft.editedByHuman && auditBlur('edited draft body')}
        />
      </label>

      {draft.notes !== undefined && (
        <label className="field">
          <span>Production notes</span>
          <textarea
            value={draft.notes}
            rows={3}
            onChange={(e) => onChange({ notes: e.target.value })}
            onBlur={() => auditBlur('edited production notes')}
          />
        </label>
      )}

      <label className="field">
        <span>Reviewer comment (optional)</span>
        <input
          type="text"
          value={draft.reviewerComment ?? ''}
          onChange={(e) => onChange({ reviewerComment: e.target.value })}
          onBlur={() =>
            draft.reviewerComment && auditBlur('left a reviewer comment')
          }
          placeholder="e.g. Tighten the hook, add a customer proof point."
        />
      </label>

      {draft.agentTrace && (
        <div className="trace">
          <button
            type="button"
            className="link"
            onClick={() => setShowTrace((v) => !v)}
          >
            {showTrace ? 'Hide' : 'Show'} agent trace
          </button>
          {showTrace && (
            <div className="trace-body">
              <div>
                <strong>Critique applied during self-review:</strong>
                <ul>
                  {draft.agentTrace.critique.issues.map((i, idx) => (
                    <li key={idx}>{i}</li>
                  ))}
                </ul>
              </div>
              <details>
                <summary>Initial draft (before revision)</summary>
                <pre>{draft.agentTrace.initialDraft}</pre>
              </details>
            </div>
          )}
        </div>
      )}

      <div className="audit-wrap">
        <button
          type="button"
          className="link"
          onClick={() => setShowAudit((v) => !v)}
        >
          {showAudit ? 'Hide' : 'Show'} audit log ({draft.auditLog.length})
        </button>
        {showAudit && <AuditLog entries={draft.auditLog} />}
      </div>

      <div className="actions">
        <button className="primary" type="button" onClick={onApprove}>✓ Approve</button>
        <button className="warn" type="button" onClick={onRequestChanges}>⟲ Request changes</button>
        <button className="ghost" type="button" onClick={onReset}>Reset to pending</button>
        <button
          className="ghost"
          type="button"
          onClick={() => navigator.clipboard?.writeText(draft.body)}
        >
          Copy to clipboard
        </button>
        <button
          className="ghost"
          type="button"
          onClick={() => { exportDraftToPdf(draft); onExportToast?.(FORMATS.find(f=>f.id===draft.formatId)?.label || 'Draft'); }}
        >
          ⬇ Export PDF
        </button>
      </div>
    </div>
  );
}

function MetadataBlock({ draft }: { draft: Draft }) {
  const m = draft.metadata;
  return (
    <div className="meta-block">
      <div className="meta-grid">
        <div><span className="meta-k">Audience</span><span className="meta-v">{m.audience}</span></div>
        <div><span className="meta-k">CTA</span><span className="meta-v">{m.cta ?? '— none —'}</span></div>
        <div><span className="meta-k">Suggested reviewer</span><span className="meta-v">{m.suggestedReviewer}</span></div>
        <div><span className="meta-k">Prompt version</span><span className="meta-v mono">{m.promptVersion}</span></div>
      </div>
      <blockquote className="source-excerpt">
        <span className="meta-k">From source:</span> “{m.sourceExcerpt}”
      </blockquote>
      <div className="metrics-row">
        <span>⏱ {draft.metrics.generationTimeMs} ms</span>
        <span>🤖 {draft.metrics.llmCalls} LLM calls</span>
        <span>↑ {draft.metrics.tokensIn} tok</span>
        <span>↓ {draft.metrics.tokensOut} tok</span>
      </div>
    </div>
  );
}

function FlagsCallout({ flags }: { flags: string[] }) {
  if (flags.length === 0) return null;
  return (
    <div className="flags-callout">
      <div className="flags-head">⚠ Agent needs human input ({flags.length})</div>
      <ul>
        {flags.map((f, i) => <li key={i}>{f}</li>)}
      </ul>
      <p className="muted">
        These items could not be sourced or verified from the input. Resolve before approving.
      </p>
    </div>
  );
}

function QualityGate({ checks }: { checks: QualityCheck[] }) {
  const fail = checks.filter((c) => c.status === 'fail').length;
  const warn = checks.filter((c) => c.status === 'warn').length;
  const verdict =
    fail > 0 ? { label: `${fail} blocker${fail > 1 ? 's' : ''}`, cls: 'qg-verdict-fail' } :
    warn > 0 ? { label: `${warn} warning${warn > 1 ? 's' : ''}`, cls: 'qg-verdict-warn' } :
    { label: 'All checks pass', cls: 'qg-verdict-pass' };
  return (
    <div className="qg">
      <div className="qg-head">
        <strong>Quality gate</strong>
        <span className={`qg-verdict ${verdict.cls}`}>{verdict.label}</span>
      </div>
      <ul className="qg-list">
        {checks.map((c) => (
          <li key={c.id} className={`qg-row qg-${c.status}`}>
            <span className="qg-icon">
              {c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✕'}
            </span>
            <span className="qg-label">{c.label}</span>
            {c.detail && <span className="qg-detail muted">{c.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AuditLog({ entries }: { entries: AuditEntry[] }) {
  return (
    <ol className="audit-log">
      {entries.map((e, i) => (
        <li key={i} className={`audit-row audit-${e.actor}`}>
          <span className="audit-time mono">
            {new Date(e.timestamp).toLocaleTimeString()}
          </span>
          <span className={`audit-actor audit-actor-${e.actor}`}>{e.actor}</span>
          <span className="audit-action">{e.action}</span>
          {e.detail && <span className="audit-detail muted">— {e.detail}</span>}
        </li>
      ))}
    </ol>
  );
}

function StatusChip({ status }: { status: ApprovalStatus }) {
  const label =
    status === 'approved' ? 'Approved'
      : status === 'changes-requested' ? 'Changes requested'
      : 'Pending review';
  return <span className={`pill pill-${chipClass(status)}`}>{label}</span>;
}
function chipClass(s: ApprovalStatus) {
  return s === 'approved' ? 'approved' : s === 'changes-requested' ? 'changes' : 'pending';
}

function ExportBar({ drafts, onToast }: { drafts: Draft[]; onToast?: (t: { kind?: 'success'|'warn'|'error'|'info'; title?: string; body: string }) => void }) {
  const approved = drafts.filter((d) => d.status === 'approved');
  function exportApprovedJson() {
    const payload = { exportedAt: new Date().toISOString(), drafts: approved };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `approved-drafts-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="export-bar">
      <span className="muted">
        {approved.length} of {drafts.length} approved. Nothing is auto-posted —
        export the package and hand it to the channel owners.
      </span>
      <div className="export-actions">
        <button
          type="button"
          className="ghost"
          disabled={approved.length === 0}
          onClick={() => { exportApprovedJson(); onToast?.({ kind: 'success', title: 'JSON exported', body: `${approved.length} approved draft${approved.length === 1 ? '' : 's'} downloaded.` }); }}
        >
          .json
        </button>
        <button
          type="button"
          className="primary"
          disabled={approved.length === 0}
          onClick={() => { exportPackageToPdf(approved); onToast?.({ kind: 'success', title: 'Package exported', body: `${approved.length} approved draft${approved.length === 1 ? '' : 's'} compiled into a PDF.` }); }}
        >
          ⬇ Export approved package (PDF)
        </button>
      </div>
    </div>
  );
}

function ScopeCard() {
  const [open, setOpen] = useState(false);
  return (
    <div className={`scope-card ${open ? 'open' : ''}`}>
      <button type="button" className="scope-toggle" onClick={() => setOpen(v => !v)}>
        <span>🔍 What this agent will and won’t do</span>
        <span className="scope-chev">{open ? '?' : '?'}</span>
      </button>
      {open && (
        <div className="scope-grid">
          <div className="scope-col scope-can">
            <h4>Agent can</h4>
            <ul>
              <li>Read pasted text or text-based PDFs</li>
              <li>Draft for 6 channels in parallel</li>
              <li>Self-critique and revise each draft</li>
              <li>Run a coherence check across channels</li>
              <li>Flag missing data or unsupported claims</li>
            </ul>
          </div>
          <div className="scope-col scope-cant">
            <h4>Agent will not</h4>
            <ul>
              <li>Publish or schedule anything automatically</li>
              <li>Invent metrics not present in the source</li>
              <li>Edit brand voice without human approval</li>
              <li>Email customers or post on your behalf</li>
              <li>OCR scanned image PDFs</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricsStrip({ drafts }: { drafts: Draft[] }) {
  if (drafts.length === 0) return null;
  const totalMs = drafts.reduce((s, d) => s + d.metrics.generationTimeMs, 0);
  const totalCalls = drafts.reduce((s, d) => s + d.metrics.llmCalls, 0);
  const totalTokens = drafts.reduce((s, d) => s + d.metrics.tokensIn + d.metrics.tokensOut, 0);
  const totalFlags = drafts.reduce((s, d) => s + d.flags.length, 0);
  const editRate = Math.round(
    (drafts.filter((d) => d.editedByHuman).length / drafts.length) * 100
  );
  const approvedRate = Math.round(
    (drafts.filter((d) => d.status === 'approved').length / drafts.length) * 100
  );
  // Heuristic: ~2.5 marketer-hours per draft if produced manually.
  const hoursSaved = (drafts.length * 2.5).toFixed(1);

  const items = [
    { k: 'Assets generated', v: String(drafts.length) },
    { k: 'Agent wall-time', v: `${(totalMs / 1000).toFixed(1)}s` },
    { k: 'LLM calls', v: String(totalCalls) },
    { k: 'Tokens', v: totalTokens.toLocaleString() },
    { k: 'Est. hours saved', v: `~${hoursSaved}h` },
    { k: 'Flags raised', v: String(totalFlags) },
    { k: 'Human edit rate', v: `${editRate}%` },
    { k: 'Approval rate', v: `${approvedRate}%` }
  ];
  return (
    <div className="metrics-strip">
      {items.map((i) => (
        <div key={i.k} className="metric-kpi">
          <span className="metric-v">{i.v}</span>
          <span className="metric-k">{i.k}</span>
        </div>
      ))}
    </div>
  );
}

function BrandCard() {
  const [open, setOpen] = useState(false);
  return (
    <div className={`brand-card ${open ? 'open' : ''}`}>
      <button type="button" className="brand-toggle" onClick={() => setOpen(v => !v)}>
        <span>🎨 OneDigital brand guidelines applied to every draft</span>
        <span className="brand-chev">{open ? '?' : '?'}</span>
      </button>
      {open && (
        <div className="brand-body">
          <div className="brand-row">
            <div>
              <h4>Voice</h4>
              <p>{BRAND.voice}</p>
            </div>
            <div>
              <h4>Audience</h4>
              <p>{BRAND.audience}</p>
            </div>
          </div>
          <div className="brand-row">
            <div>
              <h4>Preferred phrases</h4>
              <div className="chip-row">
                {BRAND.preferredPhrases.map((p) => (
                  <span key={p} className="brand-chip brand-chip-good">{p}</span>
                ))}
              </div>
            </div>
          </div>
          <div className="brand-row">
            <div>
              <h4>Avoided phrases (hard fail)</h4>
              <div className="chip-row">
                {BRAND.avoidedPhrases.map((p) => (
                  <span key={p} className="brand-chip brand-chip-bad">{p}</span>
                ))}
              </div>
            </div>
          </div>
          <div className="brand-row">
            <div>
              <h4>Approved CTAs</h4>
              <ul className="brand-cta-list">
                {BRAND.approvedCTAs.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============== Chaddy chat panel ===========================================
function pickExportSource(
  messages: ChaddyMessage[],
  uploadedDoc: { name: string; text: string } | null
): { text: string; name?: string } | null {
  // Prefer the most recent long-form draft Chaddy wrote (contains '---' separator).
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'chaddy' && m.content.includes('---')) {
      const idx = m.content.indexOf('---');
      const body = m.content.slice(idx + 3).trim();
      const titleMatch = body.match(/^#\s+(.+)$/m);
      return { text: body, name: titleMatch?.[1] };
    }
  }
  if (uploadedDoc) return { text: uploadedDoc.text, name: uploadedDoc.name.replace(/\.pdf$/i, '') };
  return null;
}

function ChaddyPanel({ onSendToPipeline, fullWidth, pushToast: _pushToast }: { onSendToPipeline: (text: string, title?: string) => void; fullWidth?: boolean; pushToast?: (t: { kind?: 'success'|'warn'|'error'|'info'; title?: string; body: string }) => void }) {
  const [messages, setMessages] = useState<ChaddyMessage[]>([
    {
      id: 'm0',
      role: 'chaddy',
      content:
        "Hey, I'm Chaddy, your OneDigital marketing strategist. I help you turn one idea or document into a complete cross-channel content set.\n\nHere's how it works: once you have a long-form post you're happy with, the agent team on the right repurposes it into all six formats your marketing program needs:\n\n  • LinkedIn post — for thought leadership and brand reach\n  • Twitter / X thread — for bite-sized distribution\n  • Email newsletter — for nurture and retention\n  • Sales ROI one-pager — for advisor and sales conversations\n  • Instagram carousel — for visual social storytelling\n  • Internal comms summary — to align your own team\n\nTry uploading a PDF (📎 below) to translate your content for all of your social media needs, or just tell me what you want to write about and I'll draft it with you.",
      timestamp: Date.now()
    }
  ]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadedDoc, setUploadedDoc] = useState<{ name: string; text: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, thinking]);

  async function send() {
    const text = input.trim();
    if (!text || thinking) return;
    const userMsg: ChaddyMessage = { id: `u${Date.now()}`, role: 'user', content: text, timestamp: Date.now() };
    setMessages([...messages, userMsg]);
    setInput('');

    // Explicit PDF export request → bypasses the agent approval pipeline.
    const intent = detectChannelIntent(text);
    if (intent) {
      const source = pickExportSource(messages, uploadedDoc);
      if (!source) {
        setMessages((prev) => [...prev, {
          id: `c${Date.now()}`, role: 'chaddy',
          content: "I don't have anything to export yet. Upload a PDF or ask me to draft a post first, then say something like \"export this as a PDF\" or \"give me a LinkedIn PDF\".",
          timestamp: Date.now()
        }]);
        return;
      }
      setThinking(true);
      try {
        const result = await chaddyExport(source.text, intent, source.name);
        const targetLabel = intent === 'all'
          ? `all six channels (${result.channels.join(', ')})`
          : result.channels[0];
        setMessages((prev) => [...prev, {
          id: `c${Date.now()}`, role: 'chaddy',
          content:
            `Done — exported ${result.count === 1 ? 'a PDF' : `${result.count} PDFs`} for **${targetLabel}** straight to your downloads.\n\n` +
            `⚠️ **Heads up:** because you asked for this directly, I skipped the agent review pipeline (no critic, no coherence check, no director sign-off). The PDF carries a flag noting this. For production use, send the source through the pipeline on the right and approve each channel before exporting.`,
          timestamp: Date.now()
        }]);
      } catch (err) {
        console.error(err);
        setMessages((prev) => [...prev, { id: `e${Date.now()}`, role: 'chaddy', content: 'Sorry — the PDF export hit an error. Check the console and try again.', timestamp: Date.now() }]);
      } finally {
        setThinking(false);
      }
      return;
    }

    setThinking(true);
    try {
      const reply = await askChaddy(messages, text);
      setMessages((prev) => [...prev, { id: `c${Date.now()}`, role: 'chaddy', content: reply, timestamp: Date.now() }]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [...prev, { id: `e${Date.now()}`, role: 'chaddy', content: 'Sorry, something went wrong on my end. Try again?', timestamp: Date.now() }]);
    } finally {
      setThinking(false);
    }
  }

  async function handleUpload(file: File) {
    if (thinking) return;
    if (!/\.pdf$/i.test(file.name)) {
      setUploadStatus('Only PDF files are supported.');
      return;
    }
    setUploadStatus(`Parsing ${file.name}...`);
    try {
      const { text, pages } = await extractPdfText(file);
      setUploadStatus(null);
      setUploadedDoc({ name: file.name, text });
      const displayMsg = `Uploaded ${file.name} (${pages} page${pages === 1 ? '' : 's'}, ${text.length.toLocaleString()} characters). Please summarize the key points and suggest 3 angles I could use for a long-form OneDigital post.`;
      const promptForChaddy = `I just uploaded a document called "${file.name}". Summarize the key points, suggest 3 angles for a long-form post, AND remind me that I can repurpose this same document directly into all six channel formats (LinkedIn, Twitter / X, email newsletter, sales ROI one-pager, Instagram carousel, internal comms) using the button you'll show me below the summary.\n\n<DOCUMENT>\n${text.slice(0, 12000)}\n</DOCUMENT>`;
      const userMsg: ChaddyMessage = { id: `u${Date.now()}`, role: 'user', content: displayMsg, timestamp: Date.now() };
      setMessages((prev) => [...prev, userMsg]);
      setThinking(true);
      try {
        const reply = await askChaddy(messages, promptForChaddy);
        setMessages((prev) => [...prev, { id: `c${Date.now()}`, role: 'chaddy', content: reply, timestamp: Date.now() }]);
      } finally {
        setThinking(false);
      }
    } catch (err) {
      console.error(err);
      setUploadStatus(`Could not parse ${file.name}.`);
    }
  }

  function extractDraft(content: string): { body: string; title?: string } {
    const idx = content.indexOf('---');
    const body = idx >= 0 ? content.slice(idx + 3).trim() : content.trim();
    const titleMatch = body.match(/^#\s+(.+)$/m);
    return { body, title: titleMatch?.[1] };
  }

  const SUGGESTIONS = [
    'Draft a LinkedIn post about AI in HR',
    'Summarize the uploaded PDF in 3 bullets',
    'Give me 3 angles for a thought-leadership piece',
    'Write an email opener about benefits enrollment'
  ];
  return (
    <aside className={`chaddy-col ${fullWidth ? 'chaddy-full' : ''}`}>
      <div className="chaddy-head">
        <div className="chaddy-avatar" aria-hidden>
          <img src="/chaddy.png" alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
        </div>
        <div>
          <strong>Chaddy</strong>
          <div className="muted small">Brainstorm &amp; draft source content</div>
        </div>
        <span className="pill pill-pending" style={{ marginLeft: 'auto' }}>Mock agent</span>
      </div>

      {messages.length <= 1 && (
        <div className="chip-row-suggested">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="chip-suggested" onClick={() => setInput(s)}>{s}</button>
          ))}
        </div>
      )}

      <div className="chaddy-messages" ref={scrollRef}>
        {messages.map((m) => {
          const isDraft = m.role === 'chaddy' && m.content.includes('---');
          const { body, title } = isDraft ? extractDraft(m.content) : { body: m.content, title: undefined };
          return (
            <div key={m.id} className={`chaddy-msg chaddy-msg-${m.role}`}>
              <div className="chaddy-msg-body">{m.content}</div>
              {isDraft && (
                <button
                  className="primary chaddy-handoff"
                  type="button"
                  onClick={() => onSendToPipeline(body, title)}
                >
                  → Send to pipeline
                </button>
              )}
            </div>
          );
        })}
        {thinking && (
          <div className="chaddy-msg chaddy-msg-chaddy">
            <div className="chaddy-msg-body chaddy-typing">
              <span /><span /><span />
            </div>
          </div>
        )}
        {uploadedDoc && !thinking && (
          <div className="chaddy-doc-actions">
            <div className="chaddy-doc-actions-head">
              <strong>Repurpose <em>{uploadedDoc.name}</em> for every channel</strong>
              <span className="muted small">The agent team on the right will draft all six formats from this document. Nothing publishes automatically.</span>
            </div>
            <button
              className="primary"
              type="button"
              onClick={() => {
                onSendToPipeline(uploadedDoc.text, uploadedDoc.name.replace(/\.pdf$/i, ''));
              }}
            >
              → Send PDF to pipeline (LinkedIn, Twitter, Email, Sales ROI, Instagram, Internal)
            </button>
            <button
              className="ghost small"
              type="button"
              onClick={() => setUploadedDoc(null)}
              title="Hide these options"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {uploadStatus && <div className="chaddy-status">{uploadStatus}</div>}

      <div className="chaddy-input">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleUpload(f);
            e.currentTarget.value = '';
          }}
        />
        <button
          className="ghost chaddy-clip"
          type="button"
          title="Upload a PDF"
          onClick={() => fileRef.current?.click()}
          disabled={thinking}
        >
          📎
        </button>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder='Try: "Draft a post about AI in HR", or upload a PDF'
          rows={2}
        />
        <button className="primary" type="button" onClick={send} disabled={!input.trim() || thinking}>
          {thinking ? <span className="chaddy-typing-inline"><span/><span/><span/></span> : Icons.send()}
        </button>
      </div>
    </aside>
  );
}
