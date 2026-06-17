import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import {
  runChat,
  initChat,
  getToolNames,
  keyConfigured,
  MODEL,
  type ChatMessage,
} from './chat.js';

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

// Liveness / config check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    model: MODEL,
    keyConfigured,
    tools: getToolNames(),
  });
});

// HTTP front door into the chat brain. Validates the request, then delegates to
// runChat(); the same brain is reused by other channels (e.g. a Discord adapter).
app.post('/api/chat', async (req, res) => {
  if (!keyConfigured) {
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
    const reply = await runChat(messages);
    res.json({ reply });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error.';
    console.error('Chat error:', message);
    res.status(500).json({ error: message });
  }
});

app.listen(PORT, async () => {
  try {
    const tools = await initChat();
    console.log(`Krypto memory MCP connected: [${tools.join(', ')}]`);
  } catch (err) {
    console.error('Krypto memory MCP failed to connect:', err);
  }
  console.log(
    `Krypto backend listening on http://localhost:${PORT} (model: ${MODEL}, key configured: ${keyConfigured})`
  );
});
