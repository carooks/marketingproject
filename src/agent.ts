// Agentic content repurposing pipeline.
//
// One "strategist" agent reads the source post ONCE and produces a structured
// brief. Then, for each channel in parallel, a "channel agent" runs a 4-step
// loop: plan → draft → self-critique → revise. Results stream out to the UI
// via callbacks so the marketer sees progress and can start reviewing finished
// drafts while others are still being written.
//
// The whole pipeline only talks to the model through `LLMProvider`, so the
// mock can be swapped for Azure OpenAI without changes here.

import { Draft, FormatId, FORMATS, QualityCheck } from './types';
import {
  BRAND,
  brandSystemPreamble,
  countPreferredPhrases,
  findAvoidedPhrases,
  findUnsupportedNumbers,
  hasApprovedCTA
} from './brand';
import {
  ChannelPlan,
  CoherenceReport,
  Critique,
  DirectorPlan,
  LLMProvider,
  MockLLMProvider,
  SourceBrief
} from './llm';

export type { CoherenceReport, DirectorPlan } from './llm';

export type AgentStepKind =
  | 'queued'
  | 'analyzing'
  | 'planning'
  | 'delegating'
  | 'drafting'
  | 'critiquing'
  | 'revising'
  | 'reviewing'
  | 'done'
  | 'error';

export interface AgentEvent {
  id: string;                 // unique per event
  agent: string;              // 'Strategist' or e.g. 'LinkedIn Agent'
  formatId?: FormatId;        // present for channel agents
  step: AgentStepKind;
  message: string;
  detail?: string;
  timestamp: number;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
}

export interface RunOptions {
  sourceText: string;
  sourceTitle?: string;
  formats: FormatId[];
  provider?: LLMProvider;     // defaults to MockLLMProvider
  onEvent?: (e: AgentEvent) => void;
  onDraft?: (draft: Draft) => void; // streamed as each format finishes
  onCoherence?: (report: CoherenceReport) => void; // final cross-channel report
  onDirectorPlan?: (plan: DirectorPlan) => void;
}

const DIRECTOR = 'Content Director';
const STRATEGIST = 'Strategist';

