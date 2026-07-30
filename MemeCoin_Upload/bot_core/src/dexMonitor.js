import { config } from './config.js';
import { emitEvent } from './events.js';
import { tokenHistory } from './tokenHistory.js';

export class DexMonitor {
  constructor() {
    this.seenPairs = new Set();
    this.timer = null;
    this.isPolling = false;
  }

  start() {
    if (this.timer) return;
    console.log(`[DEX] Avvio DEX Monitor su feed multipli DexScreener (Polling ogni ${config.DEX_POLL_INTERVAL_MS} ms)...`);
    this.poll();
    this.timer = setInterval(() => this.poll(), config.DEX_POLL_INTERVAL_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[DEX] DEX Monitor fermato.');
    }
  }

  async poll() {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      const solanaMints = new Set();

      // Fonte 1: DexScreener Latest Token Boosts (Token Solana in tendenza/lancio)
      try {
        const boostsRes = await fetch('https://api.dexscreener.com/token-boosts/latest/v1', {
          headers: { 'User-Agent': 'MemeCoinBot/1.0' }
        });
        if (boostsRes.ok) {
          const boosts = await boostsRes.json();
          if (Array.isArray(boosts)) {
            boosts.filter(b => b.chainId === 'solana' && b.tokenAddress).forEach(b => solanaMints.add(b.tokenAddress));
          }
        }
      } catch (err) {
        // Silent catch for secondary feed
      }

      // Fonte 2: DexScreener Latest Token Profiles
      try {
        const profilesRes = await fetch('https://api.dexscreener.com/token-profiles/latest/v1', {
          headers: { 'User-Agent': 'MemeCoinBot/1.0' }
        });
        if (profilesRes.ok) {
          const profiles = await profilesRes.json();
          if (Array.isArray(profiles)) {
            profiles.filter(p => p.chainId === 'solana' && p.tokenAddress).forEach(p => solanaMints.add(p.tokenAddress));
          }
        }
      } catch (err) {
        // Silent catch
      }

      // Se abbiamo trovato mintAddress specifici da token-boosts/profiles, recuperiamo le coppie in batch
      const mintArray = Array.from(solanaMints);
      if (mintArray.length > 0) {
        // DexScreener consente fino a 30 token per chiamata (separati da virgola)
        for (let i = 0; i < mintArray.length; i += 20) {
          const chunk = mintArray.slice(i, i + 20).join(',');
          try {
            const pairsRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${chunk}`, {
              headers: { 'User-Agent': 'MemeCoinBot/1.0' }
            });
            if (pairsRes.ok) {
              const body = await pairsRes.json();
              if (Array.isArray(body.pairs)) {
                this.processPairs(body.pairs);
              }
            }
          } catch (err) {
            // Continue
          }
        }
      }

      // Fonte 3: Search Query Generale
      try {
        const searchRes = await fetch('https://api.dexscreener.com/latest/dex/search?q=solana', {
          headers: { 'User-Agent': 'MemeCoinBot/1.0' }
        });
        if (searchRes.ok) {
          const searchBody = await searchRes.json();
          if (Array.isArray(searchBody.pairs)) {
            this.processPairs(searchBody.pairs);
          }
        }
      } catch (err) {
        // Continue
      }

      // Fonte 4: Base Chain Search
      if (config.ENABLED_CHAINS.includes('base')) {
        try {
          const baseRes = await fetch('https://api.dexscreener.com/latest/dex/search?q=base', {
            headers: { 'User-Agent': 'MemeCoinBot/1.0' }
          });
          if (baseRes.ok) {
            const baseBody = await baseRes.json();
            if (Array.isArray(baseBody.pairs)) {
              this.processPairs(baseBody.pairs);
            }
          }
        } catch (err) {
          // Continue
        }
      }

      // Fonte 5: Ethereum Chain Search
      if (config.ENABLED_CHAINS.includes('ethereum')) {
        try {
          const ethRes = await fetch('https://api.dexscreener.com/latest/dex/search?q=ethereum', {
            headers: { 'User-Agent': 'MemeCoinBot/1.0' }
          });
          if (ethRes.ok) {
            const ethBody = await ethRes.json();
            if (Array.isArray(ethBody.pairs)) {
              this.processPairs(ethBody.pairs);
            }
          }
        } catch (err) {
          // Continue
        }
      }
    } catch (err) {
      console.warn(`[DEX] Errore durante il polling DexScreener: ${err.message}`);
    } finally {
      this.isPolling = false;
    }
  }

  processPairs(pairs) {
    for (const pair of pairs) {
      if (!pair || !config.ENABLED_CHAINS.includes(pair.chainId)) continue;

      const pairAddress = pair.pairAddress;
      if (!pairAddress) continue;

      const liquidityUsd = Number(pair.liquidity?.usd || 0);
      const volume24hUsd = Number(pair.volume?.h24 || 0);
      const volume5mUsd = Number(pair.volume?.m5 || 0);
      const buys5m = Number(pair.txns?.m5?.buys || 0);

      const mintAddress = pair.baseToken?.address;
      if (!mintAddress) continue;

      // Record snapshot for ALL tokens (even already seen) to build temporal history
      tokenHistory.record(mintAddress, {
        priceUsd: Number(pair.priceUsd || 0),
        volume5mUsd: volume5mUsd,
        liquidityUsd,
        buys5m,
        priceNative: Number(pair.priceNative || 0)
      });

      // Skip already-seen pairs for candidate emission
      if (this.seenPairs.has(pairAddress)) continue;

      // Apply filters only to NEW candidates
      if (liquidityUsd < config.MIN_LIQUIDITY_USD) continue;
      if (volume24hUsd < config.DEX_MIN_VOLUME_24H_USD) continue;
      if (buys5m === 0 && volume5mUsd === 0 && pair.volume?.m5 !== undefined) continue;

      this.seenPairs.add(pairAddress);

      const candidateData = {
        pairAddress,
        mint: mintAddress,
        symbol: pair.baseToken?.symbol || 'UNKNOWN',
        name: pair.baseToken?.name || 'Unknown Token',
        priceUsd: Number(pair.priceUsd || 0),
        liquidityUsd,
        volume24hUsd,
        volume5mUsd,
        buys5m,
        priceChange24h: Number(pair.priceChange?.h24 || 0),
        url: pair.url || `https://dexscreener.com/solana/${pairAddress}`,
        dexId: pair.dexId || 'unknown',
        chain: pair.chainId || 'solana'
      };

      console.log(`[DEX] Candidato trovato: ${candidateData.name} (${candidateData.symbol}) [${pair.chainId}] | Mint: ${candidateData.mint} | Liq: $${liquidityUsd.toLocaleString()} | Vol5m: $${volume5mUsd.toLocaleString()}`);
      emitEvent('candidate', candidateData);
    }
  }
}
