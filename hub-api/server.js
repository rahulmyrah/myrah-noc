'use strict'

require('dotenv').config()
const express = require('express')
const cors    = require('cors')
const axios   = require('axios')
const buildSystemPrompt = require('./system-prompt')

const app  = express()
const PORT = parseInt(process.env.PORT || '4001', 10)

app.use(cors({ origin: '*' }))
app.use(express.json({ limit: '16kb' }))

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }))

// ── Load client config so system prompt is personalised ───────────────────────
let clientConfig = {}
;(async () => {
  try {
    // noc-hub nginx serves config at port 4000 (same Docker network)
    const res = await axios.get('http://noc-hub:4000/api/config', { timeout: 3000 })
    clientConfig = res.data
    console.log('[hub-api] client config loaded:', clientConfig?.brand?.name || '(unnamed)')
  } catch (e) {
    console.warn('[hub-api] could not load client config from noc-hub:', e.message)
    console.warn('[hub-api] using generic system prompt')
  }
})()

// ── POST /chat ────────────────────────────────────────────────────────────────
// Body: { messages: [ { role: "user"|"assistant", content: "..." } ] }
// Response: { reply: "..." }
app.post('/chat', async (req, res) => {
  const { messages } = req.body || {}
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' })
  }

  // Sanitise: only allow user + assistant roles, cap length
  const history = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-10)
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 1000) }))

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return res.json({
      reply: 'AI assistant is not configured — OPENAI_API_KEY is missing from .env. ' +
             'See /docs/ai-assistant.html for setup instructions.'
    })
  }

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: buildSystemPrompt(clientConfig) },
          ...history,
        ],
        max_tokens: 500,
        temperature: 0.4,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 25_000,
      }
    )
    const reply = response.data.choices?.[0]?.message?.content?.trim() || 'No response from AI.'
    res.json({ reply })
  } catch (err) {
    const status = err.response?.status
    console.error('[hub-api] OpenAI error:', status, err.response?.data?.error?.message || err.message)

    if (status === 429) {
      return res.json({ reply: 'The AI assistant is temporarily rate-limited. Please try again in a moment.' })
    }
    if (status === 401) {
      return res.json({ reply: 'Invalid OpenAI API key. Check OPENAI_API_KEY in the server .env file.' })
    }
    res.json({ reply: 'Sorry, I encountered an error. Please try again.' })
  }
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[hub-api] listening on :${PORT}`)
})
