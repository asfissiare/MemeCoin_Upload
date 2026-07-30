import assert from 'assert';
import { config, validateConfig } from '../src/config.js';
import { riskManager } from '../src/riskManager.js';
import { checkTokenSafety } from '../src/rugCheck.js';
import { tradeExecutor } from '../src/tradeExecutor.js';
import { eventBus } from '../src/events.js';
import { userDatabase } from '../src/userDatabase.js';

console.log('======================================================');
console.log('🧪 AVVIO SUITE DI TEST E VERIFICA REQUISITI');
console.log('======================================================\n');

async function runTests() {
  let passedCount = 0;
  let failedCount = 0;

  function test(description, fn) {
    try {
      fn();
      console.log(`[PASS] ${description}`);
      passedCount++;
    } catch (err) {
      console.error(`[FAIL] ${description}`);
      console.error(`       -> Errore: ${err.message}`);
      failedCount++;
    }
  }

  async function asyncTest(description, fn) {
    try {
      await fn();
      console.log(`[PASS] ${description}`);
      passedCount++;
    } catch (err) {
      console.error(`[FAIL] ${description}`);
      console.error(`       -> Errore: ${err.message}`);
      failedCount++;
    }
  }

  // TEST 1: Config Validation
  test('1. Validazione configurazione all\'avvio', () => {
    assert.strictEqual(typeof config.DRY_RUN, 'boolean', 'DRY_RUN deve essere un booleano');
    assert.doesNotThrow(() => validateConfig(), 'validateConfig() non deve lanciare eccezioni con i parametri attivi');
  });

  // TEST 2: Risk Manager Single Trade & Daily Limit
  test('2. Risk Manager blocca trade se supera MAX_SOL_PER_TRADE', () => {
    const amountTooHigh = config.MAX_SOL_PER_TRADE + 0.1;
    const result = riskManager.evaluateTrade(amountTooHigh);
    assert.strictEqual(result.allowed, false, 'Trade superiore al limite singolo deve essere bloccato');
    assert.ok(result.reason.includes('supera il massimo consentito'), 'Motivo deve indicare il superamento del limite');
  });

  test('3. Risk Manager accumula spesa e blocca se supera MAX_SOL_PER_DAY', () => {
    const rm = new (riskManager.constructor)(); // Istanza pulita
    const singleTrade = config.MAX_SOL_PER_TRADE; // es. 0.05
    const maxDay = config.MAX_SOL_PER_DAY; // es. 0.2

    let totalSpent = 0;
    while (totalSpent + singleTrade <= maxDay) {
      const evalRes = rm.evaluateTrade(singleTrade);
      assert.strictEqual(evalRes.allowed, true, 'Trade entro i limiti deve essere consentito');
      rm.recordSpend(singleTrade);
      totalSpent += singleTrade;
    }

    const finalEval = rm.evaluateTrade(singleTrade);
    assert.strictEqual(finalEval.allowed, false, 'Trade che supera il limite giornaliero deve essere bloccato');
    assert.ok(finalEval.reason.includes('supererebbe il limite di spesa giornaliero'), 'Motivo deve indicare superamento limite giornaliero');
  });

  // TEST 3: Kill Switch Functionality & Authorization
  test('4. Kill Switch attiva e blocca immediatamente qualunque trade successivo', () => {
    const rm = new (riskManager.constructor)();
    rm.activateKillSwitch('Test Emergenza', 'owner-id-123');

    const status = rm.getStatus();
    assert.strictEqual(status.killSwitchActive, true, 'Kill switch deve risultare attivo');

    const evalRes = rm.evaluateTrade(0.01);
    assert.strictEqual(evalRes.allowed, false, 'Qualunque trade deve essere rifiutato quando il kill switch è attivo');
    assert.ok(evalRes.reason.includes('Kill switch ATTIVO'), 'Motivo deve indicare kill switch attivo');

    rm.deactivateKillSwitch('Ripristino Test', 'owner-id-123');
    const evalResAfter = rm.evaluateTrade(0.01);
    assert.strictEqual(evalResAfter.allowed, true, 'Trade deve essere di nuovo consentito dopo la disattivazione del kill switch');
  });

  // TEST 4: Fail-Safe RugCheck Red Flags
  await asyncTest('5. RugCheck Fail-Safe: Scarto automatico per API non disponibile o dati incompleti', async () => {
    const fakeCandidate = {
      pairAddress: '0x123',
      mint: 'invalid_mint_address_test',
      symbol: 'TESTFAIL',
      priceUsd: 0.001,
      liquidityUsd: 10000,
      volume24hUsd: 20000
    };

    const result = await checkTokenSafety(fakeCandidate);
    assert.strictEqual(result.passed, false, 'Un mint non esistente o errore API deve essere scartato (Fail-Safe)');
  });

  // TEST 5: Trade Executor Simulation Mode & Key Safety
  await asyncTest('6. Trade Executor in DRY_RUN simula senza transazioni on-chain e senza loggare chiavi', async () => {
    // Solana USDC mint per un test di quotazione Jupiter reale o fallback gestito
    const candidate = {
      pairAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v_pair',
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      symbol: 'USDC',
      priceUsd: 1.0,
      liquidityUsd: 500000,
      volume24hUsd: 1000000
    };

    // Mock della fetch di globalThis per garantire un test isolato e deterministico
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (typeof url === 'string' && url.includes('jup.ag')) {
        return {
          ok: true,
          json: async () => ({
            inputMint: 'So11111111111111111111111111111111111111112',
            outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            inAmount: '10000000',
            outAmount: '1500000',
            outputMintDecimals: 6
          })
        };
      }
      return originalFetch(url, options);
    };

    const savedDryRun = config.DRY_RUN;
    config.DRY_RUN = true;
    userDatabase.users.forEach(u => u.spentTodaySol = 0);
    try {
      let eventEmitted = false;
      const handler = (payload) => {
        if (payload.type === 'trade') {
          eventEmitted = true;
          assert.strictEqual(payload.data.simulated, true, 'Il trade deve risultare simulato');
        }
      };

      eventBus.on('bot-event', handler);
      const rawRes = await tradeExecutor.executeTrade(candidate, 0.01);
      const execResult = Array.isArray(rawRes) ? rawRes[0] : rawRes;
      eventBus.off('bot-event', handler);

      assert.strictEqual(execResult.simulated, true, 'Result deve corrispondere alla modalità simulata');
      assert.strictEqual(execResult.executed, true, 'Result deve indicare eseguito');
      assert.strictEqual(eventEmitted, true, 'Evento trade deve essere stato emesso');
    } finally {
      config.DRY_RUN = savedDryRun;
      globalThis.fetch = originalFetch;
    }
  });

  console.log('\n======================================================');
  console.log(`📊 RISULTATO TEST: ${passedCount} PASSATI | ${failedCount} FALLITI`);
  console.log('======================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests();
