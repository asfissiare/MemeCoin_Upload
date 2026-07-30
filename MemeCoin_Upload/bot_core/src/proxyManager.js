import { HttpsProxyAgent } from 'https-proxy-agent';

export class ProxyManager {
  constructor() {
    this.proxies = [];
    this.workingProxies = [];
    this.currentIndex = 0;
    this.isRefreshing = false;
    this.refreshInterval = 10 * 60 * 1000; // Refreshes proxy list every 10 minutes
    this.timer = null;
  }

  async start() {
    console.log('[PROXY] Inizializzazione Proxy Manager & scraping proxy gratuiti in background...');
    await this.refreshProxies();
    if (!this.timer) {
      this.timer = setInterval(() => this.refreshProxies(), this.refreshInterval);
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[PROXY] Proxy Manager fermato.');
    }
  }

  async refreshProxies() {
    if (this.isRefreshing) return;
    this.isRefreshing = true;

    try {
      const scraped = new Set();

      // Fonte 1: Proxyscrape HTTP API
      try {
        const res = await fetch('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=3000&country=all&ssl=all&anonymity=all');
        if (res.ok) {
          const text = await res.text();
          text.split(/\r?\n/).forEach(line => {
            const p = line.trim();
            if (p && p.includes(':')) scraped.add(`http://${p}`);
          });
        }
      } catch (err) {
        // Silent catch for individual proxy source failure
      }

      // Fonte 2: GitHub Proxy List (TheSpeedX)
      try {
        const res = await fetch('https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt');
        if (res.ok) {
          const text = await res.text();
          text.split(/\r?\n/).forEach(line => {
            const p = line.trim();
            if (p && p.includes(':')) scraped.add(`http://${p}`);
          });
        }
      } catch (err) {
        // Silent catch
      }

      // Fonte 3: GitHub Proxy List (monosans)
      try {
        const res = await fetch('https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt');
        if (res.ok) {
          const text = await res.text();
          text.split(/\r?\n/).forEach(line => {
            const p = line.trim();
            if (p && p.includes(':')) scraped.add(`http://${p}`);
          });
        }
      } catch (err) {
        // Silent catch
      }

      const allScraped = Array.from(scraped);
      console.log(`[PROXY] Trovati ${allScraped.length} proxy unici. Verifica reattività rapida in corso...`);

      // Test di connettività parallelo veloce per isolare i proxy attivi e veloci (<2000ms timeout)
      const validated = [];
      const testPromises = allScraped.slice(0, 80).map(async (proxyUrl) => {
        try {
          const agent = new HttpsProxyAgent(proxyUrl);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 2500);

          const testRes = await fetch('https://api.rugcheck.xyz/v1/stats', {
            agent,
            signal: controller.signal
          });
          clearTimeout(timeout);

          if (testRes.ok || testRes.status === 404 || testRes.status === 429) {
            validated.push(proxyUrl);
          }
        } catch (err) {
          // Proxy non reattivo o timeout
        }
      });

      await Promise.allSettled(testPromises);

      this.workingProxies = validated;
      console.log(`[PROXY] Proxy funzionanti verificati pronti all'uso: ${this.workingProxies.length} proxyattivi.`);
    } catch (err) {
      console.warn(`[PROXY] Avviso durante lo scraping dei proxy: ${err.message}`);
    } finally {
      this.isRefreshing = false;
    }
  }

  // Restituisce un HttpsProxyAgent a rotazione (Round-Robin) oppure null se nessun proxy attivo
  getNextAgent() {
    if (this.workingProxies.length === 0) {
      return null;
    }
    const proxyUrl = this.workingProxies[this.currentIndex % this.workingProxies.length];
    this.currentIndex++;
    return new HttpsProxyAgent(proxyUrl);
  }

  // Wrapper fetch che applica automaticamente la rotazione proxy con fallback alla connessione diretta
  async fetchWithProxy(url, options = {}) {
    const agent = this.getNextAgent();
    const fetchOptions = { ...options };

    if (agent) {
      fetchOptions.agent = agent;
    }

    try {
      const res = await fetch(url, fetchOptions);
      return res;
    } catch (err) {
      // Se la richiesta con proxy fallisce, tenta il fallback diretto senza proxy per evitare di perdere la chiamata
      if (agent) {
        const directOptions = { ...options };
        delete directOptions.agent;
        return fetch(url, directOptions);
      }
      throw err;
    }
  }
}

export const proxyManager = new ProxyManager();