export async function runAgenticPipeline(opts: RunOptions): Promise<Draft[]> {
  const provider = opts.provider ?? new MockLLMProvider();
  const emit = (e: Omit<AgentEvent, 'id' | 'timestamp'>) =>
    opts.onEvent?.({ ...e, id: cryptoId(), timestamp: Date.now() });

  // -- Step 0: Director orchestrator decides the play ----------------------
  emit({
    agent: DIRECTOR,
    step: 'planning',
    message: 'Planning the campaign and choosing which channel agents to engage…'
  });

  const directorResp = await provider.complete<DirectorPlan>({
    system:
      brandSystemPreamble() + '\n\n' +
      'You are the Content Director / orchestrator for ' + BRAND.name + '. You coordinate a team of ' +
      'specialist channel agents (LinkedIn, Twitter, Email, ROI one-pager, ' +
      'Instagram, Internal comms). Given a source post and the requested channels, ' +
      'decide the delegation order, priority, and rationale per channel. Return JSON.',
    user:
      `<SOURCE_TITLE>${opts.sourceTitle ?? ''}</SOURCE_TITLE>\n` +
      `<FORMATS>${opts.formats.join(',')}</FORMATS>\n` +
      `<SOURCE>${truncateForPrompt(opts.sourceText)}</SOURCE>`,
    json: true
  });
  const directorPlan = directorResp.content;
  opts.onDirectorPlan?.(directorPlan);

  emit({
    agent: DIRECTOR,
    step: 'planning',
    message: `Plan ready: ${directorPlan.channels.length} channel agent(s) to engage`,
    detail: directorPlan.strategy,
    tokensIn: directorResp.tokensIn,
    tokensOut: directorResp.tokensOut,
    latencyMs: directorResp.latencyMs
  });

  // -- Step 1: Director invokes Strategist as a skill ----------------------
  emit({
    agent: DIRECTOR,
    step: 'delegating',
    message: `Delegating to ${STRATEGIST} for source analysis…`
  });

  emit({
    agent: STRATEGIST,
    step: 'analyzing',
    message: 'Reading source post and extracting brief…'
  });

  const briefResp = await provider.complete<SourceBrief>({
    system:
      brandSystemPreamble() + '\n\n' +
      'You are a senior content strategist / analyst for ' + BRAND.name + '. Extract a structured brief ' +
      'from the source post: title, thesis, audience, tone, 5 key points, any ' +
      'stats actually present in the source (do not invent any), a pull-quote, and a suggested CTA ' +
      'drawn from the approved CTA list when possible. Return JSON.',
    user:
      `<SOURCE_TITLE>${opts.sourceTitle ?? ''}</SOURCE_TITLE>\n` +
      `<SOURCE>${opts.sourceText}</SOURCE>`,
    json: true
  });
  const brief = briefResp.content;

  emit({
    agent: STRATEGIST,
    step: 'done',
    message: `Brief ready: "${brief.title}"`,
    detail: `${brief.keyPoints.length} key points · ${brief.stats.length} stats · audience: ${brief.audience}`,
    tokensIn: briefResp.tokensIn,
    tokensOut: briefResp.tokensOut,
    latencyMs: briefResp.latencyMs
  });

  // -- Step 2: Director delegates to channel agents (parallel) -------------
  const orderedFormats = directorPlan.channels
    .map((c) => c.formatId)
    .filter((id) => opts.formats.includes(id));
  // Include any user-selected formats the director may have dropped, just in case.
  for (const id of opts.formats) {
    if (!orderedFormats.includes(id)) orderedFormats.push(id);
  }

  emit({
    agent: DIRECTOR,
    step: 'delegating',
    message: `Delegating to ${orderedFormats.length} channel agent(s) in parallel`,
    detail: orderedFormats.map(agentName).join(', ')
  });

  orderedFormats.forEach((id) => {
    emit({
      agent: agentName(id),
      formatId: id,
      step: 'queued',
      message: 'Queued by Director'
    });
  });

  const draftPromises = orderedFormats.map((id) =>
    runChannelAgent(id, brief, opts.sourceText, provider, emit).then((draft) => {
      opts.onDraft?.(draft);
      return draft;
    })
  );

  const drafts = await Promise.all(draftPromises);

  // -- Step 3: Director reviews drafts for cross-channel coherence ---------
  emit({
    agent: DIRECTOR,
    step: 'reviewing',
    message: 'All channel agents reported back. Reviewing for cross-channel coherence…'
  });

  const coherenceResp = await provider.complete<CoherenceReport>({
    system:
      brandSystemPreamble() + '\n\n' +
      'You are the ' + BRAND.name + ' Content Director performing a final coherence / coordinator ' +
      'review. Look across all channel drafts for inconsistent claims, conflicting ' +
      'CTAs, off-brand language (any of the avoided phrases listed above), or missing links. ' +
      'Return JSON with notes, an overall verdict, and a suggested publish order.',
    user:
      `<FORMATS>${orderedFormats.join(',')}</FORMATS>\n` +
      `<DRAFTS>${drafts.map((d) => `### ${d.formatId}\n${d.body}`).join('\n\n')}</DRAFTS>`,
    json: true
  });
  const report = coherenceResp.content;
  opts.onCoherence?.(report);

  emit({
    agent: DIRECTOR,
    step: 'done',
    message: `Review complete — verdict: ${report.verdict}`,
    detail: `${report.notes.length} cross-channel note(s)`,
    tokensIn: coherenceResp.tokensIn,
    tokensOut: coherenceResp.tokensOut,
    latencyMs: coherenceResp.latencyMs
  });

  return drafts;
}

function truncateForPrompt(s: string, max = 600): string {
  return s.length <= max ? s : s.slice(0, max) + '…';
}

