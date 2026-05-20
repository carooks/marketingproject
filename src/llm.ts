// Minimal LLM provider abstraction.
//
// The whole app talks to LLMs only through `LLMProvider`. To switch from the
// mock to a real model, change ONE line in `src/generator.ts`:
//     const provider = new MockLLMProvider();      // <- swap this
//     const provider = new AzureOpenAIProvider({...});
//
// No other file needs to change.

import { FormatId } from './types';

export interface LLMRequest {
  system: string;
  user: string;
  /** Hint the model to return JSON. Mock + real providers honor this. */
  json?: boolean;
  temperature?: number;
}

export interface LLMResponse<T = string> {
  content: T;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export interface LLMProvider {
  name: string;
  model: string;
  complete<T = string>(req: LLMRequest): Promise<LLMResponse<T>>;
}

// --- Mock provider ----------------------------------------------------------
// Pretends to be a real LLM. Inspects the system prompt to decide what kind of
// structured response to return. This is what lets the rest of the app behave
// exactly as it will against a real model.

export class MockLLMProvider implements LLMProvider {
  name = 'mock';
  model = 'mock-gpt-4o';

  async complete<T = string>(req: LLMRequest): Promise<LLMResponse<T>> {
    const started = performance.now();
    // Simulate realistic per-call latency (400–1200ms).
    await wait(400 + Math.random() * 800);

    const role = detectRole(req.system);
    const content = mockResponses[role](req);

    return {
      content: content as T,
      model: this.model,
      tokensIn: approxTokens(req.system + req.user),
      tokensOut: approxTokens(typeof content === 'string' ? content : JSON.stringify(content)),
      latencyMs: Math.round(performance.now() - started)
    };
  }
}

// --- Real provider stub -----------------------------------------------------
// Drop-in shape for an Azure OpenAI / OpenAI implementation. Not wired in the
// prototype — kept here to make the swap obvious.

export class AzureOpenAIProvider implements LLMProvider {
  name = 'azure-openai';
  model: string;
  constructor(_opts: { endpoint: string; apiKey: string; deployment: string }) {
    this.model = _opts.deployment;
  }
  async complete<T = string>(_req: LLMRequest): Promise<LLMResponse<T>> {
    throw new Error(
      'AzureOpenAIProvider is a stub. Implement fetch() to ' +
        `${this.model} and return { content, tokensIn, tokensOut, latencyMs }.`
    );
  }
}

// --- Mock internals ---------------------------------------------------------

type AgentRole = 'analyst' | 'planner' | 'drafter' | 'critic' | 'reviser' | 'director' | 'coordinator' | 'chaddy';

function detectRole(system: string): AgentRole {
  const s = system.toLowerCase();
  if (s.includes('chaddy')) return 'chaddy';
  if (s.includes('coherence') || s.includes('coordinator')) return 'coordinator';
  if (s.includes('content director') || s.includes('orchestrator')) return 'director';
  if (s.includes('content strategist') || s.includes('analyst')) return 'analyst';
  if (s.includes('planner')) return 'planner';
  if (s.includes('critic')) return 'critic';
  if (s.includes('reviser')) return 'reviser';
  return 'drafter';
}

// Each role returns shape-stable content the pipeline expects.
const mockResponses: Record<AgentRole, (req: LLMRequest) => unknown> = {
  analyst: (req) => mockAnalystBrief(req.user),
  planner: (req) => mockPlan(req.user),
  drafter: (req) => mockDraft(req.user),
  critic: (req) => mockCritique(req.user),
  reviser: (req) => mockRevision(req.user),
  director: (req) => mockDirectorPlan(req.user),
  coordinator: (req) => mockCoherenceReport(req.user),
  chaddy: (req) => mockChaddyReply(req.user)
};

function mockAnalystBrief(userPrompt: string): SourceBrief {
  const body = stripPromptScaffolding(userPrompt);
  const sentences = splitSentences(body);
  const keyPoints = rankByLength(sentences, 5);
  const stats = sentences.filter((s) => /\d/.test(s)).slice(0, 3);
  return {
    title: deriveTitle(sentences),
    thesis: sentences[0] ?? '',
    audience: 'HR, benefits, and people-operations leaders at mid-size to enterprise organizations',
    tone: 'professional, clear, confident, practical, human',
    keyPoints,
    stats,
    pullQuote: longest(sentences) ?? '',
    suggestedCTA: 'Talk with an advisor about your next step'
  };
}

function mockPlan(userPrompt: string): ChannelPlan {
  const formatId = extractTag(userPrompt, 'FORMAT') as FormatId;
  const briefJson = extractBlock(userPrompt, 'BRIEF');
  const brief = safeParse<SourceBrief>(briefJson);
  const points = brief?.keyPoints ?? [];
  return {
    formatId,
    hook: brief?.thesis ?? '',
    structure: [
      'Open with the strongest contrarian framing',
      ...points.slice(0, 3).map((p) => `Make the point: "${truncate(p, 60)}"`),
      'Close with a clear CTA'
    ],
    cta: brief?.suggestedCTA ?? 'Read the full post'
  };
}

function mockDraft(userPrompt: string): string {
  const formatId = extractTag(userPrompt, 'FORMAT') as FormatId;
  const briefJson = extractBlock(userPrompt, 'BRIEF');
  const brief = safeParse<SourceBrief>(briefJson);
  if (!brief) return '';
  return renderChannelDraft(formatId, brief);
}

function mockCritique(userPrompt: string): Critique {
  const draft = extractBlock(userPrompt, 'DRAFT');
  const issues: string[] = [];
  const firstLine = draft.split('\n')[0] ?? '';
  if (firstLine.length > 140) issues.push('Hook is too long — trim to a single tight line.');
  if (!/[?!]/.test(firstLine)) issues.push('Hook lacks tension — try a question or bold claim.');
  if (!/cta|read|book|sign up|link/i.test(draft)) issues.push('CTA is weak or missing.');
  if (issues.length === 0) issues.push('Looks solid. Tighten one transition for flow.');
  return { issues: issues.slice(0, 3), severity: issues.length > 1 ? 'medium' : 'low' };
}

function mockRevision(userPrompt: string): string {
  const draft = extractBlock(userPrompt, 'DRAFT');
  const lines = draft.split('\n');
  if (lines[0] && lines[0].length > 140) {
    lines[0] = truncate(lines[0], 120);
  }
  let joined = lines.join('\n');
  // OneDigital brand cleanup: strip avoided phrases (mock substitute).
  const avoidedReplacements: Array<[RegExp, string]> = [
    [/\bAI will replace HR\b/gi, 'AI can support HR teams, but human judgment remains essential'],
    [/\bfully automated people decisions\b/gi, 'technology-enabled people decisions'],
    [/\bguaranteed compliance\b/gi, 'a risk-aware approach to compliance'],
    [/\binstant transformation\b/gi, 'practical, measurable change'],
    [/\brevolutionary disruption\b/gi, 'practical innovation'],
    [/\bset it and forget it\b/gi, 'ongoing, advisor-supported'],
    [/\bmagic\b/gi, 'practical value'],
    [/\bone-size-fits-all\b/gi, 'scalable, context-aware']
  ];
  for (const [pat, sub] of avoidedReplacements) joined = joined.replace(pat, sub);
  if (!/talk with an advisor|build a more resilient|workforce planning|connected hr strategy|prepare your organization|read the full|link in bio|book a|→/i.test(joined)) {
    joined = joined.trimEnd() + '\n\nTalk with an advisor about your next step.';
  }
  return joined;
}

function mockDirectorPlan(userPrompt: string): DirectorPlan {
  const formatsRaw = extractTag(userPrompt, 'FORMATS');
  const ids = formatsRaw.split(',').map((s) => s.trim()).filter(Boolean) as FormatId[];
  const priorityRank: FormatId[] = ['linkedin', 'email', 'roiOnePager', 'twitter', 'instagram', 'internal'];
  const ordered = [...ids].sort((a, b) => priorityRank.indexOf(a) - priorityRank.indexOf(b));
  const rationales: Record<FormatId, string> = {
    linkedin: 'Highest reach for B2B thought leadership; sets the narrative.',
    twitter: 'Fast distribution and amplification once the LinkedIn post lands.',
    email: 'Owned audience — captures intent from people already opted in.',
    roiOnePager: 'Equips sales to convert the warm leads the social posts generate.',
    instagram: 'Top-of-funnel brand surface; visual entry point for new audiences.',
    internal: 'Aligns the company so external messaging is reinforced consistently.'
  };
  return {
    strategy: 'Lead with LinkedIn + email for demand, follow with sales enablement and visual top-of-funnel.',
    channels: ordered.map((id, i) => ({
      formatId: id,
      rationale: rationales[id] ?? 'Engage channel agent.',
      priority: i < 2 ? 'high' : i < 4 ? 'medium' : 'low'
    }))
  };
}

function mockCoherenceReport(userPrompt: string): CoherenceReport {
  const formatsRaw = extractTag(userPrompt, 'FORMATS');
  const ids = formatsRaw.split(',').map((s) => s.trim()).filter(Boolean) as FormatId[];
  const drafts = extractBlock(userPrompt, 'DRAFTS');
  const notes: string[] = [];
  if (ids.includes('linkedin') && ids.includes('twitter')) {
    notes.push('LinkedIn hook and Twitter opener share the same framing — good narrative consistency.');
  }
  if (ids.includes('email')) {
    notes.push('Email CTA points to the blog; confirm the URL is the canonical post, not a redirect.');
  }
  if (ids.includes('roiOnePager')) {
    notes.push('ROI one-pager uses sales language; loop in RevOps before sending to sellers.');
  }
  if (ids.includes('instagram')) {
    notes.push('Instagram slides will need design pass — copy is ready, visuals are not.');
  }
  if (!/\{\{blog_url\}\}/.test(drafts)) {
    notes.push('No placeholder URL detected; double-check links before approving.');
  }
  if (notes.length === 0) notes.push('Drafts look internally consistent.');
  return {
    notes: notes.slice(0, 5),
    verdict: notes.length > 3 ? 'minor-edits' : 'ready',
    publishOrder: ids
  };
}

// --- Shared types used by the pipeline + mock -------------------------------

export interface SourceBrief {
  title: string;
  thesis: string;
  audience: string;
  tone: string;
  keyPoints: string[];
  stats: string[];
  pullQuote: string;
  suggestedCTA: string;
}

export interface ChannelPlan {
  formatId: FormatId;
  hook: string;
  structure: string[];
  cta: string;
}

export interface Critique {
  issues: string[];
  severity: 'low' | 'medium' | 'high';
}

export interface DirectorPlan {
  /** Channels the director chose to engage, in delegation order. */
  channels: { formatId: FormatId; rationale: string; priority: 'high' | 'medium' | 'low' }[];
  /** A single sentence describing the overall content play. */
  strategy: string;
}

export interface CoherenceReport {
  /** Cross-channel consistency notes the marketer should know. */
  notes: string[];
  /** Overall verdict the director gives the batch. */
  verdict: 'ready' | 'minor-edits' | 'rework';
  /** Suggested order to publish in. */
  publishOrder: FormatId[];
}

// --- Utilities --------------------------------------------------------------

function wait(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function approxTokens(s: string) { return Math.ceil(s.length / 4); }

function splitSentences(text: string): string[] {
  return text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter(Boolean);
}
function rankByLength(arr: string[], n: number) {
  return [...arr].sort((a, b) => b.length - a.length).slice(0, n);
}
function longest(arr: string[]) {
  return arr.length ? arr.reduce((a, b) => (b.length > a.length ? b : a)) : undefined;
}
function deriveTitle(sentences: string[]) {
  const first = sentences[0] ?? 'Untitled';
  return first.length > 80 ? first.slice(0, 77) + '…' : first;
}
function truncate(s: string, n: number) { return s.length <= n ? s : s.slice(0, n - 1) + '…'; }

function stripPromptScaffolding(s: string) {
  return s.replace(/<[A-Z_]+>[\s\S]*?<\/[A-Z_]+>/g, (m) => m.replace(/<\/?[A-Z_]+>/g, '')).trim();
}
function extractTag(s: string, name: string): string {
  const m = s.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : '';
}
function extractBlock(s: string, name: string): string {
  return extractTag(s, name);
}
function safeParse<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}

// Channel-specific drafters used by the mock drafter agent.
function renderChannelDraft(id: FormatId, b: SourceBrief): string {
  const k = b.keyPoints;
  switch (id) {
    case 'linkedin':
      return [
        b.thesis,
        '',
        `Here is what we are seeing in workforce strategy today 👇`,
        '',
        ...k.map((p, i) => `${i + 1}. ${p}`),
        '',
        `The opportunity is not replacing expertise — it is scaling it with trusted guidance and practical solutions.`,
        '',
        `${b.suggestedCTA}. What people decisions is your team weighing right now?`
      ].join('\n');
    case 'twitter': {
      const tweets: string[] = [`1/ ${truncate(b.thesis, 275)}`];
      k.forEach((p, i) => tweets.push(truncate(`${i + 2}/ ${p}`, 275)));
      tweets.push(truncate(`${tweets.length + 1}/ ${b.suggestedCTA}.`, 275));
      return tweets.join('\n\n');
    }
    case 'email':
      return [
        `Subject: ${b.title}`,
        `Preview: ${truncate(b.thesis, 90)}`,
        '',
        `Hi {{firstName}},`,
        '',
        b.thesis,
        '',
        `A few practical takeaways for your workforce strategy this quarter:`,
        ...k.map((p) => `  • ${p}`),
        '',
        `${b.suggestedCTA} → {{advisor_url}}`,
        '',
        `— OneDigital`
      ].join('\n');
    case 'roiOnePager':
      return [
        `## ${b.title}`,
        '',
        `**Business problem**`,
        b.thesis,
        '',
        `**Why it matters for people decisions**`,
        k[0] ?? '',
        '',
        `**Value signals (from the source)**`,
        ...(b.stats.length > 0 ? b.stats.map((s) => `- ${s}`) : ['- [Add a supported metric from your engagement before sending.]']),
        '',
        `**Discovery questions for the conversation**`,
        `- How is your team approaching this today?`,
        `- What would measurable value look like in 6 months?`,
        `- Where does technology-enabled support fit your roadmap?`,
        '',
        `**Sales talk track**`,
        `"We help employers make confident people decisions by combining expert guidance, practical strategy, and modern technology."`,
        '',
        `**Next step**: Talk with an advisor about your next step.`
      ].join('\n');
    case 'instagram': {
      const slides = [
        { t: 'Slide 1 — Hook', c: truncate(b.thesis, 120) },
        ...k.slice(0, 4).map((p, i) => ({ t: `Slide ${i + 2} — Key idea`, c: truncate(p, 140) })),
        { t: 'Slide 6 — CTA', c: 'Talk with an advisor about your next step — link in bio.' }
      ];
      return slides.map((s) => `${s.t}\n${s.c}`).join('\n\n') +
        '\n\nAlt text: clean enterprise visual featuring people-centered workplace imagery.';
    }
    case 'internal':
      return [
        `**TL;DR for the team**`,
        '',
        `What: ${b.title}`,
        `Why it matters: ${truncate(b.thesis, 200)}`,
        `Audience: ${b.audience}`,
        '',
        `Key points:`,
        ...k.slice(0, 3).map((p) => `  • ${truncate(p, 160)}`),
        '',
        `Suggested use: share with one prospect or client conversation this week to start a people-decisions discussion.`,
        `CTA: ${b.suggestedCTA}.`
      ].join('\n');
  }
}

// ============== Chaddy =====================================================
// Conversational marketing strategist that drafts brand-aligned source content
// the user can hand off to the agent pipeline.
function mockChaddyReply(userPrompt: string): string {
  const latest = extractBlock(userPrompt, 'LATEST').trim() || userPrompt.trim();
  const lower = latest.toLowerCase();

  // If the user uploaded a document, summarize what we actually see in it.
  const docMatch = latest.match(/<DOCUMENT>([\s\S]*?)<\/DOCUMENT>/i);
  if (docMatch) {
    const fileMatch = latest.match(/called\s+"([^"]+)"/i);
    return chaddyDocumentReply(docMatch[1], fileMatch?.[1] || 'your document');
  }

