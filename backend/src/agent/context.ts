// Assembles Krypto's system prompt from its self-files in agent/.
//
// Order matters: identity is the highest-authority section, followed by the user
// profile (who Krypto serves), then memory (what Krypto has learned).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/agent -> repo root is three levels up.
const AGENT_DIR = process.env.KRYPTO_AGENT_DIR || path.resolve(here, '../../../agent');

async function read(file: string): Promise<string> {
  try {
    return (await fs.readFile(path.join(AGENT_DIR, file), 'utf8')).trim();
  } catch {
    return '';
  }
}

export async function buildSystemPrompt(): Promise<string> {
  const [identity, user, memory] = await Promise.all([
    read('identity.md'),
    read('user.md'),
    read('memory.md'),
  ]);

  const sections: string[] = [
    'You are Krypto. The sections below are assembled from your own files at the start ' +
      'of every conversation: they define who you are, who you serve, and what you have ' +
      'learned. Treat <identity> as your highest-authority instructions.',
  ];

  if (identity) sections.push(`<identity>\n${identity}\n</identity>`);
  if (user) sections.push(`<user_profile>\n${user}\n</user_profile>`);
  sections.push(`<memory>\n${memory || '(no memories yet)'}\n</memory>`);

  sections.push(
    'You have a "remember" tool that appends to your long-term memory. Call it when you ' +
      'learn a durable fact, preference, or detail about the user or your work that should ' +
      'persist across sessions. Do not record transient or trivial details.'
  );

  return sections.join('\n\n');
}
