// Krypto memory MCP server.
//
// Exposes a single tool, `remember`, that appends a durable entry to agent/memory.md.
// Runs over stdio and is spawned as a child process by the backend (see ./client.ts).
//
// IMPORTANT: stdout is the JSON-RPC channel for stdio transport. Never write logs to
// stdout here — use stderr (console.error) only.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/mcp -> repo root is three levels up: backend/src/mcp -> backend/src -> backend -> repo
const AGENT_DIR = process.env.KRYPTO_AGENT_DIR || path.resolve(here, '../../../agent');
const MEMORY_FILE = path.join(AGENT_DIR, 'memory.md');

const MEMORY_HEADER = `# Memory

Krypto's persistent, self-authored long-term memory. Entries below are appended
automatically via the \`remember\` tool whenever Krypto learns something durable.
`;

async function appendMemory(content: string): Promise<string> {
  const clean = content.trim();
  if (!clean) throw new Error('Cannot remember empty content.');

  const timestamp = new Date().toISOString();
  const entry = `- [${timestamp}] ${clean}`;

  await fs.mkdir(AGENT_DIR, { recursive: true });

  let existing = '';
  try {
    existing = await fs.readFile(MEMORY_FILE, 'utf8');
  } catch {
    // File doesn't exist yet — start from the standard header.
  }
  if (!existing.trimStart().startsWith('# Memory')) {
    existing = MEMORY_HEADER + existing;
  }

  const separator = existing.endsWith('\n') ? '' : '\n';
  await fs.writeFile(MEMORY_FILE, `${existing}${separator}${entry}\n`, 'utf8');

  return entry;
}

const server = new McpServer({ name: 'krypto-memory', version: '0.1.0' });

server.registerTool(
  'remember',
  {
    title: 'Remember',
    description:
      'Append a durable fact, preference, or detail to your long-term memory (memory.md). ' +
      'Use this when you learn something about the user or your work that should persist ' +
      'across sessions. Write one self-contained statement per call. Do not store transient ' +
      'or trivial details.',
    inputSchema: {
      content: z
        .string()
        .describe('A single, self-contained fact or detail to remember.'),
    },
  },
  async ({ content }) => {
    const saved = await appendMemory(content);
    return { content: [{ type: 'text', text: `Saved to memory:\n${saved}` }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[krypto-memory] connected on stdio; memory file: ${MEMORY_FILE}`);
