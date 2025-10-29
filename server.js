// ===== 🔧 Environment Setup =====
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3000;

// ===== ⚙️ Config =====
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'nvidia/nemotron-nano-9b-v2:free';

// Auto-detect deployment URL (important for Vercel)
const APP_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.APP_URL || 'http://localhost:3000';

const SYSTEM_PROMPT = `You are a helpful, friendly, and knowledgeable AI assistant. 
You provide clear, concise, and accurate responses. You're conversational but professional.`;

// ===== 💬 Memory & Rate Limit =====
const conversationHistories = new Map();
const requestTimes = new Map();
const MIN_REQUEST_INTERVAL = 1000;

// ===== 🌐 Middleware =====
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ===== 🚀 Chat Endpoint =====
app.post('/api/chat', async (req, res) => {
  const { message, sessionId = 'default' } = req.body;

  if (!message) return res.status(400).json({ error: 'Message is required' });

  // Basic rate limiting
  const now = Date.now();
  const last = requestTimes.get(sessionId) || 0;
  if (now - last < MIN_REQUEST_INTERVAL) {
    return res.status(429).json({ error: 'Please wait 1s between messages.' });
  }
  requestTimes.set(sessionId, now);

  try {
    // Conversation memory
    if (!conversationHistories.has(sessionId)) {
      conversationHistories.set(sessionId, [{ role: 'system', content: SYSTEM_PROMPT }]);
    }
    const history = conversationHistories.get(sessionId);
    history.push({ role: 'user', content: message });
    if (history.length > 21) history.splice(1, history.length - 21);

    console.log(`📤 Sending request to OpenRouter → ${MODEL}`);

    // Call OpenRouter API
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': APP_URL,
        'X-Title': 'AI Chatbot'
      },
      body: JSON.stringify({
        model: MODEL,
        messages: history,
        temperature: 0.7,
        max_tokens: 500
      })
    });

    const text = await response.text();
    if (!response.ok) {
      console.error('❌ OpenRouter error:', text);
      return res.status(response.status).json({ error: text });
    }

    const data = JSON.parse(text);
    const reply = data.choices?.[0]?.message?.content || 'No response from model.';
    history.push({ role: 'assistant', content: reply });

    res.json({ reply, model: MODEL, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('❌ Chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===== 🧹 Utility Endpoints =====
app.post('/api/clear', (req, res) => {
  const { sessionId = 'default' } = req.body;
  conversationHistories.delete(sessionId);
  requestTimes.delete(sessionId);
  res.json({ message: 'Conversation cleared' });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Chatbot is running',
    model: MODEL,
    openrouterConfigured: !!OPENROUTER_API_KEY,
    apiKeyPrefix: OPENROUTER_API_KEY ? OPENROUTER_API_KEY.slice(0, 8) + '...' : 'Not set',
  });
});

app.get('/api/test-key', async (req, res) => {
  try {
    const r = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` }
    });
    const data = await r.json();
    res.json({ valid: r.ok, status: r.status, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 🕒 Cleanup Old Sessions =====
setInterval(() => {
  const cutoff = Date.now() - 3600000;
  for (const [id, t] of requestTimes.entries()) {
    if (t < cutoff) {
      requestTimes.delete(id);
      conversationHistories.delete(id);
    }
  }
}, 3600000);

// ===== ✅ Export for Vercel =====
// (Do NOT use app.listen() on Vercel)
module.exports = app;