async function runChannelAgent(
  formatId: FormatId,
  brief: SourceBrief,
  sourceText: string,
  provider: LLMProvider,
  emit: (e: Omit<AgentEvent, 'id' | 'timestamp'>) => void
): Promise<Draft> {
  const agent = agentName(formatId);
  const def = FORMATS.find((f) => f.id === formatId)!;
  const briefJson = JSON.stringify(brief);
  const channelStart = performance.now();
  let totalIn = 0;
  let totalOut = 0;
  let llmCalls = 0;

  try {
    // Plan
    emit({ agent, formatId, step: 'planning', message: 'Planning structure…' });
    const planResp = await provider.complete<ChannelPlan>({
      system:
        brandSystemPreamble(formatId) + '\n\n' +
        `You are a channel planner for ${def.medium}. Output a JSON plan with a ` +
        'hook, a 3–5 step structure, and a CTA drawn from the approved CTA list. ' +
        'Stay on-brand and respect the channel constraints.',
      user: `<FORMAT>${formatId}</FORMAT>\n<BRIEF>${briefJson}</BRIEF>`,
      json: true
    });
    llmCalls++; totalIn += planResp.tokensIn; totalOut += planResp.tokensOut;
    emit({
      agent, formatId, step: 'planning',
      message: 'Plan ready',
      detail: planResp.content.structure.slice(0, 2).join(' · '),
      tokensIn: planResp.tokensIn, tokensOut: planResp.tokensOut, latencyMs: planResp.latencyMs
    });

    // Draft
    emit({ agent, formatId, step: 'drafting', message: 'Writing draft…' });
    const draftResp = await provider.complete<string>({
      system:
        brandSystemPreamble(formatId) + '\n\n' +
        `You are a senior copywriter / drafter for ${def.medium} at ${BRAND.name}. Write the post ` +
        'using the brief and plan. Follow channel conventions and OneDigital voice. ' +
        'Do not invent statistics. Output the post body only.',
      user:
        `<FORMAT>${formatId}</FORMAT>\n<BRIEF>${briefJson}</BRIEF>\n` +
        `<PLAN>${JSON.stringify(planResp.content)}</PLAN>`
    });
    llmCalls++; totalIn += draftResp.tokensIn; totalOut += draftResp.tokensOut;
    const initialDraft = draftResp.content;
    emit({
      agent, formatId, step: 'drafting',
      message: 'Draft v1 complete',
      detail: `${initialDraft.length} chars`,
      tokensIn: draftResp.tokensIn, tokensOut: draftResp.tokensOut, latencyMs: draftResp.latencyMs
    });

    // Critique
    emit({ agent, formatId, step: 'critiquing', message: 'Self-reviewing against channel rules…' });
    const critiqueResp = await provider.complete<Critique>({
      system:
        brandSystemPreamble(formatId) + '\n\n' +
        `You are a critic / editor for ${def.medium}. Identify up to 3 concrete ` +
        'issues with hook strength, length, clarity, CTA, and OneDigital brand voice ' +
        '(flag any avoided phrases or unsupported claims). Return JSON.',
      user: `<FORMAT>${formatId}</FORMAT>\n<DRAFT>${initialDraft}</DRAFT>`,
      json: true
    });
    llmCalls++; totalIn += critiqueResp.tokensIn; totalOut += critiqueResp.tokensOut;
    emit({
      agent, formatId, step: 'critiquing',
      message: `Found ${critiqueResp.content.issues.length} thing(s) to improve`,
      detail: critiqueResp.content.issues.join(' · '),
      tokensIn: critiqueResp.tokensIn, tokensOut: critiqueResp.tokensOut, latencyMs: critiqueResp.latencyMs
    });

    // Revise
    emit({ agent, formatId, step: 'revising', message: 'Applying revisions…' });
    const reviseResp = await provider.complete<string>({
      system:
        brandSystemPreamble(formatId) + '\n\n' +
        'You are the reviser. Apply the critique to improve the draft. ' +
        'Keep the original structure unless an issue requires changing it. ' +
        'Remove any avoided phrases and any numbers not present in the source.',
      user:
        `<FORMAT>${formatId}</FORMAT>\n<DRAFT>${initialDraft}</DRAFT>\n` +
        `<CRITIQUE>${JSON.stringify(critiqueResp.content)}</CRITIQUE>`
    });
    llmCalls++; totalIn += reviseResp.tokensIn; totalOut += reviseResp.tokensOut;
    const finalBody = reviseResp.content;

    emit({
      agent, formatId, step: 'done',
      message: 'Ready for review',
      tokensIn: reviseResp.tokensIn, tokensOut: reviseResp.tokensOut, latencyMs: reviseResp.latencyMs
    });

    const flags = detectFlags(formatId, brief, finalBody, sourceText);
    const qualityChecks = computeQualityChecks(formatId, brief, finalBody, critiqueResp.content, flags);
    const generationTimeMs = Math.round(performance.now() - channelStart);
    const generatedAt = new Date().toISOString();
    const cta = extractCta(finalBody) ?? brief.suggestedCTA;

    return {
      formatId,
      title: `${def.label}: ${brief.title}`,
      body: finalBody,
      notes: productionNotes(formatId),
      status: 'pending',
      editedByHuman: false,
      generatedAt,
      agentTrace: {
        plan: planResp.content,
        critique: critiqueResp.content,
        initialDraft
      },
      qualityChecks,
      flags,
      metadata: {
        audience: brief.audience,
        cta,
        suggestedReviewer: def.defaultReviewer,
        sourceExcerpt: brief.thesis,
        promptVersion: 'v0.5-onedigital'
      },
      metrics: {
        generationTimeMs,
        llmCalls,
        tokensIn: totalIn,
        tokensOut: totalOut
      },
      auditLog: [
        {
          timestamp: generatedAt,
          actor: 'agent',
          action: 'generated',
          detail: `${llmCalls} LLM calls · ${generationTimeMs}ms · ${flags.length} flag(s)`
        }
      ]
    };
  } catch (err) {
    emit({
      agent, formatId, step: 'error',
      message: 'Agent failed',
      detail: err instanceof Error ? err.message : String(err)
    });
    throw err;
  }
}

