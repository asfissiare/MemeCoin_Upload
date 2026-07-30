import { Keypair, Connection, VersionedTransaction, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { config } from './config.js';
import { riskManager } from './riskManager.js';
import { emitEvent } from './events.js';
import { proxyManager } from './proxyManager.js';
import { userDatabase } from './userDatabase.js';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

function parseKeypair(privateKeyStr) {
  if (!privateKeyStr) return null;
  try {
    const trimmed = privateKeyStr.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const arr = JSON.parse(trimmed);
      return Keypair.fromSecretKey(Uint8Array.from(arr));
    } else {
      return Keypair.fromSecretKey(bs58.decode(trimmed));
    }
  } catch (err) {
    console.error('[TRADE] Impossibile decodificare WALLET_PRIVATE_KEY. Verificare che sia una stringa Base58 o JSON Array valida.');
    return null;
  }
}

async function smartFetch(url, options = {}) {
  // 1. Tenta prima la chiamata diretta per massima velocità e zero problemi di proxy sui POST payload
  try {
    const res = await fetch(url, options);
    if (res.ok) return res;
  } catch (err) {
    // Fallback su proxy se la chiamata diretta ha problemi di rete
  }

  // 2. Fallback su Proxy Manager
  return await proxyManager.fetchWithProxy(url, options);
}

export class TradeExecutor {
  constructor() {
    this.connection = new Connection(config.SOLANA_RPC_URL, 'confirmed');
    this.walletKeypair = parseKeypair(config.WALLET_PRIVATE_KEY);
  }

  async fetchJupiterQuote(outputMint, amount, inputMint = WSOL_MINT) {
    const endpoints = [
      `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${config.SLIPPAGE_BPS}`,
      `https://api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${config.SLIPPAGE_BPS}`
    ];

    for (const url of endpoints) {
      try {
        const res = await smartFetch(url, {
          headers: { 'User-Agent': 'MemeCoinBot/1.0' }
        });
        if (res && res.ok) {
          const data = await res.json();
          if (data && !data.error) return data;
        }
      } catch (err) {
        // Tenta endpoint successivo
      }
    }
    throw new Error('Quotazione DEX Jupiter non raggiungibile sugli endpoint pubblici');
  }

  async executeMultiUserTrade(candidate) {
    const activeUsers = userDatabase.getAllAutoTradeUsers();
    
    // Dynamic sizing based on AI suggestion
    const ratio = candidate._suggestedAmountRatio || 1.0;

    if (activeUsers.length === 0) {
      const tradeAmount = config.MAX_SOL_PER_TRADE * ratio;
      return [await this.executeTradeForSingleWallet(candidate, this.walletKeypair, tradeAmount)];
    }

    console.log(`[TRADE-MULTI] Avvio acquisto automatico per ${activeUsers.length} utenti (Sizing Ratio: ${Math.round(ratio*100)}%)...`);
    const results = [];

    for (const { user, keypair, remainingSol } of activeUsers) {
      if (remainingSol <= 0) {
        console.warn(`[TRADE-MULTI] Utente ${user.discordUserId} ha esaurito il budget giornaliero di SOL (${user.maxSolPerDay} SOL).`);
        emitEvent('skip', {
          candidate,
          amountSol: 0,
          executed: false,
          simulated: false, // Ensure simulated is false so it triggers the DM
          reason: `Budget giornaliero esaurito (${user.maxSolPerDay} SOL massimi per oggi). Usa /risk set per aumentarlo.`,
          discordUserId: user.discordUserId
        });
        continue;
      }

      // Compute dynamic trade amount
      let tradeAmount = user.maxSolPerTrade * ratio;
      tradeAmount = Math.min(tradeAmount, remainingSol);
      
      const res = await this.executeTradeForSingleWallet(candidate, keypair, tradeAmount, user.discordUserId);
      if (res.executed) {
        userDatabase.recordUserSpend(user.discordUserId, tradeAmount);
      }
      results.push(res);
    }

    return results;
  }

  async executeTrade(candidate, amountSol = config.MAX_SOL_PER_TRADE, reason = 'Candidato idoneo superati i filtri') {
    return this.executeMultiUserTrade(candidate);
  }