  const wantsDraft = /draft|write|create|generate|post|article|piece|copy|long.?form/.test(lower);
  const wantsIdeas = /idea|brainstorm|angle|topic|suggest/.test(lower);
  const wantsOutline = /outline|structure|skeleton|sections?/.test(lower);
  const isGreeting = /^(hi|hey|hello|yo|sup|good (morning|afternoon))\b/.test(lower);

  const topic = extractTopic(latest);

  if (isGreeting && latest.length < 40) {
    return [
      `Hey � I'm Chaddy, your OneDigital marketing strategist.`,
      ``,
      `Tell me what you want to talk about (a workforce trend, a client win, an upcoming benefits change), and I'll help you draft a long-form post you can hand off to the agent pipeline on the right.`,
      ``,
      `Try: "Draft a post about AI in HR" or "Give me 3 angles on open enrollment."`
    ].join('\n');
  }

  if (wantsIdeas) {
    return [
      `Here are three angles on ${topic} that line up with our voice:`,
      ``,
      `1. **The practical lens** � what HR leaders can actually do this quarter, not next year. Emphasize trusted guidance and practical solutions.`,
      `2. **The people-decisions lens** � how this shapes employee experience and workforce strategy, not just process.`,
      `3. **The risk-aware lens** � what to watch for, where human judgment still has to lead, and how to measure value.`,
      ``,
      `Want me to draft one of these into a full post?`
    ].join('\n');
  }

