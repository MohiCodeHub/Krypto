import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import { buildSystemPrompt } from './agent/context.js';
import { initMemoryMcp, callMemoryTool, type McpTool } from './mcp/client.js';

const app = express();

// CORS: if FRONTEND_ORIGIN is set, restrict to that comma-separated list of
// origins. If unset, fall back to fully permissive CORS so local dev is
// unaffected.
const frontendOrigin = process.env.FRONTEND_ORIGIN;
if (frontendOrigin) {
  const allowedOrigins = frontendOrigin
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.use(cors({ origin: allowedOrigins }));
} else {
  app.use(cors());
}

app.use(express.json());

const PORT = Number(process.env.PORT) || 3001;
const MODEL = process.env.OPENAI_MODEL || 'gpt-5';
const MAX_TOOL_ITERATIONS = 5;

const apiKey = process.env.OPENAI_API_KEY;
const keyConfigured =
  Boolean(apiKey) && apiKey !== 'your-openai-api-key-here';
const client = keyConfigured ? new OpenAI({ apiKey }) : null;

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

// MCP tools, discovered once at startup.
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

// Liveness / config check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    model: MODEL,
    keyConfigured,
    tools: mcpTools.map((t) => t.name),
  });
});

// Chat completion against the configured model, with a memory tool-calling loop.
app.post('/api/chat', async (req, res) => {
  if (!client) {
    return res.status(500).json({
      error:
        'OPENAI_API_KEY is not configured. Add your key to backend/.env and restart.',
    });
  }

  const { messages } = (req.body ?? {}) as { messages?: ChatMessage[] };
  if (!Array.isArray(messages) || messages.length === 0) {
    return res
      .status(400)
      .json({ error: 'Request body must include a non-empty "messages" array.' });
  }

  try {
    const system = await buildSystemPrompt();
    const tools = toOpenAITools(mcpTools);

    // Working transcript: system prompt + client-supplied turns. We mutate this as
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

    res.json({ reply });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error.';
    console.error('Chat error:', message);
    res.status(500).json({ error: message });
  }
});

app.listen(PORT, async () => {
  try {
    mcpTools = await initMemoryMcp();
    console.log(`Krypto memory MCP connected: [${mcpTools.map((t) => t.name).join(', ')}]`);
  } catch (err) {
    console.error('Krypto memory MCP failed to connect:', err);
  }
  console.log(
    `Krypto backend listening on http://localhost:${PORT} (model: ${MODEL}, key configured: ${keyConfigured})`
  );
});
