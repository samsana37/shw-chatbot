require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // Ensure this is installed in package.json

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ===== 🔧 Environment & Config =====
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions';

// Auto-detect Vercel domain for Referer header
const APP_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.APP_URL || 'http://localhost:3000';

// ===== 🧠 AI Model & System Prompt =====
const MODEL = 'nvidia/nemotron-nano-9b-v2:free';
const SYSTEM_PROMPT = `You are a helpful, friendly, and knowledgeable AI assistant. 
You provide clear, concise, and accurate responses. You're conversational but professional.
You can help with a wide variety of topics including general knowledge, coding, writing, analysis, and more.`;

// ===== 💬 Memory & Rate Limit Handling =====
const conversationHistories = new Map();
const requestTimes = new Map();
const MIN_REQUEST_INTERVAL = 1000;

// ===== 🚀 Chat Endpoint =====
app.post('/api/chat', async (req, res) => {
  const { message, sessionId = 'default' } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  const now = Date.now();
  const lastRequest = requestTimes.get(sessionId) || 0;
  const elapsed = now - lastRequest;
  if (elapsed < MIN_REQUEST_INTERVAL) {
    const wait = Math.ceil((MIN_REQUEST_INTERVAL - elapsed) / 1000);
    return res.status(429).json({ error: `Please wait ${wait}s before next message.` });
  }
  requestTimes.set(sessionId, now);

  try {
    // Conversation context
    if (!conversationHistories.has(sessionId)) {
      conversationHistories.set(sessionId, [{ role: 'system', content: SYSTEM_PROMPT }]);
    }
    const history = conversationHistories.get(sessionId);
    history.push({ role: 'user', content: message });
    if (history.length > 21) history.splice(1, history.length - 21);

    console.log(`📤 Sending request to OpenRouter (${MODEL})`);

    // Fetch from OpenRouter
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

    const responseText = await response.text();
    console.log(`📥 OpenRouter status: ${response.status}`);

    if (!response.ok) {
      let errorData;
      try { errorData = JSON.parse(responseText); } 
      catch { throw new Error(`HTTP ${response.status}: ${responseText}`); }
      const errorMessage = errorData.error?.message || errorData.message || 'Unknown error';
      throw new Error(errorMessage);
    }

    const data = JSON.parse(responseText);
    const reply = data.choices?.[0]?.message?.content;
    if (!reply) throw new Error('Invalid response from OpenRouter');

    history.push({ role: 'assistant', content: reply });

    res.json({ reply, model: MODEL, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('❌ Chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===== 🧹 Clear, Health & Test Routes =====
app.post('/api/clear', (req, res) => {
  const { sessionId = 'default' } = req.body;
  conversationHistories.delete(sessionId);
  requestTimes.delete(sessionId);
  res.json({ message: 'Conversation cleared' });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    openrouterConfigured: !!OPENROUTER_API_KEY,
    model: MODEL,
    apiKey: OPENROUTER_API_KEY ? OPENROUTER_API_KEY.slice(0, 8) + '...' : 'Not set',
  });
});

app.get('/api/test-key', async (req, res) => {
  try {
    const r = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}` }
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

// ===== ✅ Start Server =====
app.listen(PORT, () => {
  console.log(`🚀 Server ready on port ${PORT}`);
  console.log(`📍 Live URL: ${APP_URL}`);
});