// MCP client for the backend. Spawns the memory MCP server over stdio and exposes
// its tools to the chat agent loop.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type McpTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

const selfPath = fileURLToPath(import.meta.url);
const here = path.dirname(selfPath);
// In dev we run via tsx (.ts files); in a compiled build we run .js via plain node.
const isTs = selfPath.endsWith('.ts');
const SERVER_PATH = path.resolve(here, isTs ? 'memory-server.ts' : 'memory-server.js');

let client: Client | null = null;
let cachedTools: McpTool[] = [];

export async function initMemoryMcp(): Promise<McpTool[]> {
  if (client) return cachedTools;

  const transport = new StdioClientTransport({
    command: process.execPath, // node
    args: isTs ? ['--import', 'tsx', SERVER_PATH] : [SERVER_PATH],
  });

  const c = new Client({ name: 'krypto-backend', version: '0.1.0' });
  await c.connect(transport);

  const { tools } = await c.listTools();
  client = c;
  cachedTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: (t.inputSchema as Record<string, unknown>) ?? {
      type: 'object',
      properties: {},
    },
  }));
  return cachedTools;
}

export async function callMemoryTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  if (!client) throw new Error('MCP client not initialized.');
  const result = await client.callTool({ name, arguments: args });
  const parts = Array.isArray(result.content) ? result.content : [];
  const text = parts
    .filter((p): p is { type: 'text'; text: string } => p?.type === 'text')
    .map((p) => p.text)
    .join('\n');
  return text || '(no output)';
}
