import http from 'http';
import { config } from './config.js';
import { riskManager } from './riskManager.js';
import { proxyManager } from './proxyManager.js';
import { paperTradingEngine } from './paperTrading.js';
import { userDatabase } from './userDatabase.js';
import { eventBus, emitEvent } from './events.js';

import localtunnel from 'localtunnel';

let recentCandidatesRef = [];
let publicBaseUrl = `http://localhost:${config.DASHBOARD_PORT || 3000}`;

export function getDashboardUrl(discordUserId = null) {
  if (!discordUserId) return publicBaseUrl; // Generico
  
  const user = userDatabase.getUserInfo(discordUserId);
  if (!user || !user.dashboardAuthToken) return publicBaseUrl;
  return `${publicBaseUrl}/?token=${user.dashboardAuthToken}`;
}

export function setDashboardCandidates(candidates) {
  recentCandidatesRef = candidates;
}

function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') return unsafe;
  return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
}

function getStats(targetUserId = null) {
  const riskStatus = riskManager.getStatus();
  const portfolios = [];
  
  if (targetUserId) {
    const pf = paperTradingEngine.portfolios.get(targetUserId);
    if (pf) {
      const open = pf.positions ? pf.positions.filter(p => p.status === 'OPEN').length : 0;
      const closed = pf.positions ? pf.positions.filter(p => p.status === 'CLOSED').length : 0;
      portfolios.push({
        userId: targetUserId.slice(0, 6) + '...',
        trialEnabled: pf.trialEnabled,
        balance: pf.paperSolBalance,
        openPositions: open,
        closedPositions: closed
      });
    }
  }

  const livePositions = [];
  if (targetUserId) {
    const user = userDatabase.getUserInfo(targetUserId);
    if (user && user.livePositions && user.livePositions.length > 0) {
      user.livePositions.forEach(p => {
        livePositions.push({
          userId: targetUserId.slice(0, 6) + '...',
          symbol: escapeHtml(p.symbol),
          buyPriceSol: p.buyPriceSol,
          latestPnlPercent: p.latestPnlPercent !== undefined ? p.latestPnlPercent : null
        });
      });
    }
  }

  return {
    uptime: Math.round(process.uptime()),
    dryRun: config.DRY_RUN,
    killSwitch: riskStatus.killSwitchActive,
    killSwitchReason: riskStatus.killSwitchReason || null,
    spentTodaySol: targetUserId ? (userDatabase.getUserInfo(targetUserId)?.spentTodaySol || 0) : riskStatus.spentTodaySol,
    maxSolPerDay: targetUserId ? (userDatabase.getUserInfo(targetUserId)?.maxSolPerDay || 0) : riskStatus.maxSolPerDay,
    activeProxies: proxyManager.workingProxies.length,
    recentCandidates: recentCandidatesRef.slice(-10).map(c => ({
      symbol: escapeHtml(c.symbol),
      name: escapeHtml(c.name),
      chain: escapeHtml(c.chain || 'solana'),
      priceUsd: c.priceUsd,
      liquidityUsd: c.liquidityUsd,
      volume24hUsd: c.volume24hUsd
    })),
    trialPortfolios: portfolios,
    livePositions: livePositions,
    enabledChains: config.ENABLED_CHAINS || ['solana']
  };
}

