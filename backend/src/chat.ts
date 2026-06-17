// Krypto's chat "brain" — transport-agnostic.
//
// This owns the OpenAI client, the MCP tool wiring, and the tool-calling loop.
// It knows nothing about HTTP, Discord, or any other channel: callers hand it a
// message history and get back a reply string. Each "front door" (the HTTP
// endpoint today, a Discord adapter later) reuses runChat().
import 'dotenv/config';
import OpenAI from 'openai';
import { buildSystemPrompt } from './agent/context.js';
import { initMemoryMcp, callMemoryTool, type McpTool } from './mcp/client.js';

export const MODEL = process.env.OPENAI_MODEL || 'gpt-5';
const MAX_TOOL_ITERATIONS = 5;

const apiKey = process.env.OPENAI_API_KEY;
export const keyConfigured =
  Boolean(apiKey) && apiKey !== 'your-openai-api-key-here';
const client = keyConfigured ? new OpenAI({ apiKey }) : null;

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

// MCP tools, discovered once at startup and cached here.
let mcpTools: McpTool[] = [];

function toOpenAITools(tools: McpTool[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.inputSchema,
    },
  }));
}

// Connect the memory MCP server and cache its tools. Returns the tool names.
// Call once at process startup.
export async function initChat(): Promise<string[]> {
  mcpTools = await initMemoryMcp();
  return mcpTools.map((t) => t.name);
}

// Names of the currently-available MCP tools (for health/status reporting).
export function getToolNames(): string[] {
  return mcpTools.map((t) => t.name);
}

// Run the chat tool-calling loop over the given history; returns the final
// reply text. Builds Krypto's system prompt internally, so callers pass only
// the conversation turns (user/assistant messages).
export async function runChat(messages: ChatMessage[]): Promise<string> {
  if (!client) {
    throw new Error(
      'OPENAI_API_KEY is not configured. Add your key to backend/.env and restart.'
    );
  }

  const system = await buildSystemPrompt();
  const tools = toOpenAITools(mcpTools);

  // Working transcript: system prompt + caller-supplied turns. We mutate this as
  // the model calls tools and we feed results back in.
  const convo: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    ...messages,
  ];

  let reply = '';
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: convo,
      tools: tools.length ? tools : undefined,
    });

    const msg = completion.choices[0]?.message;
    if (!msg) break;
    convo.push(msg);

    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) {
      reply = msg.content ?? '';
      break;
    }

    // Execute every requested tool call and append the results.
    for (const tc of toolCalls) {
      if (tc.type !== 'function') continue;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        // leave args empty; the tool will surface a validation error
      }
      let toolText: string;
      try {
        toolText = await callMemoryTool(tc.function.name, args);
      } catch (err) {
        toolText = `Tool error: ${err instanceof Error ? err.message : 'unknown'}`;
      }
      convo.push({ role: 'tool', tool_call_id: tc.id, content: toolText });
    }
  }

  return reply;
}
