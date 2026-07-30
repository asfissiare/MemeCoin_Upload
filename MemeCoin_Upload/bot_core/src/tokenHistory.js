/**
 * TokenHistory - In-memory temporal cache for token price/volume snapshots.
 * Stores rolling snapshots of market data for each token seen by the DexMonitor.
 * Used by the AI to compute momentum/velocity features (price change over 1m, 3m, etc.)
 * 
 * No extra API calls — piggybacks on DexMonitor polling data.
 */

const MAX_SNAPSHOTS_PER_TOKEN = 20;  // ~5 minutes of data at 15s polling
const MAX_TOKENS_CACHED = 500;       // Evict oldest tokens if we exceed this
const EVICTION_THRESHOLD = 600;      // Remove tokens not seen in 10 minutes (ms: 600000)

class TokenHistory {
  constructor() {
    /** @type {Map<string, { snapshots: Array, firstSeen: number }>} */
    this.cache = new Map();
    
    // Periodic cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 300000);
  }

  /**
   * Record a snapshot for a token mint address.
   * Called by DexMonitor on every poll cycle for every pair seen.
   */
  record(mintAddress, data) {
    const now = Date.now();
    const snapshot = {
      timestamp: now,
      priceUsd: data.priceUsd || 0,
      volume5m: data.volume5mUsd || data.volume5m || 0,
      liquidityUsd: data.liquidityUsd || 0,
      buys5m: data.buys5m || 0,
      priceNative: data.priceNative || 0
    };

    if (!this.cache.has(mintAddress)) {
      this.cache.set(mintAddress, {
        snapshots: [snapshot],
        firstSeen: now
      });
    } else {
      const entry = this.cache.get(mintAddress);
      entry.snapshots.push(snapshot);
      
      // Keep only the most recent N snapshots
      if (entry.snapshots.length > MAX_SNAPSHOTS_PER_TOKEN) {
        entry.snapshots = entry.snapshots.slice(-MAX_SNAPSHOTS_PER_TOKEN);
      }
    }
  }

  /**
   * Get the temporal features for a token.
   * Returns computed velocity/momentum metrics for the AI.
   */
  getTemporalFeatures(mintAddress) {
    const defaults = {
      priceVelocity1m: 0,
      volumeVelocity1m: 0,
      priceVelocity3m: 0,
      volumeVelocity3m: 0,
      tokenAgeMinutes: 0,
      snapshotCount: 0
    };

    const entry = this.cache.get(mintAddress);
    if (!entry || entry.snapshots.length < 2) return defaults;

    const now = Date.now();
    const latest = entry.snapshots[entry.snapshots.length - 1];

    // Find snapshot closest to 1 minute ago
    const snap1m = this._findClosestSnapshot(entry.snapshots, now - 60000);
    // Find snapshot closest to 3 minutes ago
    const snap3m = this._findClosestSnapshot(entry.snapshots, now - 180000);

    const result = { ...defaults };
    result.snapshotCount = entry.snapshots.length;
    result.tokenAgeMinutes = (now - entry.firstSeen) / 60000;

    // Price velocity: % change per minute
    if (snap1m && latest.priceUsd > 0 && snap1m.priceUsd > 0) {
      const timeDeltaMin = Math.max(0.25, (latest.timestamp - snap1m.timestamp) / 60000);
      const priceChange = ((latest.priceUsd - snap1m.priceUsd) / snap1m.priceUsd) * 100;
      result.priceVelocity1m = priceChange / timeDeltaMin;
    }

    // Volume velocity: ratio of current vs past volume (>1 = accelerating, <1 = decelerating)
    if (snap1m && snap1m.volume5m > 0) {
      result.volumeVelocity1m = latest.volume5m / snap1m.volume5m;
    }

    if (snap3m && latest.priceUsd > 0 && snap3m.priceUsd > 0) {
      const timeDeltaMin = Math.max(0.5, (latest.timestamp - snap3m.timestamp) / 60000);
      const priceChange = ((latest.priceUsd - snap3m.priceUsd) / snap3m.priceUsd) * 100;
      result.priceVelocity3m = priceChange / timeDeltaMin;
    }

    if (snap3m && snap3m.volume5m > 0) {
      result.volumeVelocity3m = latest.volume5m / snap3m.volume5m;
    }

    return result;
  }

  /**
   * Find the snapshot closest to a target timestamp.
   * Returns null if the closest snapshot is more than 2 minutes away from target.
   */
  _findClosestSnapshot(snapshots, targetTime) {
    let closest = null;
    let closestDist = Infinity;

    for (const snap of snapshots) {
      const dist = Math.abs(snap.timestamp - targetTime);
      if (dist < closestDist) {
        closestDist = dist;
        closest = snap;
      }
    }

    // Don't return stale data — if the closest is >2 minutes from the target, skip
    if (closestDist > 120000) return null;
    return closest;
  }

  /**
   * Cleanup stale entries from the cache.
   */
  cleanup() {
    const now = Date.now();
    const staleThreshold = now - (EVICTION_THRESHOLD * 1000);
    let evicted = 0;

    for (const [mint, entry] of this.cache.entries()) {
      const lastSnapshot = entry.snapshots[entry.snapshots.length - 1];
      if (lastSnapshot.timestamp < staleThreshold) {
        this.cache.delete(mint);
        evicted++;
      }
    }

    // If still too many, evict oldest
    if (this.cache.size > MAX_TOKENS_CACHED) {
      const sorted = [...this.cache.entries()].sort((a, b) => {
        const aLast = a[1].snapshots[a[1].snapshots.length - 1].timestamp;
        const bLast = b[1].snapshots[b[1].snapshots.length - 1].timestamp;
        return aLast - bLast;
      });

      const toEvict = sorted.slice(0, this.cache.size - MAX_TOKENS_CACHED);
      for (const [mint] of toEvict) {
        this.cache.delete(mint);
        evicted++;
      }
    }

    if (evicted > 0) {
      console.log(`[TOKEN-HISTORY] Pulizia cache: ${evicted} token rimossi, ${this.cache.size} attivi.`);
    }
  }

  /**
   * Get cache stats for dashboard/monitoring.
   */
  getStats() {
    return {
      tokensTracked: this.cache.size,
      totalSnapshots: [...this.cache.values()].reduce((sum, e) => sum + e.snapshots.length, 0)
    };
  }
}

export const tokenHistory = new TokenHistory();