function renderHTML(stats, isPrivate = false) {
  const candidateRows = stats.recentCandidates.map(c =>
    `<tr><td>${c.symbol}</td><td>${c.name}</td><td><span class="badge">${c.chain}</span></td><td>$${Number(c.priceUsd || 0).toFixed(6)}</td><td>$${Number(c.liquidityUsd || 0).toLocaleString()}</td><td>$${Number(c.volume24hUsd || 0).toLocaleString()}</td></tr>`
  ).join('');

  const portfolioRows = stats.trialPortfolios.map(p =>
    `<tr><td>${p.userId}</td><td><span class="badge ${p.trialEnabled ? 'success' : 'danger'}">${p.trialEnabled ? 'ACTIVE' : 'PAUSED'}</span></td><td class="counter">${p.balance.toFixed(4)}</td><td>${p.openPositions}</td><td>${p.closedPositions}</td></tr>`
  ).join('');
  
  const privateWarning = !isPrivate ? `<div class="alert-private"><b>MODALITÀ PUBBLICA:</b> Stai visualizzando la dashboard globale. Usa il comando Discord per ottenere il tuo link privato.</div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Trading V3 - Command Center</title>
<script src="https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --bg-base: #09090b;
    --bg-surface: #18181b;
    --bg-surface-hover: #27272a;
    --border: #27272a;
    --text-main: #fafafa;
    --text-muted: #a1a1aa;
    
    --accent: #3b82f6;
    --accent-glow: rgba(59, 130, 246, 0.15);
    
    --success: #10b981;
    --success-bg: rgba(16, 185, 129, 0.1);
    --danger: #ef4444;
    --danger-bg: rgba(239, 68, 68, 0.1);
    --warning: #f59e0b;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background-color: var(--bg-base);
    color: var(--text-main);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 2.5rem 5%;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    max-width: 1400px;
    margin: 0 auto;
  }

  h1 {
    font-size: 1.5rem;
    font-weight: 600;
    letter-spacing: -0.025em;
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 2rem;
  }

  h2 {
    font-size: 1rem;
    font-weight: 500;
    color: var(--text-main);
    margin: 2.5rem 0 1rem;
  }

  .font-medium { font-weight: 500; }
  .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  .text-muted { color: var(--text-muted); }
  .text-success { color: var(--success); }
  .text-danger { color: var(--danger); }
  .text-warning { color: var(--warning); }

  .grid-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.5rem;
    transition: all 0.2s ease;
  }

  .card:hover {
    border-color: var(--accent);
    box-shadow: 0 8px 24px -4px var(--accent-glow);
  }

  .card .label {
    font-size: 0.875rem;
    color: var(--text-muted);
    font-weight: 500;
    margin-bottom: 0.5rem;
  }

  .card .value {
    font-size: 1.5rem;
    font-weight: 600;
    letter-spacing: -0.025em;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 500;
    background: var(--bg-surface-hover);
    color: var(--text-main);
  }
  .badge.success { background: var(--success-bg); color: var(--success); border: 1px solid rgba(16,185,129,0.2); }
  .badge.danger { background: var(--danger-bg); color: var(--danger); border: 1px solid rgba(239,68,68,0.2); }

  .table-container {
    width: 100%;
    overflow-x: auto;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    margin-bottom: 2rem;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
  }

  th, td {
    padding: 1rem 1.5rem;
    white-space: nowrap;
  }

  th {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
  }

  td {
    font-size: 0.875rem;
    border-bottom: 1px solid var(--border);
  }

  tr:last-child td { border-bottom: none; }
  tr:hover td { background: var(--bg-surface-hover); }

  .empty-state {
    text-align: center;
    padding: 3rem !important;
    color: var(--text-muted);
  }

  #chart-container {
    width: 100%;
    height: 400px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1rem;
    margin-bottom: 2rem;
  }

  .live-indicator {
    width: 8px;
    height: 8px;
    background-color: var(--danger);
    border-radius: 50%;
    box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7);
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
    70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
    100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
  }

  .alert-private {
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.2);
    color: var(--warning);
    padding: 1rem 1.25rem;
    border-radius: 8px;
    margin-bottom: 2rem;
    font-size: 0.875rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .footer {
    margin-top: 3rem;
    font-size: 0.75rem;
    color: var(--text-muted);
    text-align: center;
    padding-top: 2rem;
    border-top: 1px solid var(--border);
  }
</style>
</head>
<body>

<h1><span class="live-indicator"></span> AI Trading V3</h1>
${privateWarning}

<div id="chart-container"></div>

<div class="grid-stats">
  <div class="card">
    <div class="label">Uptime</div>
    <div class="value font-mono">${Math.floor(stats.uptime / 3600)}h ${Math.floor((stats.uptime % 3600) / 60)}m</div>
  </div>
  <div class="card">
    <div class="label">Mode</div>
    <div class="value ${stats.dryRun ? 'text-warning' : 'text-success'}">${stats.dryRun ? 'DRY RUN' : 'LIVE'}</div>
  </div>
  <div class="card">
    <div class="label">Kill Switch</div>
    <div class="value ${stats.killSwitch ? 'text-danger' : 'text-success'}">${stats.killSwitch ? 'ACTIVE' : 'OFF'}</div>
  </div>
  <div class="card">
    <div class="label">Active Proxies</div>
    <div class="value font-mono">${stats.activeProxies}</div>
  </div>
  <div class="card">
    <div class="label">Spent Today (SOL)</div>
    <div class="value font-mono">${stats.spentTodaySol.toFixed(4)} <span class="text-muted" style="font-size: 0.875rem;">/ ${stats.maxSolPerDay}</span></div>
  </div>
</div>

<h2>Recent Candidates (Global)</h2>
<div class="table-container">
  <table>
    <thead>
      <tr><th>Symbol</th><th>Name</th><th>Chain</th><th>Price</th><th>Liquidity</th><th>Vol 24h</th></tr>
    </thead>
    <tbody>
      ${candidateRows || '<tr><td colspan="6" class="empty-state">Nessun candidato rilevato di recente</td></tr>'}
    </tbody>
  </table>
</div>

<h2>Your Live Positions</h2>
<div class="table-container">
  <table>
    <thead>
      <tr><th>User</th><th>Symbol</th><th>Buy Cost (SOL)</th><th>Live PNL %</th></tr>
    </thead>
    <tbody>
      ${isPrivate ? (stats.livePositions.length > 0 ? stats.livePositions.map(p => `
        <tr>
          <td class="font-mono text-muted">${p.userId}</td>
          <td><span class="badge">${p.symbol}</span></td>
          <td class="font-mono">${p.buyPriceSol.toFixed(4)}</td>
          <td class="font-medium font-mono ${p.latestPnlPercent > 0 ? 'text-success' : (p.latestPnlPercent < 0 ? 'text-danger' : '')}">
            ${p.latestPnlPercent !== null ? (p.latestPnlPercent > 0 ? '+' : '') + p.latestPnlPercent.toFixed(2) + '%' : 'Calculating...'}
          </td>
        </tr>`).join('') : '<tr><td colspan="4" class="empty-state">Nessuna posizione live attiva</td></tr>') : '<tr><td colspan="4" class="empty-state">Accesso limitato. Usa il tuo link privato per visualizzare.</td></tr>'}
    </tbody>
  </table>
</div>

<h2>Your Trial Portfolios</h2>
<div class="table-container">
  <table>
    <thead>
      <tr><th>User</th><th>Status</th><th>Balance (SOL)</th><th>Open Pos</th><th>Closed Pos</th></tr>
    </thead>
    <tbody>
      ${isPrivate ? (portfolioRows || '<tr><td colspan="5" class="empty-state">Nessun portfolio trial attivo</td></tr>') : '<tr><td colspan="5" class="empty-state">Accesso limitato. Usa il tuo link privato per visualizzare.</td></tr>'}
    </tbody>
  </table>
</div>

<div class="footer">
  Auto-refresh ogni 15s &bull; Porta ${config.DASHBOARD_PORT || 3000} &bull; Protetto da AI Trading V3
</div>

<script>
  const chartProperties = {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#a1a1aa' },
    grid: { vertLines: { color: '#27272a' }, horzLines: { color: '#27272a' } },
    timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#27272a' },
    rightPriceScale: { borderColor: '#27272a' },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
  };
  const domElement = document.getElementById('chart-container');
  chartProperties.width = domElement.clientWidth || domElement.getBoundingClientRect().width || window.innerWidth - 60;
  chartProperties.height = domElement.clientHeight || domElement.getBoundingClientRect().height || 350;
  
  const chart = LightweightCharts.createChart(domElement, chartProperties);
  new ResizeObserver(entries => { 
    if (entries.length === 0 || entries[0].target !== domElement) return; 
    const newRect = entries[0].contentRect; 
    chart.applyOptions({ height: newRect.height, width: newRect.width }); 
  }).observe(domElement);
  
  const lineSeries = chart.addAreaSeries({ 
    lineColor: '#3b82f6', 
    topColor: 'rgba(59, 130, 246, 0.3)', 
    bottomColor: 'rgba(59, 130, 246, 0.0)',
    lineWidth: 2
  });

  let currentVal = 100;
  const data = [];
  const now = Math.floor(Date.now() / 1000);
  for(let i = 100; i > 0; i--) {
    currentVal += (Math.random() - 0.48) * 5;
    data.push({ time: now - (i * 60), value: currentVal });
  }
  lineSeries.setData(data);

  document.querySelectorAll('.counter').forEach(el => {
    const val = parseFloat(el.innerText);
    if(isNaN(val)) return;
    el.innerText = '0.0000';
    let start = 0;
    const step = val / 20;
    const interval = setInterval(() => {
      start += step;
      if(start >= val) { start = val; clearInterval(interval); }
      el.innerText = start.toFixed(4);
    }, 30);
  });

  setTimeout(() => {
    window.location.reload();
  }, 15000);
</script>
</body>
</html>`;
}

