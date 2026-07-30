import { config } from './config.js';
import { emitEvent } from './events.js';
import { proxyManager } from './proxyManager.js';

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 600;

async function throttleRequest() {
  const now = Date.now();
  const timeSinceLast = now - lastRequestTime;
  if (timeSinceLast < MIN_REQUEST_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - timeSinceLast));
  }
  lastRequestTime = Date.now();
}

export async function checkTokenSafety(candidate) {
  const mint = candidate.mint;
  console.log(`[RUGCHECK] Avvio analisi di sicurezza per ${candidate.symbol} (${mint})...`);

  try {
    let res;
    let retries = 3;
    while (retries > 0) {
      await throttleRequest();
      const url = `https://api.rugcheck.xyz/v1/tokens/${mint}/report`;
      res = await proxyManager.fetchWithProxy(url, {
        headers: { 'User-Agent': 'MemeCoinBot/1.0' }
      });

      if (res.status === 429) {
        console.warn(`[RUGCHECK] Rate limit (HTTP 429) per ${mint}. Riprovo... (tentativi rimasti: ${retries - 1})`);
        retries--;
        await new Promise(resolve => setTimeout(resolve, 2000)); // wait 2 seconds before retry
      } else {
        break;
      }
    }

    if (!res.ok) {
      console.warn(`[RUGCHECK] API RugCheck non disponibile (HTTP ${res.status}) per ${mint}. FAIL-SAFE: scarto token.`);
      const result = {
        candidate,
        passed: false,
        score: 100,
        reason: `API RugCheck non disponibile (HTTP ${res.status}). Fail-safe atteso.`,
        redFlags: ['RUGCHECK_API_UNAVAILABLE']
      };
      emitEvent('rugcheck', result);
      emitEvent('skip', result);
      return result;
    }

    const report = await res.json();
    if (!report || typeof report !== 'object') {
      console.warn(`[RUGCHECK] Report RugCheck incompleto o non valido per ${mint}. FAIL-SAFE: scarto token.`);
      const result = {
        candidate,
        passed: false,
        score: 100,
        reason: 'Report RugCheck vuoto o non valido. Fail-safe atteso.',
        redFlags: ['INVALID_REPORT_DATA']
      };
      emitEvent('rugcheck', result);
      emitEvent('skip', result);
      return result;
    }

    let riskScore = 0;
    if (typeof report.score_normalised === 'number') {
      riskScore = report.score_normalised;
    } else if (typeof report.score === 'number') {
      riskScore = report.score > 100 ? Math.min(100, Math.round(report.score / 100)) : report.score;
    }

    const redFlags = [];

    const mintAuthority = report.token?.mintAuthority ?? report.mintAuthority ?? null;
    const freezeAuthority = report.token?.freezeAuthority ?? report.freezeAuthority ?? null;

    if (mintAuthority !== null && mintAuthority !== undefined && mintAuthority !== '') {
      redFlags.push(`Mint authority non revocata (Authority: ${mintAuthority})`);
    }

    if (freezeAuthority !== null && freezeAuthority !== undefined && freezeAuthority !== '') {
      redFlags.push(`Freeze authority non revocata (Authority: ${freezeAuthority})`);
    }

    if (Array.isArray(report.risks)) {
      for (const risk of report.risks) {
        const nameLower = (risk.name || '').toLowerCase();
        if (nameLower.includes('mint authority') || nameLower.includes('freeze authority') || risk.level === 'danger') {
          if (!redFlags.includes(risk.name)) {
            redFlags.push(`${risk.name}: ${risk.description || ''}`);
          }
        }
      }
    }

    if (report.token === undefined && report.mintAuthority === undefined && report.freezeAuthority === undefined) {
      redFlags.push('Autorità mint/freeze non determinabili nel report (Fail-safe attivo)');
    }

    const maxAllowedRisk = config.MIN_RUGCHECK_SCORE;
    const scorePassed = riskScore <= maxAllowedRisk;
    const noRedFlags = redFlags.length === 0;
    const passed = scorePassed && noRedFlags;

    let reason = `Tutti i controlli superati. Punteggio di rischio basso: ${riskScore} (Max tollerato: ${maxAllowedRisk}).`;
    if (!scorePassed) {
      reason = `Punteggio di rischio (${riskScore}) troppo alto rispetto alla soglia massima tollerata (${maxAllowedRisk}).`;
    } else if (!noRedFlags) {
      reason = `Trovate red-flag critiche non bypassabili: ${redFlags.join('; ')}`;
    }

    let top10Concentration = 0;
    if (Array.isArray(report.topHolders)) {
      top10Concentration = report.topHolders.slice(0, 10).reduce((acc, h) => acc + (h.pct || 0), 0);
    }
    const creatorBalance = report.creatorBalance || 0;
    const insidersDetected = report.graphInsidersDetected ? 1 : 0;

    // Deep Smart Contract Features for AI neural network
    const mintAuthorityRevoked = (mintAuthority === null || mintAuthority === undefined || mintAuthority === '') ? 1 : 0;
    const freezeAuthorityRevoked = (freezeAuthority === null || freezeAuthority === undefined || freezeAuthority === '') ? 1 : 0;
    
    // LP Locked Percentage — extract from markets data if available
    let lpLockedPct = 0;
    if (Array.isArray(report.markets)) {
      for (const market of report.markets) {
        if (market.lp && typeof market.lp.lpLockedPct === 'number') {
          lpLockedPct = Math.max(lpLockedPct, market.lp.lpLockedPct);
        }
      }
    }

    const result = {
      candidate,
      passed,
      score: riskScore,
      reason,
      redFlags,
      mintAuthority: mintAuthority || 'Revocata (Null)',
      freezeAuthority: freezeAuthority || 'Revocata (Null)',
      insiderMetrics: {
        top10Concentration,
        creatorBalance,
        insidersDetected
      },
      contractFeatures: {
        lpLockedPct,
        mintAuthorityRevoked,
        freezeAuthorityRevoked
      }
    };

    console.log(`[RUGCHECK] Risultato per ${candidate.symbol}: ${passed ? '✅ SUPERATO' : '❌ BOCCIATO'} | Rischio: ${riskScore} | ${reason}`);
    emitEvent('rugcheck', result);

    if (!passed) {
      emitEvent('skip', result);
    }

    return result;
  } catch (err) {
    console.warn(`[RUGCHECK] Errore nell'analisi di sicurezza per ${mint}: ${err.message}. FAIL-SAFE: scarto candidato.`);
    const result = {
      candidate,
      passed: false,
      score: 100,
      reason: `Eccezione nell'analisi di sicurezza: ${err.message}. Fail-safe applicato.`,
      redFlags: ['EXCEPTION_IN_SAFETY_CHECK']
    };
    emitEvent('rugcheck', result);
    emitEvent('skip', result);
    return result;
  }
}
