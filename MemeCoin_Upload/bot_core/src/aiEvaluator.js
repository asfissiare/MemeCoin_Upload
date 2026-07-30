import { config } from './config.js';

export const aiEvaluator = {
  /**
   * Valuta un candidato inviando i dati all'API dell'IA custom.
   * Se l'API non è configurata o fallisce, usa una fallback basata sui filtri base.
   */
  async evaluateCandidate(candidate, rugCheckResult = null) {
    if (!config.AI_API_URL) {
      return {
        approved: true,
        score: 100,
        reason: 'AI_API_URL non configurata. Scavalcato.'
      };
    }

    try {
      const payload = {
        symbol: candidate.symbol,
        name: candidate.name,
        chain: candidate.chain || 'solana',
        liquidityUsd: candidate.liquidityUsd,
        volume5mUsd: candidate.volume5mUsd,
        volume24hUsd: candidate.volume24hUsd,
        buys5m: candidate.buys5m,
        priceChange24h: candidate.priceChange24h || 0,
        rugCheckScore: rugCheckResult ? rugCheckResult.score : 0,
        rugCheckPassed: rugCheckResult ? rugCheckResult.passed : true,
        insiderMetrics: rugCheckResult ? rugCheckResult.insiderMetrics : {
          top10Concentration: 0,
          creatorBalance: 0,
          insidersDetected: 0
        },
        contractFeatures: rugCheckResult?.contractFeatures || {
          lpLockedPct: 0,
          mintAuthorityRevoked: 0,
          freezeAuthorityRevoked: 0
        },
        temporalFeatures: candidate._temporalFeatures || {
          priceVelocity1m: 0,
          volumeVelocity1m: 0,
          priceVelocity3m: 0,
          volumeVelocity3m: 0,
          tokenAgeMinutes: 0
        },
        trainingMode: config.TRAINING_MODE,
        dryRun: config.DRY_RUN
      };

      const response = await fetch(`${config.AI_API_URL}/evaluate`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': process.env.ENCRYPTION_SECRET
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`API ha risposto con status ${response.status}`);
      }

      const data = await response.json();
      
      const score = Number(data.score) || 0;
      const approved = data.buy === true || score >= config.AI_MIN_SCORE;

      return {
        approved: approved,
        score: score,
        reason: data.reason || (approved ? 'Approvato dall\'IA' : 'Rifiutato dall\'IA'),
        suggestedAmountRatio: data.suggestedAmountRatio || (approved ? 1.0 : 0.0),
        suggestedTp: data.suggestedTp || 50,
        suggestedSl: data.suggestedSl || -20
      };
    } catch (err) {
      console.warn(`[AI-EVALUATOR] Errore di connessione all'API: ${err.message}. Procedo con approvazione di default.`);
      return {
        approved: true,
        score: 100,
        reason: `Fallback per errore API: ${err.message}`,
        suggestedAmountRatio: 1.0,
        suggestedTp: 50,
        suggestedSl: -20
      };
    }
  },

  /**
   * Invia il feedback (profitto/perdita) di un trade all'API per addestrare il modello.
   * Passa i dati REALI del candidato al momento dell'acquisto (candidateStats).
   */
  async reportFeedback(position, pnlPercent, pnlSol) {
    if (!config.AI_API_URL) return;

    try {
      const payload = {
        symbol: position.symbol,
        mint: position.mint,
        entryPriceUsd: position.entryPriceUsd,
        exitPriceUsd: position.exitPriceUsd,
        pnlPercent: pnlPercent,
        pnlSol: pnlSol,
        isWin: pnlPercent > 0,
        originalStats: position.candidateStats || null
      };

      const response = await fetch(`${config.AI_API_URL}/feedback`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': process.env.ENCRYPTION_SECRET
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        console.warn(`[AI-EVALUATOR] Impossibile inviare feedback per ${position.symbol} (status ${response.status})`);
      } else {
        console.log(`[AI-EVALUATOR] Feedback inviato per ${position.symbol} (PnL: ${pnlPercent.toFixed(2)}%) con dati ${position.candidateStats ? 'REALI' : 'FALLBACK'}`);
      }
    } catch (err) {
      console.warn(`[AI-EVALUATOR] Errore invio feedback: ${err.message}`);
    }
  },

  /**
   * Chiede all'IA se è il momento di vendere una determinata posizione.
   */
  async evaluateSellPosition(position, pnlPercent, currentLiquidityUsd, currentVolume5m) {
    if (!config.AI_API_URL) {
      return {
        sell: pnlPercent >= 50 || pnlPercent <= -20,
        score: 0,
        reason: 'AI non configurata. Uso hard rules (50% / -20%).'
      };
    }

    try {
      const timeHeldMinutes = (Date.now() - position.timestamp) / 60000;
      
      const payload = {
        symbol: position.symbol,
        pnlPercent: pnlPercent,
        timeHeldMinutes: timeHeldMinutes,
        liquidityUsd: currentLiquidityUsd,
        volume5m: currentVolume5m
      };

      const response = await fetch(`${config.AI_API_URL}/evaluate-sell`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': process.env.ENCRYPTION_SECRET
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`API ha risposto con status ${response.status}`);
      }

      const data = await response.json();
      return {
        sell: data.sell,
        score: data.score,
        reason: data.reason || 'Sconosciuto'
      };
    } catch (err) {
      console.warn(`[AI-EVALUATOR] Errore di connessione all'API in evaluateSell: ${err.message}`);
      return {
        sell: pnlPercent >= 50 || pnlPercent <= -20,
        score: 0,
        reason: `Fallback per errore API (50%/-20% rule)`
      };
    }
  }
};