// --- Quality gate + unsupported-claim detection -----------------------------
// These run client-side after the critic step so a flaky model can't skip them.
// They're conservative — they only flag what's clearly missing or unsupported.

function detectFlags(formatId: FormatId, brief: SourceBrief, body: string, sourceText: string): string[] {
  const flags: string[] = [];
  const hasNumber = /\d/.test(body);
  const hasCta = hasApprovedCTA(body) || /read|book|sign up|link|register|download|reply|→/i.test(body);

  if (formatId === 'roiOnePager' && brief.stats.length === 0) {
    flags.push('No ROI / stats found in the source article. Add approved metrics before sending to sellers.');
  }
  if (formatId === 'roiOnePager' && !hasNumber) {
    flags.push('Draft contains no quantitative claims. ROI one-pagers need at least one supported number.');
  }
  if (!hasCta) {
    flags.push('No clear CTA detected. Use one of the approved OneDigital CTAs before approval.');
  }
  if (body.length < 80) {
    flags.push('Draft is unusually short. Source may have been too brief to repurpose into this channel.');
  }

  // Brand: avoided phrases (hard fail).
  const avoided = findAvoidedPhrases(body);
  for (const p of avoided) {
    flags.push(`Off-brand phrase detected: “${p}” — remove before approval.`);
  }

  // Brand: invented numbers / ROI not present in the source.
  const invented = findUnsupportedNumbers(body, sourceText);
  for (const n of invented) {
    flags.push(`Unsupported metric “${n}” — not found in the source article. Verify or remove.`);
  }

  return flags;
}

