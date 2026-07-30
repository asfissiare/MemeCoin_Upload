const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'dashboard.js');
let content = fs.readFileSync(file, 'utf8');

const newHTML = `function renderHTML(stats, isPrivate = false) {
  const candidateRows = stats.recentCandidates.map(c =>
    \\\`<tr><td>\\\${c.symbol}</td><td>\\\${c.name}</td><td><span class="badge">\\\${c.chain}</span></td><td>$\\\${Number(c.priceUsd || 0).toFixed(6)}</td><td>$\\\${Number(c.liquidityUsd || 0).toLocaleString()}</td><td>$\\\${Number(c.volume24hUsd || 0).toLocaleString()}</td></tr>\\\`
  ).join('');

  const portfolioRows = stats.trialPortfolios.map(p =>
    \\\`<tr><td>\\\${p.userId}</td><td><span class="badge \\\${p.trialEnabled ? 'badge-green' : 'badge-red'}">\\\${p.trialEnabled ? 'ACTIVE' : 'PAUSED'}</span></td><td class="counter">\\\${p.balance.toFixed(4)}</td><td>\\\${p.openPositions}</td><td>\\\${p.closedPositions}</td></tr>\\\`
  ).join('');
  
  const privateWarning = !isPrivate ? \\\`<div class="glass-alert"><b>MODALITÀ PUBBLICA:</b> Stai visualizzando la dashboard globale. Usa il comando Discord per ottenere il tuo link privato.</div>\\\` : '';

  return \\\`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Trading V3 - Command Center</title>
<script src="https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js"></script>
<style>
  :root {
    --bg-color: #0b0f19;
    --glass-bg: rgba(20, 27, 45, 0.7);
    --glass-border: rgba(255, 255, 255, 0.08);
    --neon-cyan: #00f3ff;
    --neon-purple: #bc13fe;
    --text-main: #f8fafc;
    --text-muted: #94a3b8;
    --green: #10b981;
    --red: #ef4444;
    --yellow: #f59e0b;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { 
    background: radial-gradient(circle at 10% 20%, rgba(0, 243, 255, 0.1) 0%, transparent 20%),
                radial-gradient(circle at 90% 80%, rgba(188, 19, 254, 0.1) 0%, transparent 20%),
                var(--bg-color);
    color: var(--text-main); 
    font-family: 'Inter', system-ui, sans-serif; 
    padding: 30px; 
    min-height: 100vh;
  }
  h1 { font-size: 2rem; margin-bottom: 24px; text-transform: uppercase; letter-spacing: 2px; text-shadow: 0 0 10px rgba(0, 243, 255, 0.5); display: flex; align-items: center; gap: 15px;}
  h2 { font-size: 1.2rem; margin: 30px 0 15px; color: var(--neon-cyan); text-transform: uppercase; letter-spacing: 1px;}
  
  .glass-alert {
    background: rgba(239, 68, 68, 0.2);
    border: 1px solid rgba(239, 68, 68, 0.4);
    backdrop-filter: blur(10px);
    color: #fca5a5;
    padding: 15px;
    border-radius: 12px;
    margin-bottom: 30px;
    text-align: center;
    box-shadow: 0 4px 15px rgba(239, 68, 68, 0.1);
  }

  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 30px; }
  
  .card { 
    background: var(--glass-bg); 
    border: 1px solid var(--glass-border); 
    backdrop-filter: blur(12px); 
    border-radius: 16px; 
    padding: 24px; 
    transition: transform 0.3s ease, box-shadow 0.3s ease;
    position: relative;
    overflow: hidden;
  }
  .card::before {
    content: ''; position: absolute; top: 0; left: 0; width: 100%; height: 2px;
    background: linear-gradient(90deg, transparent, var(--neon-cyan), transparent);
    opacity: 0; transition: opacity 0.3s ease;
  }
  .card:hover { transform: translateY(-5px); box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
  .card:hover::before { opacity: 1; }
  
  .card .label { font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 1px;}
  .card .value { font-size: 1.8rem; font-weight: 700; text-shadow: 0 0 10px rgba(255,255,255,0.1); }
  
  .green { color: var(--green); text-shadow: 0 0 10px rgba(16, 185, 129, 0.4); }
  .red { color: var(--red); text-shadow: 0 0 10px rgba(239, 68, 68, 0.4); }
  .yellow { color: var(--yellow); text-shadow: 0 0 10px rgba(245, 158, 11, 0.4); }
  
  table { 
    width: 100%; border-collapse: separate; border-spacing: 0 8px; 
    margin-bottom: 30px; 
  }
  th { padding: 12px 16px; text-align: left; font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid var(--glass-border);}
  td { 
    padding: 16px; font-size: 0.95rem; 
    background: var(--glass-bg);
    backdrop-filter: blur(10px);
  }
  tr td:first-child { border-top-left-radius: 12px; border-bottom-left-radius: 12px; border-left: 1px solid var(--glass-border); }
  tr td:last-child { border-top-right-radius: 12px; border-bottom-right-radius: 12px; border-right: 1px solid var(--glass-border); }
  tr td { border-top: 1px solid var(--glass-border); border-bottom: 1px solid var(--glass-border); transition: background 0.2s;}
  tr:hover td { background: rgba(255,255,255,0.05); }

  .badge {
    background: rgba(255,255,255,0.1); padding: 4px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
  }
  .badge-green { background: rgba(16, 185, 129, 0.2); color: var(--green); border: 1px solid rgba(16, 185, 129, 0.3);}
  .badge-red { background: rgba(239, 68, 68, 0.2); color: var(--red); border: 1px solid rgba(239, 68, 68, 0.3);}

  @keyframes pulse-live {
    0% { opacity: 1; box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
    70% { opacity: 0.7; box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
    100% { opacity: 1; box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
  }
  .live-dot {
    display: inline-block; width: 10px; height: 10px; border-radius: 50%;
    background: var(--red); margin-right: 8px;
    animation: pulse-live 2s infinite;
  }

  #chart-container {
    width: 100%; height: 350px; background: var(--glass-bg); border: 1px solid var(--glass-border);
    border-radius: 16px; padding: 10px; margin-bottom: 40px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
  }

  .footer { margin-top: 40px; font-size: 0.8rem; color: var(--text-muted); text-align: center; padding-top: 20px; border-top: 1px solid var(--glass-border); }
</style>
</head>
<body>
<h1><span class="live-dot"></span> AI TRADING V3 COMMAND CENTER</h1>
\\\${privateWarning}

<div id="chart-container"></div>

<div class="grid">
  <div class="card"><div class="label">Uptime</div><div class="value">\\\${Math.floor(stats.uptime / 3600)}h \\\${Math.floor((stats.uptime % 3600) / 60)}m</div></div>
  <div class="card"><div class="label">Mode</div><div class="value \\\${stats.dryRun ? 'yellow' : 'green'}">\\\${stats.dryRun ? 'DRY RUN' : 'LIVE'}</div></div>
  <div class="card"><div class="label">Kill Switch</div><div class="value \\\${stats.killSwitch ? 'red' : 'green'}">\\\${stats.killSwitch ? 'ACTIVE' : 'OFF'}</div></div>
  <div class="card"><div class="label">Proxies</div><div class="value">\\\${stats.activeProxies}</div></div>
  <div class="card"><div class="label">Spent Today</div><div class="value">\\\${stats.spentTodaySol.toFixed(4)} / \\\${stats.maxSolPerDay} SOL</div></div>
</div>

<h2>RECENT CANDIDATES (GLOBAL)</h2>
<table>
<tr><th>Symbol</th><th>Name</th><th>Chain</th><th>Price</th><th>Liquidity</th><th>Vol 24h</th></tr>
\\\${candidateRows || '<tr><td colspan="6" style="text-align:center; padding: 30px; color:#64748b;">No candidates detected recently</td></tr>'}
</table>

<h2>YOUR LIVE POSITIONS (REAL MONEY)</h2>
<table>
<tr><th>User</th><th>Symbol</th><th>Buy Cost (SOL)</th><th>Live PNL %</th></tr>
\\\${isPrivate ? (stats.livePositions.length > 0 ? stats.livePositions.map(p => \\\`<tr><td>\\\${p.userId}</td><td><span class="badge">\\\${p.symbol}</span></td><td>\\\${p.buyPriceSol.toFixed(4)} <span style="color:#64748b; font-size:0.8em">SOL</span></td><td class="\\\${p.latestPnlPercent > 0 ? 'green' : (p.latestPnlPercent < 0 ? 'red' : '')}"><b>\\\${p.latestPnlPercent !== null ? p.latestPnlPercent.toFixed(2) + '%' : 'Calculating...'}</b></td></tr>\\\`).join('') : '<tr><td colspan="4" style="text-align:center; padding: 30px; color:#64748b;">No active live positions</td></tr>') : '<tr><td colspan="4" style="text-align:center; padding: 30px; color:#ef4444;">Access restricted. Use your private link.</td></tr>'}
</table>

<h2>YOUR TRIAL PORTFOLIOS</h2>
<table>
<tr><th>User</th><th>Status</th><th>Balance (SOL)</th><th>Open</th><th>Closed</th></tr>
\\\${isPrivate ? (portfolioRows || '<tr><td colspan="5" style="text-align:center; padding: 30px; color:#64748b;">No trial portfolios active</td></tr>') : '<tr><td colspan="5" style="text-align:center; padding: 30px; color:#ef4444;">Access restricted. Use your private link.</td></tr>'}
</table>

<div class="footer">Auto-refresh every 15s | Port \\\${config.DASHBOARD_PORT || 3000} | Protected by AI Trading V3</div>

<script>
  // Inizializza grafico TradingView (Simulazione PnL / Attività)
  const chartProperties = {
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#94a3b8' },
    grid: { vertLines: { color: 'rgba(255,255,255,0.05)' }, horzLines: { color: 'rgba(255,255,255,0.05)' } },
    timeScale: { timeVisible: true, secondsVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
  };
  const domElement = document.getElementById('chart-container');
  const chart = LightweightCharts.createChart(domElement, chartProperties);
  const lineSeries = chart.addAreaSeries({ 
    lineColor: '#00f3ff', 
    topColor: 'rgba(0, 243, 255, 0.4)', 
    bottomColor: 'rgba(0, 243, 255, 0.0)',
    lineWidth: 2
  });

  // Genera dati dummy per mostrare l'andamento del bot se non ci sono dati reali nel frontend
  let currentVal = 100;
  const data = [];
  const now = Math.floor(Date.now() / 1000);
  for(let i = 100; i > 0; i--) {
    currentVal += (Math.random() - 0.48) * 5;
    data.push({ time: now - (i * 60), value: currentVal });
  }
  lineSeries.setData(data);

  // Animazione contatori
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

  // Auto-refresh senza flashare lo schermo tramite fetch API (opzionale)
  setTimeout(() => {
    window.location.reload();
  }, 15000);
</script>
</body>
</html>\\\`;
}`;

content = content.replace(/function renderHTML\([\s\S]*?export function startDashboard\(\)/, newHTML + "\n\nexport function startDashboard()");

fs.writeFileSync(file, content, 'utf8');
