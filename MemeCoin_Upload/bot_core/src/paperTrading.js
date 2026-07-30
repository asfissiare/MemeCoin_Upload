import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { proxyManager } from './proxyManager.js';
import { eventBus } from './events.js';
import { aiEvaluator } from './aiEvaluator.js';
import { Portfolio } from './db/models.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');
const PAPER_FILE = path.join(DATA_DIR, 'paper_portfolios.json');

export class PaperTradingEngine {
  constructor() {
    this.portfolios = new Map();
    this.useMongo = false;
    this.startAutoExitMonitor();
  }

  async init() {
    if (process.env.MONGODB_URI) {
      this.useMongo = true;
      try {
        const dbPortfolios = await Portfolio.find({});
        for (const p of dbPortfolios) {
          this.portfolios.set(p.discordUserId, p.toObject());
        }
        console.log(`[PAPER] Caricati ${dbPortfolios.length} portafogli da MongoDB`);
      } catch (err) {
        console.error('[PAPER] Errore caricamento da MongoDB:', err.message);
      }
    } else {
      this.useMongo = false;
      this.initLocalDatabase();
    }
  }

  initLocalDatabase() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(PAPER_FILE)) {
        const raw = fs.readFileSync(PAPER_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        for (const [userId, data] of Object.entries(parsed)) {
          if (data.trialStartedAt) data.trialStartedAt = Number(data.trialStartedAt);
          if (data.reminderSentAt) data.reminderSentAt = Number(data.reminderSentAt);
          this.portfolios.set(userId, data);
        }
      }
    } catch (err) {
      console.warn(`[PAPER] Errore caricamento database paper trading: ${err.message}`);
    }
  }

  saveDatabase() {
    if (this.useMongo) {
      const arr = Array.from(this.portfolios.entries());
      for (const [userId, data] of arr) {
        const payload = { discordUserId: userId, ...data };
        Portfolio.findOneAndUpdate({ discordUserId: userId }, payload, { upsert: true })
          .catch(err => console.error('[PAPER] Errore salvataggio MongoDB:', err.message));
      }
    } else {
      try {
        const obj = {};
        for (const [userId, data] of this.portfolios.entries()) {
          obj[userId] = data;
        }
        fs.writeFileSync(PAPER_FILE, JSON.stringify(obj, null, 2), 'utf8');
      } catch (err) {
        console.warn(`[PAPER] Errore salvataggio paper database: ${err.message}`);
      }
    }
  }

  getUserPortfolio(userId) {
    if (!this.portfolios.has(userId)) {
      this.portfolios.set(userId, {
        trialEnabled: true,
        trialStartedAt: Date.now(),
        reminderSentAt: null,
        paperSolBalance: 1.0,
        positions: []
      });
      this.saveDatabase();
    }
    const pf = this.portfolios.get(userId);
    if (pf.trialEnabled === undefined) pf.trialEnabled = true;
    if (!pf.trialStartedAt) pf.trialStartedAt = Date.now();
    return pf;
  }

  toggleTrialMode(userId, enable) {
    const portfolio = this.getUserPortfolio(userId);
    const targetState = enable !== undefined ? enable : !portfolio.trialEnabled;

    portfolio.trialEnabled = targetState;
    if (targetState) {
      portfolio.trialStartedAt = Date.now();
      portfolio.reminderSentAt = null;
    } else {
      this.closeAllOpenPositions(userId, 'USER_PAUSED');
    }
    this.saveDatabase();
    return portfolio;
  }

  continueTrialSession(userId) {
    const portfolio = this.getUserPortfolio(userId);
    portfolio.trialEnabled = true;
    portfolio.trialStartedAt = Date.now();
    portfolio.reminderSentAt = null;
    this.saveDatabase();
    return portfolio;
  }

  closeTrialSession(userId, reason = 'INACTIVITY_AUTOCLOSE') {
    const portfolio = this.getUserPortfolio(userId);
    portfolio.trialEnabled = false;
    this.closeAllOpenPositions(userId, reason);
    this.saveDatabase();
    return portfolio;
  }

  closeAllOpenPositions(userId, reason = 'SESSION_CLOSED') {
    const portfolio = this.getUserPortfolio(userId);
    const openPos = portfolio.positions.filter(p => p.status === 'OPEN');
    for (const pos of openPos) {
      this.executePaperSell(userId, pos.id, pos.entryPriceUsd, reason);
    }
  }

  executePaperBuy(userId, candidate, amountSol = 0.05) {
    const portfolio = this.getUserPortfolio(userId);

    if (!portfolio.trialEnabled) return null;

    if (portfolio.paperSolBalance < amountSol) {
      return null;
    }

    const existingOpen = portfolio.positions.find(p => p.mint === candidate.mint && p.status === 'OPEN');
    if (existingOpen) return null;

    const priceUsd = Number(candidate.priceUsd || candidate.priceNative || 0.0001);
    const solPriceUsd = 180.0;
    const investedUsd = amountSol * solPriceUsd;
    const tokensReceived = priceUsd > 0 ? (investedUsd / priceUsd) : (amountSol * 100000);

    portfolio.paperSolBalance -= amountSol;

    const position = {
      id: `trial_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      mint: candidate.mint,
      symbol: candidate.symbol,
      name: candidate.name,
      solInvested: amountSol,
      entryPriceUsd: priceUsd,
      tokensReceived,
      openedAt: new Date().toISOString(),
      status: 'OPEN'
    };

    portfolio.positions.push(position);
    this.saveDatabase();

    return { portfolio, position };
  }

  executePaperSell(userId, positionId, exitPriceUsd, reason = 'TAKE_PROFIT') {
    const portfolio = this.getUserPortfolio(userId);
    const posIndex = portfolio.positions.findIndex(p => p.id === positionId && p.status === 'OPEN');

    if (posIndex === -1) return null;

    const pos = portfolio.positions[posIndex];
    const exitPrice = Number(exitPriceUsd || pos.entryPriceUsd * 1.1);
    const solPriceUsd = 180.0;

    const currentUsdValue = pos.tokensReceived * exitPrice;
    const returnSol = currentUsdValue / solPriceUsd;
    const pnlPercent = ((exitPrice - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
    const pnlSol = returnSol - pos.solInvested;

    pos.status = 'CLOSED';
    pos.closedAt = new Date().toISOString();
    pos.exitPriceUsd = exitPrice;
    pos.returnSol = returnSol;
    pos.pnlPercent = pnlPercent;
    pos.pnlSol = pnlSol;
    pos.exitReason = reason;

    portfolio.paperSolBalance += returnSol;
    this.saveDatabase();
    
    // Invia feedback all'intelligenza artificiale in background
    aiEvaluator.reportFeedback(pos, pnlPercent, pnlSol).catch(() => {});

    return { portfolio, position: pos };
  }

  startAutoExitMonitor() {
    setInterval(async () => {
      for (const [userId, portfolio] of this.portfolios.entries()) {
        if (!portfolio.trialEnabled) continue;
        const openPositions = portfolio.positions.filter(p => p.status === 'OPEN');
        for (const pos of openPositions) {
          try {
            const res = await proxyManager.fetchWithProxy(`https://api.dexscreener.com/latest/dex/tokens/${pos.mint}`);
            if (res.ok) {
              const data = await res.json();
              if (data.pairs && data.pairs.length > 0) {
                const currentPriceUsd = Number(data.pairs[0].priceUsd || pos.entryPriceUsd);
                const pnlPercent = ((currentPriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;

                if (pnlPercent >= 25) {
                  const sold = this.executePaperSell(userId, pos.id, currentPriceUsd, 'TAKE_PROFIT (+25%)');
                  if (sold) {
                    eventBus.emit('bot-event', {
                      type: 'trial-sell',
                      data: { userId, position: sold.position }
                    });
                  }
                } else if (pnlPercent <= -15) {
                  const sold = this.executePaperSell(userId, pos.id, currentPriceUsd, 'STOP_LOSS (-15%)');
                  if (sold) {
                    eventBus.emit('bot-event', {
                      type: 'trial-sell',
                      data: { userId, position: sold.position }
                    });
                  }
                }
              }
            }
          } catch (err) {
            // Continuation
          }
        }
      }
    }, 15000);
  }

  checkInactivityTimers(onReminder12h, onAutoClose24h) {
    const now = Date.now();
    const TWELVE_HOURS = 12 * 60 * 60 * 1000;

    for (const [userId, portfolio] of this.portfolios.entries()) {
      if (!portfolio.trialEnabled) continue;

      const startTime = portfolio.trialStartedAt || now;

      // 1. Check 12-Hour Reminder
      if (now - startTime >= TWELVE_HOURS && !portfolio.reminderSentAt) {
        portfolio.reminderSentAt = now;
        this.saveDatabase();
        if (onReminder12h) onReminder12h(userId);
      }

      // 2. Check 24-Hour Auto Close (12h after reminder OR 24h total without response)
      if (portfolio.reminderSentAt && (now - portfolio.reminderSentAt >= TWELVE_HOURS || now - startTime >= 2 * TWELVE_HOURS)) {
        this.closeTrialSession(userId, 'INACTIVITY_24H_AUTOCLOSE');
        if (onAutoClose24h) onAutoClose24h(userId);
      }
    }
  }

  async getPortfolioWithLivePnL(userId) {
    const portfolio = this.getUserPortfolio(userId);
    const openPositions = portfolio.positions.filter(p => p.status === 'OPEN');

    let totalPositionsValueSol = 0;
    let totalUnrealizedPnlSol = 0;
    const solPriceUsd = 180.0;

    const enrichedPositions = [];

    for (const pos of openPositions) {
      let currentPriceUsd = pos.entryPriceUsd;
      try {
        const res = await proxyManager.fetchWithProxy(`https://api.dexscreener.com/latest/dex/tokens/${pos.mint}`);
        if (res.ok) {
          const data = await res.json();
          if (data.pairs && data.pairs.length > 0) {
            currentPriceUsd = Number(data.pairs[0].priceUsd || pos.entryPriceUsd);
          }
        }
      } catch (err) {
        // Fallback
      }

      const currentValueUsd = pos.tokensReceived * currentPriceUsd;
      const currentValueSol = currentValueUsd / solPriceUsd;
      const pnlSol = currentValueSol - pos.solInvested;
      const pnlPercent = ((currentPriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;

      totalPositionsValueSol += currentValueSol;
      totalUnrealizedPnlSol += pnlSol;

      enrichedPositions.push({
        ...pos,
        currentPriceUsd,
        currentValueSol,
        pnlSol,
        pnlPercent
      });
    }

    const totalPortfolioValueSol = portfolio.paperSolBalance + totalPositionsValueSol;

    return {
      paperSolBalance: portfolio.paperSolBalance,
      totalPositionsValueSol,
      totalPortfolioValueSol,
      totalUnrealizedPnlSol,
      openPositions: enrichedPositions,
      allPositionsCount: portfolio.positions.length
    };
  }

  getResultsSummary(userId) {
    const portfolio = this.getUserPortfolio(userId);
    const closed = portfolio.positions.filter(p => p.status === 'CLOSED');
    const open = portfolio.positions.filter(p => p.status === 'OPEN');

    let totalPnlSol = 0;
    let wins = 0;
    let losses = 0;

    for (const p of closed) {
      totalPnlSol += (p.pnlSol || 0);
      if ((p.pnlSol || 0) >= 0) wins++;
      else losses++;
    }

    const winRate = closed.length > 0 ? ((wins / closed.length) * 100).toFixed(1) : '0.0';

    return {
      paperSolBalance: portfolio.paperSolBalance,
      trialEnabled: portfolio.trialEnabled,
      totalTrades: closed.length + open.length,
      closedTradesCount: closed.length,
      openTradesCount: open.length,
      wins,
      losses,
      winRate,
      totalPnlSol,
      closedPositions: closed,
      openPositions: open
    };
  }

  resetPaperBalance(userId, amountSol = 1.0) {
    const portfolio = this.getUserPortfolio(userId);
    portfolio.paperSolBalance = amountSol;
    portfolio.positions = [];
    portfolio.trialStartedAt = Date.now();
    portfolio.reminderSentAt = null;
    this.saveDatabase();
    return portfolio;
  }
}

export const paperTradingEngine = new PaperTradingEngine();