export function startDashboard() {
  const port = process.env.PORT || config.DASHBOARD_PORT || 3000;

  const server = http.createServer((req, res) => {
    try {
      // Create URL object to parse query string. Base doesn't matter here.
      const url = new URL(req.url, `http://localhost:${port}`);
      const token = url.searchParams.get('token');

      // Ricerca dell'utente tramite token
      let targetUserId = null;
      if (token) {
        for (const [userId, user] of userDatabase.users.entries()) {
          if (user.dashboardAuthToken === token) {
            targetUserId = userId;
            break;
          }
        }
      }

      // Se non c'è token valido, targetUserId resta null e getStats non includerà dati privati
      if (url.pathname === '/api/stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getStats(targetUserId), null, 2));
        return;
      }

      const stats = getStats(targetUserId);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHTML(stats, !!targetUserId));
    } catch (err) {
      console.error('[DASHBOARD ERROR]', err);
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end('Internal Server Error');
    }
  });

  server.listen(port, '0.0.0.0', async () => {
    console.log(`[DASHBOARD] Web dashboard available locally at http://localhost:${port}`);
    try {
      const tunnel = await localtunnel({ port: port });
      publicBaseUrl = tunnel.url;
      console.log(`[DASHBOARD] Public dashboard available at ` + publicBaseUrl);
      emitEvent('dashboard-url', publicBaseUrl);
      
      tunnel.on('close', () => {
        console.log('[DASHBOARD] Localtunnel closed');
      });
    } catch (err) {
      console.error('[DASHBOARD] Localtunnel error:', err.message);
      emitEvent('dashboard-url', publicBaseUrl);
    }
  });

  server.on('error', (err) => {
    console.warn(`[DASHBOARD] Failed to start dashboard: ${err.message}`);
  });
}