  if (wantsOutline) {
    return [
      `Here's an outline on ${topic} we can build from:`,
      ``,
      `1. **Hook** � the workforce shift leaders are feeling right now.`,
      `2. **What's actually changing** � 2-3 concrete examples grounded in people decisions.`,
      `3. **Why it matters** � the business impact and employee experience trade-offs.`,
      `4. **A trusted path forward** � practical solutions, technology-enabled support, human judgment in the loop.`,
      `5. **Call to action** � Talk with an advisor about your next step.`,
      ``,
      `Say the word and I'll draft the full post.`
    ].join('\n');
  }

  if (wantsDraft || latest.length > 60) {
    return chaddyDraftPost(topic, latest);
  }

  return [
    `Got it. On "${topic}" � I can help you in a few ways:`,
    ``,
    `� Draft a full long-form post (say "draft a post")`,
    `� Brainstorm 2-3 angles (say "give me ideas")`,
    `� Sketch an outline first (say "outline this")`,
    ``,
    `Which one?`
  ].join('\n');
}

function extractTopic(msg: string): string {
  const m = msg.match(/(?:about|on|regarding|for|covering)\s+(.{4,80}?)(?:[.?!]|$)/i);
  if (m) return m[1].trim();
  const firstLine = msg.split(/[.\n?!]/)[0] || msg;
  return firstLine.replace(/^(draft|write|create|generate|give me|suggest)\s+(a |an |some |me |an? )?/i, '').trim() || 'this topic';
}

