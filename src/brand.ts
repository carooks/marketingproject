// OneDigital brand guidelines, encoded so both the agents and the quality
// gate can apply them consistently. Keep this file as the single source of
// truth — if marketing updates the guidelines, only this file changes.

import { FormatId } from './types';

export const BRAND = {
  name: 'OneDigital',
  positioning:
    'OneDigital helps organizations build healthier, more resilient workplaces ' +
    'through strategic advisory services, benefits consulting, HR support, risk ' +
    'management, and technology-enabled workforce solutions.',
  promise:
    'We help employers make confident people decisions by combining expert guidance, ' +
    'practical strategy, and modern technology.',
  audience:
    'Business leaders, HR executives, benefits leaders, finance leaders, and people ' +
    'operations teams at mid-sized to enterprise organizations.',
  voice: 'Professional, clear, confident, practical, and human.',
  tone: [
    'Sound like a trusted advisor, not a hype-driven vendor.',
    'Use plain English.',
    'Be thoughtful and business-focused.',
    'Balance innovation with responsibility.',
    'Avoid exaggerated claims.',
    'Avoid sounding overly technical unless the audience requires it.',
    'Emphasize practical value, not novelty.'
  ],
  themes: [
    'Better decisions through better workforce intelligence.',
    'Human expertise strengthened by technology.',
    'Scalable solutions for complex workplace challenges.',
    'Compliance, benefits, HR, and workforce strategy made clearer.',
    'Practical innovation that supports people, teams, and organizations.'
  ],
  preferredPhrases: [
    'workforce strategy',
    'people decisions',
    'employee experience',
    'business impact',
    'trusted guidance',
    'practical solutions',
    'technology-enabled support',
    'human-centered innovation',
    'measurable value',
    'risk-aware approach'
  ],
  avoidedPhrases: [
    'AI will replace HR',
    'fully automated people decisions',
    'guaranteed compliance',
    'instant transformation',
    'revolutionary disruption',
    'set it and forget it',
    'magic',
    'one-size-fits-all'
  ],
  writingStyle: [
    'Lead with the business problem.',
    'Explain why it matters.',
    'Offer a practical point of view.',
    'Keep sentences concise.',
    'Use bullets for readability.',
    'Include a clear takeaway or CTA.',
    'Avoid jargon where possible.',
    'Use data only when supported by the source material.'
  ],
  approvedCTAs: [
    'Learn how your organization can prepare.',
    'Explore practical strategies for workforce planning.',
    'Talk with an advisor about your next step.',
    'See how a more connected HR strategy can support your business.',
    'Start building a more resilient workforce.'
  ],
  safePhrases: [
    'AI can support HR teams, but human judgment remains essential.',
    'The opportunity is not replacing expertise — it is scaling it.',
    'The strongest solutions combine technology, governance, and practical business context.',
    'Workforce strategy is most effective when people, process, and technology work together.'
  ],
  aiMay: [
    'Summarize approved source content',
    'Draft channel-specific marketing assets',
    'Suggest CTAs',
    'Create sales talking points',
    'Generate graphic briefs',
    'Recommend edits for clarity and tone'
  ],
  aiMayNot: [
    'Invent statistics or ROI claims',
    'Publish without human approval',
    'Use unapproved brand claims',
    'Make legal or compliance guarantees',
    'Alter the core meaning of the source article',
    'Use confidential client information unless authorized'
  ],
  colors: {
    deepNavy: '#102A43',
    oneDigitalBlue: '#1F6FEB',
    skyBlue: '#DCEBFF',
    softGray: '#F5F7FA',
    charcoalText: '#1F2933',
    white: '#FFFFFF',
    successGreen: '#2E7D32',
    warningAmber: '#F5A623',
    errorRed: '#C62828'
  }
} as const;

