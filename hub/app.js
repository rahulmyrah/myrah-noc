/* ═══════════════════════════════════════════════════════════════════════════
   Myrah NOC Hub — app.js
   Loads config → fetches live data → renders all panels → auto-refreshes
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict'

// ── State ────────────────────────────────────────────────────────────────────
let CFG = null          // client.config.json contents
let REFRESH_TIMER = null

// ── 1. Boot ──────────────────────────────────────────────────────────────────
;(async function boot() {
  CFG = await loadConfig()
  applyBranding(CFG)
  initClock()
  await refreshAll()
  REFRESH_TIMER = setInterval(refreshAll, 30_000)  // re-fetch every 30s
})()

// ── 2. Config ────────────────────────────────────────────────────────────────
async function loadConfig() {
  try {
    const res = await fetch('/api/config')
    if (!res.ok) throw new Error('config fetch failed: ' + res.status)
    return await res.json()
  } catch (e) {
    console.warn('[hub] config fetch failed, using defaults', e)
    return {
      brand: { name: 'NOC Hub', tagline: 'Operations Centre', logoUrl: '/assets/logo.svg' },
      theme: { accentHex: '#6366f1', accentHexLight: '#818cf8', accentHexDim: 'rgba(99,102,241,0.15)' },
      locale: { currencySymbol: '£', timezone: 'Europe/London' },
      sections: [],
      budget: { monthly: 5000, currencySymbol: '£' },
      links: { alertConfig: '/proxy/uptime-kuma', docs: '/docs/' },
      features: { showCostPanel: true, showNetworkPanel: true, showAiAssistant: true }
    }
  }
}

function applyBranding(cfg) {
  document.title = (cfg.brand?.name || 'NOC Hub') + ' — NOC'
  document.getElementById('brand-name').textContent    = cfg.brand?.name    || 'NOC Hub'
  document.getElementById('brand-tagline').textContent = cfg.brand?.tagline || 'Operations Centre'
  document.getElementById('brand-logo').src            = cfg.brand?.logoUrl || '/assets/logo.svg'
  document.getElementById('configure-alerts-btn').href = cfg.links?.alertConfig || '/proxy/uptime-kuma'

  // Apply accent colour from config
  if (cfg.theme?.accentHex) {
    const r = document.documentElement.style
    r.setProperty('--accent',       cfg.theme.accentHex)
    r.setProperty('--accent-light', cfg.theme.accentHexLight || cfg.theme.accentHex)
    r.setProperty('--accent-dim',   cfg.theme.accentHexDim   || 'rgba(99,102,241,0.15)')
  }

  // Hide AI assistant if disabled in config
  if (cfg.features?.showAiAssistant === false) {
    const fab   = document.getElementById('ai-fab')
    const panel = document.getElementById('ai-panel')
    if (fab)   fab.style.display   = 'none'
    if (panel) panel.style.display = 'none'
  }
}

// ── 3. Clock ─────────────────────────────────────────────────────────────────
function initClock() {
  const tz = CFG?.locale?.timezone || 'Europe/London'
  function tick() {
    const el = document.getElementById('header-clock')
    if (el) el.textContent = new Date().toLocaleTimeString('en-GB', { timeZone: tz, hour12: false })
  }
  tick()
  setInterval(tick, 1000)
}

// ── 4. Refresh all panels ────────────────────────────────────────────────────
async function refreshAll() {
  const [ukResult, amResult] = await Promise.allSettled([
    fetchUptimeKumaMonitors(),
    fetchAlertmanagerAlerts(),
  ])
  const monitorList = ukResult.status === 'fulfilled' ? ukResult.value : []
  const alertList   = amResult.status === 'fulfilled' ? amResult.value : []

  renderServicesGrid(monitorList, CFG?.sections || [])
  renderAlerts(alertList)
  renderKpis(monitorList, alertList)
  renderCostPanel(CFG?.budget || {})
  renderNetworkPanel(monitorList)

  const el = document.getElementById('footer-refresh')
  if (el) el.textContent = 'Last refresh: ' + new Date().toLocaleTimeString('en-GB', { hour12: false })
}

// ── 5. Uptime Kuma REST API ───────────────────────────────────────────────────
// Uses the public /api/status-page/all endpoint — no auth required for public pages
async function fetchUptimeKumaMonitors() {
  try {
    const res = await fetch('/proxy/uptime-kuma/api/status-page/all', {
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) throw new Error('Uptime Kuma returned ' + res.status)
    const data = await res.json()
    const monitors = []
    for (const group of (data.publicGroupList || [])) {
      for (const m of (group.monitorList || [])) {
        monitors.push({
          id:     m.id,
          name:   m.name,
          type:   m.type,
          url:    m.url || '',
          tags:   (m.tags || []).map(t => (typeof t === 'string' ? t : t.name || '').toLowerCase()),
          status: m.active
            ? (m.heartbeat?.status === 1 ? 'up' : m.heartbeat?.status === 0 ? 'down' : 'pending')
            : 'inactive',
          ping: m.heartbeat?.ping ?? null,
        })
      }
    }
    return monitors
  } catch (err) {
    console.warn('[hub] Uptime Kuma fetch failed:', err.message)
    return []
  }
}

// ── 6. Alertmanager REST API ──────────────────────────────────────────────────
async function fetchAlertmanagerAlerts() {
  try {
    const res = await fetch('/proxy/alertmanager/api/v2/alerts?active=true&silenced=false', {
      signal: AbortSignal.timeout(5000)
    })
    if (!res.ok) throw new Error('Alertmanager returned ' + res.status)
    const data = await res.json()
    return (data || []).map(a => ({
      name:        a.labels?.alertname   || 'Unknown Alert',
      severity:    a.labels?.severity    || 'info',
      instance:    a.labels?.instance    || a.labels?.job || '',
      summary:     a.annotations?.summary     || '',
      description: a.annotations?.description || '',
      startsAt:    a.startsAt,
    }))
  } catch (err) {
    console.warn('[hub] Alertmanager fetch failed:', err.message)
    return []
  }
}

// ── 7. Services Grid ──────────────────────────────────────────────────────────
function renderServicesGrid(monitorList, sections) {
  const grid = document.getElementById('sections-grid')
  if (!grid) return

  if (!sections.length) {
    grid.innerHTML = '<div class="empty-state">No sections configured in client.config.json</div>'
    return
  }

  grid.innerHTML = sections.map(sec => {
    const matching = monitorList.filter(m =>
      sec.monitorTags.some(tag => m.tags.includes(tag.toLowerCase()))
    )
    // Fallback: if first section has no tag matches, show all monitors
    const items = matching.length > 0 ? matching
      : (sec.id === sections[0].id && monitorList.length > 0 ? monitorList : [])

    const downCount = items.filter(m => m.status === 'down').length
    const allUp     = items.length > 0 && downCount === 0
    const panelClass = downCount > 0 ? 'crit' : allUp ? 'ok' : 'warn'

    const badge = items.length === 0
      ? '<span class="panel-badge badge-grey">NO MONITORS</span>'
      : downCount > 0
        ? `<span class="panel-badge badge-red">${downCount} DOWN</span>`
        : `<span class="panel-badge badge-green">${items.length}/${items.length} UP</span>`

    const chips = items.length === 0
      ? `<span style="font-size:0.65rem;color:var(--text-muted);padding:0.3rem">Tag monitors: ${sec.monitorTags.join(', ')}</span>`
      : items.map(m => {
          const dotClass = m.status === 'up' ? 'up' : m.status === 'down' ? 'down' : 'warn'
          return `<span class="chip"><span class="chip-dot ${dotClass}"></span>${escHtml(m.name)}</span>`
        }).join('')

    return `
      <div class="section-panel ${panelClass}">
        <div class="section-hdr">
          <div class="section-icon-label">${sec.icon} ${escHtml(sec.label)}</div>
          ${badge}
        </div>
        <div class="section-chips">${chips}</div>
      </div>`
  }).join('')
}

// ── 8. Alerts feed ────────────────────────────────────────────────────────────
function renderAlerts(alertList) {
  const list  = document.getElementById('alert-list')
  const badge = document.getElementById('alerts-count-badge')
  if (!list || !badge) return

  if (!alertList.length) {
    list.innerHTML    = '<div class="empty-state">✅ No active alerts</div>'
    badge.className   = 'panel-badge badge-green'
    badge.textContent = 'ALL CLEAR'
    return
  }

  badge.className   = 'panel-badge badge-red'
  badge.textContent = alertList.length + ' ACTIVE'

  const sevOrder = { critical: 0, warning: 1, info: 2 }
  const sorted = [...alertList].sort((a, b) =>
    (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3)
  )

  list.innerHTML = sorted.slice(0, 15).map(a => {
    const sevClass = a.severity === 'critical' ? 'crit'
      : a.severity === 'warning' ? 'warn' : 'info'
    const ageStr = a.startsAt ? relativeTime(new Date(a.startsAt)) : ''
    return `<div class="alert-item ${sevClass}">
      <span class="alert-sev ${sevClass}">${a.severity.toUpperCase()}</span>
      <div style="flex:1;min-width:0">
        <div class="alert-name">${escHtml(a.name)}</div>
        ${a.summary ? `<div class="alert-desc">${escHtml(a.summary)}</div>` : ''}
      </div>
      ${ageStr ? `<span class="alert-age">${ageStr}</span>` : ''}
    </div>`
  }).join('')
}

// ── 9. KPI pills ──────────────────────────────────────────────────────────────
function renderKpis(monitorList, alertList) {
  const strip = document.getElementById('kpi-strip')
  if (!strip) return

  const upCount   = monitorList.filter(m => m.status === 'up').length
  const downCount = monitorList.filter(m => m.status === 'down').length
  const critCount = alertList.filter(a => a.severity === 'critical').length
  const total     = monitorList.length

  strip.innerHTML = [
    kpiPill(critCount > 0 ? 'red' : 'green',   critCount > 0,  `${critCount} CRITICAL`),
    kpiPill(downCount > 0 ? 'red' : 'green',   downCount > 0,  `${upCount}/${total} UP`),
    kpiPill('blue', false, `${alertList.length} ALERTS`),
  ].join('')
}

function kpiPill(color, pulse, text) {
  return `<span class="kpi-pill ${color}"><span class="kpi-dot${pulse ? ' pulse' : ''}"></span>${text}</span>`
}

// ── 10. Cost panel ────────────────────────────────────────────────────────────
function renderCostPanel(budget) {
  const sym     = budget.currencySymbol || '£'
  const monthly = budget.monthly        || 5000
  const body    = document.getElementById('cost-body')
  const badge   = document.getElementById('cost-status-badge')
  if (!body || !badge) return

  // Phase 1: static config display. Phase 2 will add Prometheus query for live spend.
  body.innerHTML = `
    <div style="font-size:0.75rem;color:var(--text-secondary);margin-bottom:0.4rem">
      Monthly Budget: <strong style="color:var(--text-primary);font-family:var(--mono)">${sym}${monthly.toLocaleString()}</strong>
    </div>
    <div class="empty-state" style="padding:0.5rem;font-size:0.7rem">
      Connect Azure Metrics Exporter to see live cost data.<br>
      <a href="/docs/azure.html" style="color:var(--accent-light)">Setup guide →</a>
    </div>`
  badge.className   = 'panel-badge badge-grey'
  badge.textContent = 'CONFIG NEEDED'
}

// ── 11. Network panel ─────────────────────────────────────────────────────────
function renderNetworkPanel(monitorList) {
  const body  = document.getElementById('network-body')
  const badge = document.getElementById('network-badge')
  if (!body || !badge) return

  const networkTags = CFG?.sections?.find(s => s.id === 'network')?.monitorTags
    || ['network', 'vpn', 'expressroute', 'firewall']

  const networkMonitors = monitorList.filter(m =>
    networkTags.some(tag => m.tags.includes(tag))
  )

  if (!networkMonitors.length) {
    body.innerHTML    = `<div class="empty-state">Tag monitors with "network" to show here.<br>
      <a href="/docs/sections.html" style="color:var(--accent-light)">How to tag monitors →</a></div>`
    badge.className   = 'panel-badge badge-grey'
    badge.textContent = 'NO DATA'
    return
  }

  const down = networkMonitors.filter(m => m.status === 'down')
  badge.className   = down.length ? 'panel-badge badge-red' : 'panel-badge badge-green'
  badge.textContent = down.length ? `${down.length} ISSUE${down.length > 1 ? 'S' : ''}` : 'ALL OK'

  body.innerHTML = networkMonitors.map(m => {
    const dotClass = m.status === 'up' ? 'up' : m.status === 'down' ? 'down' : 'warn'
    const pingStr  = m.ping != null ? ` · ${m.ping}ms` : ''
    return `<div class="chip" style="margin-bottom:4px;font-size:0.7rem;width:100%;justify-content:space-between">
      <div style="display:flex;align-items:center;gap:0.35rem">
        <span class="chip-dot ${dotClass}"></span>
        <span>${escHtml(m.name)}</span>
      </div>
      <span style="color:var(--text-muted);font-size:0.62rem">${m.status.toUpperCase()}${pingStr}</span>
    </div>`
  }).join('')
}

// ── 12. Utilities ─────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function relativeTime(date) {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diff < 60)    return `${diff}s ago`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