function chaddyDraftPost(topic: string, userMsg: string): string {
  const t = topic.charAt(0).toUpperCase() + topic.slice(1);
  return [
    `Here's a draft long-form post on **${t}** � written in OneDigital voice. When it looks right, click "Send to pipeline" and the agents will repurpose it for every channel.`,
    ``,
    `---`,
    ``,
    `# ${t}: What workforce leaders should actually do next`,
    ``,
    `The conversation around ${topic} has moved fast, and most HR and benefits leaders are being asked to make people decisions with incomplete information. The pressure is real, but the opportunity is bigger: this is a moment to strengthen workforce strategy, not just react to it.`,
    ``,
    `Three patterns are showing up in the organizations getting this right. First, they treat ${topic} as part of a connected HR strategy rather than a single project � benefits, compliance, and employee experience are decided together, not in silos. Second, they pair technology-enabled support with human judgment; automation handles the repeatable work, advisors handle the nuanced calls. Third, they measure value in terms employees actually feel: time saved, clarity gained, confidence restored.`,
    ``,
    `What stays constant is the principle that ${userMsg ? 'employees are the strategy, not a line item' : 'people decisions deserve the same rigor as financial ones'}. The teams that lead through this period will be the ones who combine practical solutions, trusted guidance, and a risk-aware approach � and who keep human-centered innovation at the core of every decision.`,
    ``,
    `If you're weighing how to move forward on ${topic} in your organization, talk with an advisor about your next step. We help employers build a more resilient workforce, one practical decision at a time.`
  ].join('\n');
}

