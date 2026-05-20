import { useMemo, useRef, useState, useEffect } from 'react';
import { ApprovalStatus, AuditEntry, Draft, FormatId, FORMATS, QualityCheck } from './types';
import { AgentEvent, AgentStepKind, CoherenceReport, DirectorPlan, runAgenticPipeline } from './agent';
import { BRAND } from './brand';
import { askChaddy, ChaddyMessage } from './chaddy';
import { extractPdfText } from './pdf';

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

  return (
    <div className="app">
      <header className="header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden>1D</div>
          <div>
            <div className="brand-eyebrow">OneDigital · Marketing</div>
            <h1>Content Repurposer</h1>
            <p className="subtitle">
              Chat with Chaddy to draft or upload a long-form post, then a team of six AI agents
              repurposes it into LinkedIn, Twitter, email, sales one-pager, Instagram, and internal
              comms — all in OneDigital voice. You review and approve; nothing publishes automatically.
            </p>
          </div>
        </div>
        <span className="badge">Prototype · v0.5 · brand-aligned</span>
      </header>

      <BrandCard />
      <ScopeCard />

      <div className="split">
        <ChaddyPanel
          onSendToPipeline={(text, t) => {
            setSource(text);
            if (t) setTitle(t);
            // scroll right side into view
            setTimeout(() => {
              document.getElementById('pipeline-col')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 50);
          }}
        />

        <div className="pipeline-col" id="pipeline-col">
      <section className="panel">
        <div className="panel-header">
          <h2>1. Source content</h2>
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
          <div className="dropzone-icon" aria-hidden>📄</div>
          <div className="dropzone-body">
            {pdfStatus.state === 'parsing' && (
              <>
                <strong>Extracting text…</strong>
                <span className="muted">{pdfStatus.name}</span>
              </>
            )}
            {pdfStatus.state === 'ready' && (
              <>
                <strong>Loaded {pdfStatus.name}</strong>
                <span className="muted">{pdfStatus.pages} page{pdfStatus.pages === 1 ? '' : 's'} · text below is editable</span>
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
                <span className="muted">Text-based PDFs only · scanned/image PDFs aren't OCR'd</span>
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
          <h2>2. Choose output formats</h2>
          <span className="muted">{selected.size} selected · 1 agent per channel</span>
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
            {loading ? 'Agents working…' : drafts.length ? 'Re-run agents' : 'Run agents'}
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
            <h2>3. Agent workspace</h2>
            <div className="status-summary">
              <span className="pill pill-pending">{counts.pending} pending</span>
              <span className="pill pill-approved">{counts.approved} approved</span>
              <span className="pill pill-changes">{counts.changes} changes requested</span>
            </div>
          </div>

          <MetricsStrip drafts={drafts} />

          <div className="agent-grid">
            <div className="agent-board">
              <DirectorCard
                step={directorStep}
                plan={directorPlan}
                loading={loading}
              />
              {Array.from(selected).map((id) => {
                const f = FORMATS.find((x) => x.id === id)!;
                const step = channelStatus[id];
                const draft = drafts.find((d) => d.formatId === id);
                return (
                  <AgentCard
                    key={id}
                    label={f.label}
                    icon={f.icon}
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
                  onApprove={() => setStatus(activeDraft.formatId, 'approved')}
                  onRequestChanges={() => setStatus(activeDraft.formatId, 'changes-requested')}
                  onReset={() => setStatus(activeDraft.formatId, 'pending')}
                />
              )}

              <ExportBar drafts={drafts} />
            </>
          )}
        </section>
      )}
        </div>
      </div>

      <footer className="footer muted">
        Powered by a mock LLM provider for the prototype. Swap{' '}
        <code>MockLLMProvider</code> for <code>AzureOpenAIProvider</code> in{' '}
        <code>src/llm.ts</code> to run on a real model — no other code changes.
        Drafts are never auto-published; approval is required for every channel.
      </footer>
    </div>
  );
}

// --- subcomponents ----------------------------------------------------------

function AgentCard({
  label, icon, step, hasDraft, active, onOpen
}: {
  label: string;
  icon: string;
  step: AgentStepKind | undefined;
  hasDraft: boolean;
  active: boolean;
  onOpen: () => void;
}) {
  const isWorking = !!step && !['queued', 'done', 'error'].includes(step);
  return (
    <button
      type="button"
      className={`agent-card step-${step ?? 'idle'} ${active ? 'active' : ''}`}
      onClick={onOpen}
      disabled={!hasDraft}
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
}

function DraftEditor({
  draft, onChange, onApprove, onRequestChanges, onReset
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

function ExportBar({ drafts }: { drafts: Draft[] }) {
  const approved = drafts.filter((d) => d.status === 'approved');
  function exportApproved() {
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
      <button
        type="button"
        className="primary"
        disabled={approved.length === 0}
        onClick={exportApproved}
      >
        Export approved package (.json)
      </button>
    </div>
  );
}

function ScopeCard() {
  const [open, setOpen] = useState(false);
  return (
    <div className={`scope-card ${open ? 'open' : ''}`}>
      <button type="button" className="scope-toggle" onClick={() => setOpen(v => !v)}>
        <span>?? What this agent will and won''t do</span>
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
        <span>?? OneDigital brand guidelines applied to every draft</span>
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
function ChaddyPanel({ onSendToPipeline }: { onSendToPipeline: (text: string, title?: string) => void }) {
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
      const displayMsg = `Uploaded ${file.name} (${pages} page${pages === 1 ? '' : 's'}, ${text.length.toLocaleString()} characters). Please summarize the key points and suggest 3 angles I could use for a long-form OneDigital post.`;
      const promptForChaddy = `I just uploaded a document called "${file.name}". Summarize the key points and suggest 3 angles I could use for a long-form post about this topic.\n\n<DOCUMENT>\n${text.slice(0, 12000)}\n</DOCUMENT>`;
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

  return (
    <aside className="chaddy-col">
      <div className="chaddy-head">
        <div className="chaddy-avatar" aria-hidden>??</div>
        <div>
          <strong>Chaddy</strong>
          <div className="muted small">Brainstorm &amp; draft source content</div>
        </div>
        <span className="pill pill-pending" style={{ marginLeft: 'auto' }}>Mock agent</span>
      </div>

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
                  ? Send to pipeline
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
          {thinking ? '�' : 'Send'}
        </button>
      </div>
    </aside>
  );
}
