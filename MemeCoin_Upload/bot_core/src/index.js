import { logger } from './logger.js';
import { validateConfig } from './config.js';
import { eventBus, emitEvent } from './events.js';
import { DexMonitor } from './dexMonitor.js';
import { checkTokenSafety } from './rugCheck.js';
import { tradeExecutor } from './tradeExecutor.js';
import { discordClient } from './discordClient.js';
import { proxyManager } from './proxyManager.js';
import { paperTradingEngine } from './paperTrading.js';
import { startDashboard, setDashboardCandidates } from './dashboard.js';
import { aiEvaluator } from './aiEvaluator.js';
import { startAIServer } from './aiServer.js';
import { initAIModel } from './aiModel.js';
import { balanceMonitor } from './balanceMonitor.js';
import { livePositionManager } from './livePositionManager.js';
import { tokenHistory } from './tokenHistory.js';
import { connectDB } from './db/mongoose.js';
import { userDatabase } from './userDatabase.js';
async function main() {
  logger.printAsciiArt();
  logger.info('Inizializzazione sistema in corso...');
  console.log('======================================================');
  console.log('🚀 AVVIO SOLANA MEME COIN MONITOR & TRADING BOT 24/7');
  console.log('======================================================\n');

  // Validazione configurazione all'avvio
  validateConfig();

  // Connessione MongoDB e Init DB Utenti
  await connectDB();
  await userDatabase.init();
  await paperTradingEngine.init();
  await initAIModel();

  // Avvio Proxy Manager in background
  await proxyManager.start();

  // Istanziazione monitor
  const dexMonitor = new DexMonitor();

  // Collegamento Pipeline Asincrona disaccoppiata via EventBus:
  // 1. Evento 'candidate' da DexMonitor -> Invia a RugCheck Safety Check
  const recentCandidates = [];

  eventBus.on('bot-event', async (eventPayload) => {
    if (eventPayload.type === 'candidate') {
      const candidate = eventPayload.data;
      recentCandidates.push(candidate);
      if (recentCandidates.length > 50) recentCandidates.shift();
      setDashboardCandidates(recentCandidates);

      try {
        const safetyResult = await checkTokenSafety(candidate);
        if (safetyResult.passed) {
          const aiResult = await aiEvaluator.evaluateCandidate(candidate, safetyResult);
          
          if (aiResult.approved) {
            console.log(`[AI-EVALUATOR] Candidato ${candidate.symbol} approvato! (Score: ${aiResult.score}) - ${aiResult.reason}`);
            
            // Attach rugcheck data to candidate for downstream AI training
            candidate._rugCheckScore = safetyResult.score || 0;
            candidate._insiderMetrics = safetyResult.insiderMetrics || {};
            candidate._contractFeatures = safetyResult.contractFeatures || {};
            
            // Attach temporal features from token history cache
            candidate._temporalFeatures = tokenHistory.getTemporalFeatures(candidate.mint);

            // Phase 2: Attach dynamic sizing and adaptive TP/SL
            candidate._suggestedAmountRatio = aiResult.suggestedAmountRatio || 1.0;
            candidate._suggestedTp = aiResult.suggestedTp || 50;
            candidate._suggestedSl = aiResult.suggestedSl || -20;

            // Emit special event for Discord
            emitEvent('ai-approved', { candidate, score: aiResult.score, rugScore: safetyResult.score });

            // Only execute trades on Solana chain
            if (!candidate.chain || candidate.chain === 'solana') {
              await tradeExecutor.executeTrade(candidate);
            }

            for (const [userId] of paperTradingEngine.portfolios.entries()) {
              paperTradingEngine.executePaperBuy(userId, candidate, 0.05);
            }
          } else {
            console.log(`[AI-EVALUATOR] Candidato ${candidate.symbol} scartato. (Score: ${aiResult.score}) - ${aiResult.reason}`);
          }
        }
      } catch (err) {
        console.error(`[MAIN] Errore imprevisto nella gestione del candidato ${candidate.symbol}: ${err.message}`);
      }
    }
  });

  // Avvio Bot Discord
  if (process.env.NO_DISCORD !== 'true') {
    await discordClient.start();
  } else {
    console.log('[MAIN] Bot Discord disabilitato (Modalità Solo Training in background).');
  }

  // Avvio Polling DEX Monitor
  dexMonitor.start();

  // Avvio monitoraggio saldi wallet utenti
  balanceMonitor.start();

  // Avvio monitoraggio posizioni Live per Auto-Vendita TP/SL
  livePositionManager.start();

  // Avvio Web Dashboard
  startDashboard();

  // Avvio AI Server locale integrato
  startAIServer();

  console.log('\n[MAIN] Bot completamente inizializzato e in ascolto 24/7!\n');
}

// Gestione globale errori imprevisti per evitare il crash del processo principale
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Eccezione non gestita (uncaughtException):', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[CRITICAL] Promise Rejection non gestita:', reason);
});

main().catch(err => {
  console.error('[CRITICAL] Errore fatale durante l\'avvio:', err);
});

// Gestione spegnimento grazioso (Graceful Shutdown)
function gracefulShutdown(signal) {
  console.log("\n[MAIN] Ricevuto segnale , spegnimento in corso...");
  try {
    if (discordClient && discordClient.client) {
      console.log('[MAIN] Disconnessione bot Discord...');
      discordClient.client.destroy();
    }
  } catch (err) {}
  console.log('[MAIN] Spegnimento completato.');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
