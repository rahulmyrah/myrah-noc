/* ═══════════════════════════════════════════════════════════════════════════
   Myrah NOC Hub — AI Assistant Widget
   Connects to POST /api/chat (proxied to hub-api), renders chat UI
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict'

;(function initAiWidget() {
  const fab      = document.getElementById('ai-fab')
  const panel    = document.getElementById('ai-panel')
  const closeBtn = document.getElementById('ai-close')
  const input    = document.getElementById('ai-input')
  const sendBtn  = document.getElementById('ai-send')
  const msgList  = document.getElementById('ai-messages')

  if (!fab || !panel || !closeBtn || !input || !sendBtn || !msgList) return

  // In-memory conversation history (sent to backend for context window)
  const history = []

  // ── Toggle panel ──────────────────────────────────────────────────────────
  fab.addEventListener('click', () => {
    panel.classList.toggle('hidden')
    if (!panel.classList.contains('hidden')) input.focus()
  })
  closeBtn.addEventListener('click', () => panel.classList.add('hidden'))

  // Close on Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !panel.classList.contains('hidden')) {
      panel.classList.add('hidden')
    }
  })

  // ── Send on button click or Enter ─────────────────────────────────────────
  sendBtn.addEventListener('click', sendMessage)
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  })

  async function sendMessage() {
    const text = input.value.trim()
    if (!text) return

    input.value      = ''
    input.disabled   = true
    sendBtn.disabled = true

    // Add to history and render user bubble
    history.push({ role: 'user', content: text })
    appendMsg('user', escHtml(text))

    // Show typing indicator
    const typingEl = appendMsg('bot', '<span class="ai-typing">Thinking…</span>')

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)

      const data  = await res.json()
      const reply = data.reply || 'No response.'

      history.push({ role: 'assistant', content: reply })
      typingEl.innerHTML = formatReply(reply)
    } catch (err) {
      console.error('[ai-widget]', err)
      if (err.name === 'TimeoutError') {
        typingEl.innerHTML = 'Request timed out. The AI service may be slow — please try again.'
      } else {
        typingEl.innerHTML = 'Connection error. Check that the NOC Hub API is running. ' +
          '<a href="/docs/getting-started.html">Setup guide →</a>'
      }
    } finally {
      input.disabled   = false
      sendBtn.disabled = false
      input.focus()
    }
    scrollToBottom()
  }

  // ── DOM helpers ───────────────────────────────────────────────────────────
  function appendMsg(role, html) {
    const div = document.createElement('div')
    div.className = 'ai-msg ' + role
    div.innerHTML = html
    msgList.appendChild(div)
    scrollToBottom()
    return div
  }

  function scrollToBottom() {
    msgList.scrollTop = msgList.scrollHeight
  }

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  // Convert **bold**, `code`, and [text](url) markdown to HTML
  function formatReply(text) {
    return escHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code style="background:var(--surface-3);padding:1px 4px;border-radius:3px;font-family:var(--mono);font-size:0.85em">$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\[([^\]]+)\]\((\/(docs|proxy|api)[^)]*)\)/g, '<a href="$2">$1</a>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>')
  }
})()