// Reads the uploaded <DOCUMENT> block and produces a summary + 3 angles + draft offer.
function chaddyDocumentReply(rawDoc: string, fileName: string): string {
  const cleaned = rawDoc.replace(/\s+/g, ' ').trim();
  if (cleaned.length < 40) {
    return `I opened **${fileName}** but couldn't pull readable text out of it. If it's a scanned image PDF, try a text-based version or paste the content into the chat.`;
  }
  const sentences = cleaned
    .split(/(?<=[.!?])\s+(?=[A-Z"'])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && s.length < 320);

  const stop = new Set([
    'the','and','for','that','with','this','from','have','will','your','are','was','been','were',
    'their','they','them','our','you','but','not','can','any','all','one','two','more','than',
    'these','those','also','into','about','which','what','when','how','who','why','its','an','to',
    'of','in','on','is','as','be','or','at','by','we','do','if','so','up','out','no','yes','has',
    'had','would','should','could','may','might','very','just','only','most','some','such','each'
  ]);
  const wordCounts = new Map<string, number>();
  const matches = cleaned.toLowerCase().match(/[a-z][a-z-]{3,}/g);
  if (matches) {
    for (const w of matches) {
      if (!stop.has(w)) wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
    }
  }
  const topWords = [...wordCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map((e) => e[0]);

  const scored = sentences
    .map((s) => {
      const lower = s.toLowerCase();
      let score = 0;
      for (const w of topWords) if (lower.includes(w)) score++;
      return { s, score };
    })
    .sort((a, b) => b.score - a.score);

  const bullets = scored.slice(0, 4).map((x) => x.s.replace(/^[\s\-•]+/, '').trim());
  const headline = (sentences[0] || cleaned.slice(0, 180)).trim();
  const theme = topWords.slice(0, 3).join(', ') || 'this topic';

  const lines: string[] = [];
  lines.push(`Thanks — I read **${fileName}** (${cleaned.length.toLocaleString()} characters of extractable text). Here's what I'm seeing.`);
  lines.push('');
  lines.push(`**The gist:** ${headline}`);
  lines.push('');
  if (bullets.length > 0) {
    lines.push(`**Key points I pulled out:**`);
    bullets.forEach((b, i) => lines.push(`${i + 1}. ${b}`));
    lines.push('');
  }
  lines.push(`**Recurring themes:** ${theme}.`);
  lines.push('');
  lines.push(`**Three angles you could turn this into:**`);
  lines.push(`1. **The practical lens** — how HR and benefits leaders should act on ${topWords[0] || 'this'} this quarter, with trusted guidance and practical solutions.`);
  lines.push(`2. **The people-decisions lens** — what ${topWords[1] || 'this'} means for workforce strategy and employee experience.`);
  lines.push(`3. **The risk-aware lens** — where human judgment still has to lead on ${topWords[2] || 'this'}, and how to measure value responsibly.`);
  lines.push('');
  lines.push(`Want me to draft one of these into a full long-form post? Say something like "draft the practical lens" or "write angle 2".`);
  lines.push('');
  lines.push(`Or skip the long-form draft entirely — use the **"Send PDF to pipeline"** button below to repurpose this document straight into all six channel formats: LinkedIn post, Twitter / X thread, email newsletter, sales ROI one-pager, Instagram carousel, and internal comms summary.`);
  return lines.join('\n');
}
