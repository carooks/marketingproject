// Chaddy "quick export" path: lets the user export a channel-specific PDF
// directly from chat WITHOUT running the full approval pipeline. Used only when
// the user explicitly asks (e.g. "export the LinkedIn post as a PDF"). Each
// generated draft is tagged with a flag making it clear the approval framework
// was bypassed.

import { MockLLMProvider } from './llm';
import { FORMATS, type Draft, type FormatId } from './types';
import { BRAND, brandSystemPreamble } from './brand';
import { exportDraftToPdf, exportPackageToPdf } from './pdfExport';

const BYPASS_FLAG =
  'Bypassed agent review pipeline at user request — no critic, coherence, or director sign-off.';

/** Returns the FormatId the user is asking for, or null if unspecified / "all". */
export function detectChannelIntent(msg: string): FormatId | 'all' | null {
  const lower = msg.toLowerCase();
  const wantsExport =
    /\b(export|download|save|give me|make me|generate)\b.*\bpdf\b/.test(lower) ||
    /\b(as|into|to)\s+(a\s+)?pdf\b/.test(lower) ||
    /\bpdf\s+(of|for|version)\b/.test(lower);
  if (!wantsExport) return null;

  if (/\b(all|every|each|six|6)\b.*\bchannels?\b/.test(lower) || /\beverything\b/.test(lower)) {
    return 'all';
  }
  if (/\blinked\s*in\b/.test(lower)) return 'linkedin';
  if (/\btwitter\b|\bx\s+(thread|post)\b|\btweet\b/.test(lower)) return 'twitter';
  if (/\binstagram\b|\binsta\b|\bcarousel\b/.test(lower)) return 'instagram';
  if (/\bemail\b|\bnewsletter\b/.test(lower)) return 'email';
  if (/\broi\b|\bsales\b|\bone[-\s]?pager\b/.test(lower)) return 'roiOnePager';
  if (/\binternal\b|\bcomms\b/.test(lower)) return 'internal';
  return 'all';
}

/** Drafts a single channel from raw source text using only the mock drafter agent. */
export async function quickDraftForChannel(source: string, formatId: FormatId): Promise<Draft> {
  const def = FORMATS.find((f) => f.id === formatId)!;
  const provider = new MockLLMProvider();
  const resp = await provider.complete<string>({
    system:
      brandSystemPreamble(formatId) +
      '\n\n' +
      `You are a senior copywriter / drafter for ${def.medium} at ${BRAND.name}. Write the post ` +
      'using the source. Follow channel conventions and OneDigital voice. ' +
      'Do not invent statistics. Output the post body only.',
    user: `<FORMAT>${formatId}</FORMAT>\n<SOURCE>${source.slice(0, 8000)}</SOURCE>`
  });

  const now = new Date().toISOString();
  return {
    formatId,
    title: def.label,
    body: typeof resp.content === 'string' ? resp.content : String(resp.content ?? ''),
    status: 'pending',
    editedByHuman: false,
    generatedAt: now,
    qualityChecks: [],
    flags: [BYPASS_FLAG],
    metadata: {
      audience: def.medium,
      cta: '',
      suggestedReviewer: def.defaultReviewer,
      sourceExcerpt: source.slice(0, 180),
      promptVersion: 'chaddy-quick-export'
    },
    metrics: {
      generationTimeMs: resp.latencyMs,
      llmCalls: 1,
      tokensIn: resp.tokensIn,
      tokensOut: resp.tokensOut
    },
    auditLog: [
      {
        timestamp: now,
        actor: 'agent',
        action: 'Chaddy quick export (bypassed pipeline)',
        detail: 'User explicitly requested a PDF without running the full review pipeline.'
      }
    ]
  };
}

/** Generates draft(s) for the requested target and triggers download(s). */
export async function chaddyExport(
  source: string,
  target: FormatId | 'all',
  baseName?: string
): Promise<{ count: number; channels: string[] }> {
  if (target === 'all') {
    const drafts = await Promise.all(
      FORMATS.map((f) => quickDraftForChannel(source, f.id))
    );
    exportPackageToPdf(drafts);
    return { count: drafts.length, channels: drafts.map((d) => d.title) };
  }
  const draft = await quickDraftForChannel(source, target);
  if (baseName) draft.title = baseName + ' — ' + draft.title;
  exportDraftToPdf(draft);
  return { count: 1, channels: [draft.title] };
}
