// Chaddy — conversational OneDigital marketing strategist that drafts source
// content the user can hand off to the agent pipeline.
import { LLMProvider, MockLLMProvider } from './llm';
import { brandSystemPreamble, BRAND } from './brand';

export interface ChaddyMessage {
  id: string;
  role: 'user' | 'chaddy';
  content: string;
  timestamp: number;
}

const SYSTEM = brandSystemPreamble() + '\n\n' +
  'You are **Chaddy**, a senior ' + BRAND.name + ' marketing strategist. ' +
  'You chat with the marketing team to help them develop long-form source ' +
  'content (blog posts, thought-leadership pieces, advisor letters) that the ' +
  'downstream agent pipeline can repurpose into every channel. Stay on-brand, ' +
  'be practical, and offer drafts, outlines, and angles the user can hand off.';

export async function askChaddy(
  history: ChaddyMessage[],
  userMessage: string,
  provider: LLMProvider = new MockLLMProvider()
): Promise<string> {
  const transcript = history
    .map((m) => (m.role === 'user' ? `USER: ${m.content}` : `CHADDY: ${m.content}`))
    .join('\n\n');
  const user =
    (transcript ? `<HISTORY>\n${transcript}\n</HISTORY>\n\n` : '') +
    `<LATEST>${userMessage}</LATEST>`;
  const res = await provider.complete<string>({ system: SYSTEM, user });
  return typeof res.content === 'string' ? res.content : String(res.content);
}
