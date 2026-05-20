// Domain types for the content repurposing prototype.
// Designed so future iterations can add: PDF upload, real LLM calls,
// scheduled publishing, multi-user review, analytics, etc.

export type FormatId =
  | 'linkedin'
  | 'twitter'
  | 'email'
  | 'roiOnePager'
  | 'instagram'
  | 'internal';

export type ApprovalStatus = 'pending' | 'approved' | 'changes-requested';

export interface FormatDefinition {
  id: FormatId;
  label: string;
  medium: string;
  description: string;
  icon: string; // emoji placeholder; replace with proper icons later
  /** Default human owner / reviewer for this channel. */
  defaultReviewer: string;
  /** What "good" looks like for this channel — shown in the reviewability header. */
  goodLooksLike: string;
}

export type QualityStatus = 'pass' | 'warn' | 'fail';

export interface QualityCheck {
  id: string;
  label: string;
  status: QualityStatus;
  detail?: string;
}

export interface AuditEntry {
  timestamp: string;       // ISO
  actor: 'agent' | 'human';
  action: string;          // e.g. "generated", "edited body", "approved"
  detail?: string;
}

export interface Draft {
  formatId: FormatId;
  title: string;
  body: string;            // primary copy (final, post-revision)
  notes?: string;          // production / design notes (e.g. for Instagram)
  status: ApprovalStatus;
  reviewerComment?: string;
  editedByHuman: boolean;
  generatedAt: string;     // ISO timestamp
  /** Transparency: what the agents produced along the way. */
  agentTrace?: {
    plan: unknown;
    critique: { issues: string[]; severity: 'low' | 'medium' | 'high' };
    initialDraft: string;
  };
  /** Structured quality gate — checked by the critic agent before handing off. */
  qualityChecks: QualityCheck[];
  /** Things the agent could not source from the article and refused to invent. */
  flags: string[];
  /** Reviewability metadata. */
  metadata: {
    audience: string;
    cta: string;
    suggestedReviewer: string;
    sourceExcerpt: string;
    promptVersion: string;
  };
  /** Per-draft generation metrics. */
  metrics: {
    generationTimeMs: number;
    llmCalls: number;
    tokensIn: number;
    tokensOut: number;
  };
  /** Append-only change log for audit/traceability. */
  auditLog: AuditEntry[];
}

export const FORMATS: FormatDefinition[] = [
  {
    id: 'linkedin',
    label: 'LinkedIn Post',
    medium: 'LinkedIn',
    description: 'Professional, hook-driven, 1,200–1,500 chars with a CTA.',
    icon: '💼',
    defaultReviewer: 'Brand / Social Lead',
    goodLooksLike: 'Professional, insight-led, strong hook, business takeaway, single clear CTA.'
  },
  {
    id: 'twitter',
    label: 'Twitter / X Thread',
    medium: 'Twitter / X',
    description: '5–7 tweet thread, each ≤ 280 chars, numbered.',
    icon: '🐦',
    defaultReviewer: 'Social Manager',
    goodLooksLike: 'Punchy, skimmable, sequential, each tweet ≤ 280 chars, clear ending CTA.'
  },
  {
    id: 'email',
    label: 'Email Newsletter',
    medium: 'Email',
    description: 'Subject line + preview + sectioned body + CTA.',
    icon: '✉️',
    defaultReviewer: 'Lifecycle / Email Marketing',
    goodLooksLike: 'Subject + preview text, concise sectioned body, single primary CTA above the fold.'
  },
  {
    id: 'roiOnePager',
    label: 'Sales ROI One-Pager',
    medium: 'Sales enablement',
    description: 'Problem, solution, outcomes, ROI bullets, talk track.',
    icon: '📈',
    defaultReviewer: 'Product Marketing + RevOps',
    goodLooksLike: 'Pain points, ROI/value bullets backed by source data, talking points, discovery questions.'
  },
  {
    id: 'instagram',
    label: 'Instagram Carousel',
    medium: 'Instagram',
    description: '6 slides of copy + per-slide design direction.',
    icon: '📸',
    defaultReviewer: 'Brand / Creative Lead',
    goodLooksLike: 'Visual concept, ≤ 25 words per slide, caption with CTA, design direction per slide.'
  },
  {
    id: 'internal',
    label: 'Internal Comms Summary',
    medium: 'Internal (Slack / Teams)',
    description: 'TL;DR for the team: what changed, why it matters, what to do.',
    icon: '🏢',
    defaultReviewer: 'Internal Comms / Enablement',
    goodLooksLike: 'What published, why it matters, how teams should use it. 5 bullets max.'
  }
];