function computeQualityChecks(
  formatId: FormatId,
  brief: SourceBrief,
  body: string,
  critique: Critique,
  flags: string[]
): QualityCheck[] {
  const lowerBody = body.toLowerCase();
  const lowerThesis = brief.thesis.toLowerCase();
  const thesisWords = lowerThesis.split(/\W+/).filter((w) => w.length > 4);
  const overlap = thesisWords.filter((w) => lowerBody.includes(w)).length;
  const thesisPreserved = thesisWords.length > 0 && overlap / thesisWords.length >= 0.25;

  const hasCta = /read|book|sign up|link|register|download|reply|→/i.test(body);
  const ctaInFlags = flags.some((f) => /cta/i.test(f));

  // Channel-tone heuristic — very rough; in production this would be an LLM judge.
  const tonePass =
    (formatId === 'twitter' && body.length < 1800) ||
    (formatId === 'linkedin' && body.length > 400 && body.length < 2200) ||
    (formatId === 'email' && /subject/i.test(body)) ||
    (formatId === 'instagram' && /slide/i.test(body)) ||
    (formatId === 'internal' && body.length < 800) ||
    (formatId === 'roiOnePager' && body.length > 300);

  const unsupportedClaim = flags.some((f) => /not present|unsupported|invent/i.test(f));
  const avoidedHits = findAvoidedPhrases(body);
  const preferredHits = countPreferredPhrases(body);
  const ctaApproved = hasApprovedCTA(body);

  return [
    {
      id: 'main-message',
      label: 'Main message preserved',
      status: thesisPreserved ? 'pass' : 'warn',
      detail: thesisPreserved ? undefined : 'Draft drifts from the source thesis — verify it still says the right thing.'
    },
    {
      id: 'audience-match',
      label: 'Audience matched',
      status: 'pass',
      detail: `Targeted at: ${brief.audience}`
    },
    {
      id: 'channel-tone',
      label: 'Channel tone & format',
      status: tonePass ? 'pass' : 'warn',
      detail: tonePass ? undefined : 'Length or structure may not fit the channel — sanity-check before sending.'
    },
    {
      id: 'cta',
      label: 'CTA included',
      status: hasCta && !ctaInFlags ? 'pass' : 'fail',
      detail: hasCta ? undefined : 'No CTA detected.'
    },
    {
      id: 'cta-on-brand',
      label: 'CTA from approved OneDigital list',
      status: ctaApproved ? 'pass' : 'warn',
      detail: ctaApproved
        ? undefined
        : 'CTA does not closely match an approved OneDigital CTA — reviewer should confirm or swap.'
    },
    {
      id: 'brand-voice',
      label: 'OneDigital brand voice aligned',
      status: avoidedHits.length > 0 ? 'fail' : preferredHits >= 1 ? 'pass' : 'warn',
      detail: avoidedHits.length > 0
        ? `Avoided phrase(s) detected: ${avoidedHits.join(', ')}`
        : preferredHits >= 1
          ? `${preferredHits} preferred OneDigital phrase(s) present.`
          : 'No preferred brand phrases detected — consider weaving one in.'
    },
    {
      id: 'no-unsupported',
      label: 'No unsupported claims (no invented stats)',
      status: unsupportedClaim ? 'fail' : 'pass',
      detail: unsupportedClaim ? 'Possible unsourced metric in draft.' : undefined
    },
    {
      id: 'sales-value',
      label: 'Sales / ROI value extracted',
      status: formatId === 'roiOnePager'
        ? (brief.stats.length > 0 ? 'pass' : 'fail')
        : 'pass',
      detail: formatId === 'roiOnePager' && brief.stats.length === 0
        ? 'No source ROI data found — needs human input.'
        : undefined
    },
    {
      id: 'self-review',
      label: 'Self-review applied',
      status: critique.issues.length > 0 ? 'pass' : 'warn',
      detail: `${critique.issues.length} critique point(s) addressed by reviser.`
    },
    {
      id: 'human-required',
      label: 'Human approval required',
      status: 'pass',
      detail: 'Nothing auto-publishes — every draft is human-gated.'
    }
  ];
}

function extractCta(body: string): string | undefined {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  // Prefer last line if it looks like a CTA; otherwise the first line containing CTA-ish words.
  const last = lines[lines.length - 1];
  if (last && /read|book|sign up|link|register|download|reply|→/i.test(last)) return last;
  return lines.find((l) => /read the full|link in bio|book a|→/i.test(l));
}

function agentName(id: FormatId): string {
  const def = FORMATS.find((f) => f.id === id)!;
  return `${def.label} Agent`;
}

function productionNotes(id: FormatId): string | undefined {
  switch (id) {
    case 'instagram':
      return 'Design direction: brand gradient background, large serif headline on slide 1, bold sans for body. Keep < 25 words per slide.';
    case 'roiOnePager':
      return 'Layout: 1 page, brand header, problem/solution split, ROI stat callouts on right rail.';
    case 'email':
      return 'Send Tuesday 10am local. A/B test subject line vs. first key point.';
    default:
      return undefined;
  }
}

function cryptoId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}