export const CHANNEL_GUIDE: Record<FormatId, {
  tone: string;
  goal: string;
  format: string;
  avoid: string;
}> = {
  linkedin: {
    tone: 'Professional, thoughtful, insight-led.',
    goal: 'Start a business conversation.',
    format: 'Strong opening hook, short paragraphs, practical takeaway, soft CTA.',
    avoid: 'Hashtag-heavy or overly casual language.'
  },
  twitter: {
    tone: 'Punchy, direct, skimmable.',
    goal: 'Break a larger idea into a clear thread.',
    format: 'Numbered posts, one idea per post, concise wording, final CTA.',
    avoid: 'Dense paragraphs or unsupported claims.'
  },
  email: {
    tone: 'Helpful, concise, executive-friendly.',
    goal: 'Encourage the reader to click or take action.',
    format: 'Subject line, preview text, short body, CTA.',
    avoid: 'Long introductions or generic marketing copy.'
  },
  roiOnePager: {
    tone: 'Clear, business-focused, value-driven.',
    goal: 'Help sales teams explain the issue and start client conversations.',
    format: 'Pain points, why it matters, ROI/value bullets, discovery questions, talking points.',
    avoid: 'Fluffy thought leadership without practical sales use.'
  },
  instagram: {
    tone: 'Simple, visual, accessible.',
    goal: 'Communicate one core idea quickly.',
    format: 'Short headline, supporting phrase, caption, alt text, visual direction.',
    avoid: 'Too much text in the graphic.'
  },
  internal: {
    tone: 'Clear, useful, action-oriented.',
    goal: 'Help internal teams understand what was published and how to use it.',
    format: 'Summary, key message, audience, suggested use, link/CTA.',
    avoid: 'Long marketing copy.'
  }
};

/**
 * Compact brand brief injected into every LLM system prompt so the model
 * follows OneDigital voice without re-stating the full guidelines each call.
 */
export function brandSystemPreamble(formatId?: FormatId): string {
  const ch = formatId ? CHANNEL_GUIDE[formatId] : undefined;
  const lines = [
    `You are writing as ${BRAND.name}.`,
    `Brand promise: ${BRAND.promise}`,
    `Audience: ${BRAND.audience}`,
    `Voice: ${BRAND.voice}`,
    `Tone rules: ${BRAND.tone.join(' ')}`,
    `Prefer these phrases when natural: ${BRAND.preferredPhrases.join(', ')}.`,
    `NEVER use these phrases or claims: ${BRAND.avoidedPhrases.join('; ')}.`,
    `Approved CTA examples (pick one or stay close in spirit): ${BRAND.approvedCTAs.join(' | ')}`,
    'Do not invent statistics, ROI numbers, client names, or compliance guarantees. ' +
      'If the source does not support a claim, omit it.'
  ];
  if (ch) {
    lines.push(
      `Channel guidance — Tone: ${ch.tone} Goal: ${ch.goal} Format: ${ch.format} Avoid: ${ch.avoid}`
    );
  }
  return lines.join('\n');
}

/** Returns the list of avoided phrases that appear in the given text. */
export function findAvoidedPhrases(body: string): string[] {
  const lower = body.toLowerCase();
  return BRAND.avoidedPhrases.filter((p) => lower.includes(p.toLowerCase()));
}

/** Counts how many preferred brand phrases appear in the text. */
export function countPreferredPhrases(body: string): number {
  const lower = body.toLowerCase();
  return BRAND.preferredPhrases.reduce(
    (n, p) => (lower.includes(p.toLowerCase()) ? n + 1 : n),
    0
  );
}

/** True if the body contains at least one approved (or approved-like) CTA. */
export function hasApprovedCTA(body: string): boolean {
  const lower = body.toLowerCase();
  if (BRAND.approvedCTAs.some((c) => lower.includes(c.toLowerCase()))) return true;
  // Loosened match: a CTA-shaped sentence using brand-aligned verbs is OK.
  return /(talk with an advisor|build a more resilient|workforce planning|connected hr strategy|prepare your organization)/i.test(
    body
  );
}

/**
 * Detect numeric or quantitative claims in the body that are NOT present in
 * the source. This is the core "no invented stats" check.
 */
export function findUnsupportedNumbers(body: string, source: string): string[] {
  const claims: string[] = [];
  const numberRegex = /(\$\s?\d[\d,.]*\s?[mbk]?|\d+(?:\.\d+)?\s?%|\d+x|\d+(?:\.\d+)?\s?(?:hours|days|weeks|months|years))/gi;
  const matches = body.match(numberRegex) ?? [];
  const sourceLower = source.toLowerCase();
  for (const raw of matches) {
    const norm = raw.replace(/\s+/g, '').toLowerCase();
    if (!sourceLower.replace(/\s+/g, '').includes(norm)) {
      if (!claims.includes(raw)) claims.push(raw);
    }
  }
  return claims;
}