  async executeTradeForSingleWallet(candidate, keypair, amountSol, discordUserId = null) {
    const mint = candidate.mint;
    const symbol = candidate.symbol;

    console.log(`[TRADE] Richiesta esecuzione trade per ${symbol} (${mint}) - Importo: ${amountSol} SOL ${discordUserId ? `(User: ${discordUserId})` : ''}`);

    const riskCheck = riskManager.evaluateTrade(amountSol);
    if (!riskCheck.allowed) {
      console.warn(`[TRADE] Trade per ${symbol} RIFIUTATO dal Risk Manager: ${riskCheck.reason}`);
      const rejectedResult = {
        candidate,
        amountSol,
        executed: false,
        simulated: config.DRY_RUN || !keypair,
        reason: riskCheck.reason,
        discordUserId
      };
      emitEvent('skip', rejectedResult);
      return rejectedResult;
    }

    const amountLamports = Math.round(amountSol * 1e9);
    let quoteData = null;

    try {
      quoteData = await this.fetchJupiterQuote(mint, amountLamports);
    } catch (err) {
      console.warn(`[TRADE] Impossibile ottenere quotazione Jupiter per ${symbol}: ${err.message}`);
      const failedResult = {
        candidate,
        amountSol,
        executed: false,
        simulated: config.DRY_RUN || !keypair,
        reason: `Impossibile ottenere quotazione DEX Jupiter: ${err.message}`,
        discordUserId
      };
      emitEvent('skip', failedResult);
      return failedResult;
    }

    const outAmountTokens = quoteData.outAmount ? (quoteData.outAmount / Math.pow(10, quoteData.outputMintDecimals || 6)) : 0;
    console.log(`[TRADE] Quotazione Jupiter ottenuta: ${amountSol} SOL -> ~${outAmountTokens} ${symbol}`);

    const isDryRun = config.DRY_RUN || !keypair;

    if (isDryRun) {
      console.log(`[TRADE] [SIMULAZIONE DRY_RUN] Trade per ${symbol} SIMULATO con successo per ${keypair ? keypair.publicKey.toBase58().slice(0, 8) + '...' : 'Default Wallet'}.`);
      riskManager.recordSpend(amountSol);

      const simResult = {
        candidate,
        amountSol,
        outAmountTokens,
        executed: true,
        simulated: true,
        txHash: null,
        discordUserId,
        reason: `Trade SIMULATO con successo (DRY_RUN=${config.DRY_RUN})`
      };

      emitEvent('trade', simResult);
      return simResult;
    }

    console.log(`[TRADE] [LIVE TRADING] Invio transazione reale su Solana per ${symbol} (Wallet: ${keypair.publicKey.toBase58().slice(0, 8)}...)...`);

    try {
      const userPublicKey = keypair.publicKey.toBase58();

      // Verifica saldo SOL del wallet prima dell'invio della transazione
      const balanceLamports = await this.connection.getBalance(keypair.publicKey);
      const balanceSol = balanceLamports / 1e9;
      const requiredSol = amountSol + 0.005; // Importo trade + stima fee

      if (balanceSol < requiredSol) {
        const warnMsg = `Saldo SOL insufficiente nel wallet ${userPublicKey.slice(0, 8)}... (Disponibili: ${balanceSol.toFixed(4)} SOL, Richiesti: ${requiredSol.toFixed(4)} SOL). Deposita SOL per attivare il trading reale.`;
        console.warn(`[TRADE] ⚠️ ${warnMsg}`);
        const lowBalResult = {
          candidate,
          amountSol,
          executed: false,
          simulated: false,
          txHash: null,
          discordUserId,
          reason: warnMsg
        };
        emitEvent('skip', lowBalResult);
        return lowBalResult;
      }

      const swapEndpoints = [
        'https://quote-api.jup.ag/v6/swap',
        'https://api.jup.ag/swap/v1/swap'
      ];

      let swapRes = null;
      let swapError = null;

      for (const endpoint of swapEndpoints) {
        try {
          swapRes = await smartFetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'MemeCoinBot/1.0'
            },
            body: JSON.stringify({
              quoteResponse: quoteData,
              userPublicKey,
              wrapAndUnwrapSol: true
            })
          });
          if (swapRes && swapRes.ok) break;
        } catch (err) {
          swapError = err;
        }
      }

      if (!swapRes || !swapRes.ok) {
        throw new Error(`Risposta Jupiter Swap API non OK: ${swapError?.message || 'Endpoint non raggiungibili'}`);
      }

      const { swapTransaction } = await swapRes.json();
      if (!swapTransaction) {
        throw new Error('Jupiter Swap API non ha restituito la transazione di swap');
      }

      const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
      transaction.sign([keypair]);

      const rawTransaction = transaction.serialize();
      const txHash = await this.connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        maxRetries: 3
      });

      console.log(`[TRADE] Transazione inviata! Hash: ${txHash}. In attesa di conferma...`);
      await this.connection.confirmTransaction(txHash, 'confirmed');

      console.log(`[TRADE] Transazione ${txHash} CONFERMATA on-chain per ${userPublicKey.slice(0, 8)}...!`);
      riskManager.recordSpend(amountSol);
      
      if (discordUserId) {
        const candidateStats = {
          liquidityUsd: candidate.liquidityUsd || 0,
          volume5mUsd: candidate.volume5mUsd || 0,
          volume24hUsd: candidate.volume24hUsd || 0,
          buys5m: candidate.buys5m || 0,
          priceChange24h: candidate.priceChange24h || 0,
          priceUsd: candidate.priceUsd || 0,
          rugCheckScore: candidate._rugCheckScore || 0,
          insiderMetrics: candidate._insiderMetrics || { insidersDetected: 0, top10Concentration: 0, creatorBalance: 0 },
          contractFeatures: candidate._contractFeatures || { lpLockedPct: 0, mintAuthorityRevoked: 0, freezeAuthorityRevoked: 0 },
          temporalFeatures: candidate._temporalFeatures || { priceVelocity1m: 0, volumeVelocity1m: 0, priceVelocity3m: 0, volumeVelocity3m: 0, tokenAgeMinutes: 0 },
          suggestedTp: candidate._suggestedTp || 50,
          suggestedSl: candidate._suggestedSl || -20
        };
        userDatabase.addLivePosition(discordUserId, mint, amountSol, outAmountTokens, symbol, candidateStats);
      }

      const liveResult = {
        candidate,
        amountSol,
        outAmountTokens,
        executed: true,
        simulated: false,
        txHash,
        discordUserId,
        reason: 'Trade ESEGUITO e CONFERMATO on-chain su Solana'
      };

      emitEvent('trade', liveResult);
      return liveResult;
    } catch (err) {
      const safeErrorMessage = err.message || 'Errore di rete/RPC imprevisto';
      console.error(`[TRADE] [ERRORE CRITICO] Fallimento transazione reale on-chain per ${symbol}: ${safeErrorMessage}`);

      const errorResult = {
        candidate,
        amountSol,
        executed: false,
        simulated: false,
        txHash: null,
        discordUserId,
        reason: `ERRORE LIVE TRADING: ${safeErrorMessage}`
      };

      emitEvent('skip', errorResult);
      return errorResult;
    }
  }

  async executeSellForSingleWallet(discordUserId, mint, tokenAmount, symbol, reason) {
    const user = userDatabase.users.get(discordUserId);
    if (!user) throw new Error('Utente non trovato');
    
    const keypair = userDatabase.getUserKeypair(discordUserId);
    if (!keypair) throw new Error('Chiave privata non valida');

    console.log(`[TRADE-SELL] Avvio auto-vendita per ${symbol} (${mint}) - Quantità: ${tokenAmount}`);

    // Lamports per la quotazione di vendita (token -> SOL)
    // Dobbiamo usare l'ammontare esatto in base ai decimali.
    // Usiamo amount per il quote, la API di Jupiter accetta un int in stringa. 
    // Per semplificare passiamo prima per i metadata o assumiamo che amount * 10^decimals sia stato convertito correttamente, 
    // ma siccome tokenAmount = uiAmount, per Jupiter serve l'ammontare in raw units.
    // Cerchiamo i raw units tramite fetch account balance.
    let rawAmount = 0;
    try {
      const accounts = await this.connection.getParsedTokenAccountsByOwner(keypair.publicKey, { mint: new PublicKey(mint) });
      if (accounts.value.length > 0) {
        rawAmount = accounts.value[0].account.data.parsed.info.tokenAmount.amount;
      }
    } catch (e) {
      console.warn(`[TRADE-SELL] Errore fetch token balance per ${mint}: ${e.message}`);
    }

    if (!rawAmount || rawAmount === '0') {
      throw new Error(`Nessun token ${symbol} trovato nel wallet per vendere.`);
    }

    const quoteData = await this.fetchJupiterQuote(WSOL_MINT, rawAmount, mint);
    const estimatedSolOut = (Number(quoteData.outAmount) || 0) / 1e9;
    if (estimatedSolOut <= 0) throw new Error("Quotazione non valida ricevuta dal DEX");
    console.log(`[TRADE-SELL] Quotazione di vendita: ${symbol} -> ~${estimatedSolOut.toFixed(4)} SOL`);

    const userPublicKey = keypair.publicKey.toBase58();

    const swapEndpoints = [
      'https://quote-api.jup.ag/v6/swap',
      'https://api.jup.ag/swap/v1/swap'
    ];

    let swapRes = null;
    let swapError = null;

    for (const endpoint of swapEndpoints) {
      try {
        swapRes = await smartFetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'MemeCoinBot/1.0'
          },
          body: JSON.stringify({
            quoteResponse: quoteData,
            userPublicKey,
            wrapAndUnwrapSol: true
          })
        });
        if (swapRes && swapRes.ok) break;
      } catch (err) {
        swapError = err;
      }
    }

    if (!swapRes || !swapRes.ok) {
      throw new Error(`Risposta Jupiter Swap API non OK (Sell): ${swapError?.message || 'Endpoint non raggiungibili'}`);
    }

    const { swapTransaction } = await swapRes.json();
    const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    transaction.sign([keypair]);

    const txHash = await this.connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      maxRetries: 3
    });

    console.log(`[TRADE-SELL] Transazione di vendita inviata! Hash: ${txHash}. Attesa di conferma...`);
    await this.connection.confirmTransaction(txHash, 'confirmed');
    console.log(`[TRADE-SELL] Transazione ${txHash} CONFERMATA on-chain per ${userPublicKey.slice(0, 8)}`);

    userDatabase.removeLivePosition(discordUserId, mint);

    const sellResult = {
      discordUserId,
      mint,
      symbol,
      tokenAmount,
      solReceived: estimatedSolOut,
      txHash,
      reason
    };

    emitEvent('trade-sell', sellResult);
    return sellResult;
  }
}

export const tradeExecutor = new TradeExecutor();
