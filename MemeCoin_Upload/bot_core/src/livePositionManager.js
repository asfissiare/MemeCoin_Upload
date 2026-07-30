import { config } from './config.js';
import { userDatabase } from './userDatabase.js';
import { proxyManager } from './proxyManager.js';
import { tradeExecutor } from './tradeExecutor.js';
import { aiEvaluator } from './aiEvaluator.js';
import { tokenHistory } from './tokenHistory.js';
import { rlMemory } from './rlMemory.js';
import fetch from 'node-fetch';

export class LivePositionManager {
  constructor() {
    this.intervalId = null;
    this.POLL_INTERVAL_MS = 60000; // 1 minuto
  }

  start() {
    if (this.intervalId) return;
    console.log('[LIVE-POSITIONS] Motore di monitoraggio TP/SL avviato.');
    this.intervalId = setInterval(() => this.monitorPositions(), this.POLL_INTERVAL_MS);
    this.monitorPositions();
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async monitorPositions() {
    try {
      if (config.DRY_RUN) return; // Se siamo in DRY_RUN non abbiamo posizioni live vere

      const allUsers = Array.from(userDatabase.users.values()).filter(u => u.autoTradeEnabled && u.livePositions && u.livePositions.length > 0);
      if (allUsers.length === 0) return;

      const mintsToFetch = new Set();
      allUsers.forEach(u => u.livePositions.forEach(p => mintsToFetch.add(p.mint)));

      const mintsArray = Array.from(mintsToFetch);
      if (mintsArray.length === 0) return;

      const prices = {};
      const chunkSize = 30;
      for (let i = 0; i < mintsArray.length; i += chunkSize) {
        const chunk = mintsArray.slice(i, i + chunkSize).join(',');
        try {
          const res = await proxyManager.fetchWithProxy(`https://api.dexscreener.com/latest/dex/tokens/${chunk}`);
          const data = await res.json();
          if (data && data.pairs) {
            data.pairs.forEach(pair => {
              if (pair.baseToken && !prices[pair.baseToken.address]) {
                prices[pair.baseToken.address] = {
                  priceNative: parseFloat(pair.priceNative || 0),
                  priceUsd: parseFloat(pair.priceUsd || 0),
                  liquidityUsd: pair.liquidity ? parseFloat(pair.liquidity.usd || 0) : 0,
                  volume5m: pair.volume ? parseFloat(pair.volume.m5 || 0) : 0
                };
              }
            });
          }
        } catch (e) {
          console.warn('[LIVE-POSITIONS] Errore fetch DexScreener', e.message);
        }
      }

      for (const user of allUsers) {
        const positions = [...user.livePositions];
        
        for (const pos of positions) {
          const priceData = prices[pos.mint];
          if (!priceData || !priceData.priceNative) continue;

          tokenHistory.record(pos.mint, priceData);
          
          const currentPriceSol = priceData.priceNative;
          
          const buyPricePerToken = pos.buyPriceSol / pos.tokenAmount;
          const pnlPercent = ((currentPriceSol - buyPricePerToken) / buyPricePerToken) * 100;
          
          pos.latestPnlPercent = pnlPercent;
          
          const timeHeldMinutes = (Date.now() - pos.timestamp) / 60000;
          const temporal = tokenHistory.getTemporalFeatures(pos.mint);
          
          const currentState = {
            pnlPercent,
            timeHeldMinutes,
            liquidityUsd: priceData.liquidityUsd,
            volume5m: priceData.volume5m,
            priceVelocity1m: temporal.priceVelocity1m,
            priceVelocity3m: temporal.priceVelocity3m,
            volumeVelocity: temporal.volumeVelocity1m,
            volatility: 0 
          };
          
          if (pos.lastState !== undefined) {
             const reward = pnlPercent - (pos.lastPnl || 0);
             rlMemory.addExperience({
                state: pos.lastState,
                action: pos.lastAction,
                reward: reward,
                nextState: currentState,
                done: false
             });
          }

          // Recupera TP/SL dinamici decisi dall'AI al momento dell'acquisto (Fase 2)
          const tp = pos.candidateStats?.suggestedTp || 50;
          const sl = pos.candidateStats?.suggestedSl || -20;

          let aiDecision = null;

          // Controlli hard stop (Take Profit e Stop Loss dinamici)
          if (pnlPercent >= tp) {
            aiDecision = { sell: true, reason: `✅ Target AI Take Profit raggiunto (+${tp}%)` };
          } else if (pnlPercent <= sl) {
            aiDecision = { sell: true, reason: `🚨 Target AI Stop Loss raggiunto (${sl}%)` };
          } else {
            // Se non abbiamo colpito i limiti duri, chiediamo all'AI di valutare l'uscita
            Object.assign(pos, currentState);
            aiDecision = await aiEvaluator.evaluateSellPosition(pos, pnlPercent, priceData.liquidityUsd, priceData.volume5m);
            
            pos.lastState = currentState;
            pos.lastPnl = pnlPercent;
            pos.lastAction = aiDecision.sell ? 1 : 0;
          }

          if (aiDecision.sell) {
            console.log(`[LIVE-POSITIONS] AI SELL TRIGGERED per ${pos.symbol} (PnL: ${pnlPercent.toFixed(1)}%). Motivo: ${aiDecision.reason}`);
            this.executeAutoSell(user.discordUserId, pos, aiDecision.reason);
          } else {
            console.log(`[LIVE-POSITIONS] AI HOLD per ${pos.symbol} (PnL: ${pnlPercent.toFixed(1)}%) - Score: ${aiDecision.score}`);
          }
        }
      }
    } catch (err) {
      console.error('[LIVE-POSITIONS] Errore nel monitoraggio:', err.message);
    }
  }

  async executeAutoSell(discordUserId, position, reason) {
    try {
      const finalPnl = position.latestPnlPercent || 0;
      let reward = finalPnl;
      if (finalPnl <= -90) reward = -100; // Rugpull penalty
      else if (finalPnl > 50) reward += 20; // Big win bonus
      
      if (position.lastState) {
         rlMemory.addExperience({
            state: position.lastState,
            action: 1, // SELL
            reward: reward,
            nextState: null,
            done: true
         });
      }
      
      // Trigger training
      if (config.AI_API_URL) {
         const batch = rlMemory.getBatch();
         if (batch.length > 0) {
            fetch(`${config.AI_API_URL}/train-rl`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(batch)
            }).catch(e => console.warn('[RL] Errore trigger training:', e.message));
         }
      }
      userDatabase.removeLivePosition(discordUserId, position.mint);
      
      await tradeExecutor.executeSellForSingleWallet(
        discordUserId,
        position.mint,
        position.tokenAmount,
        position.symbol,
        reason
      );
    } catch (err) {
      console.error(`[LIVE-POSITIONS] Fallita auto-vendita per ${position.symbol}:`, err.message);
      userDatabase.addLivePosition(discordUserId, position.mint, position.buyPriceSol, position.tokenAmount, position.symbol);
    }
  }
}

export const livePositionManager = new LivePositionManager();
