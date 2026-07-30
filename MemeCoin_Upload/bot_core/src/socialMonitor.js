import Parser from 'rss-parser';
import { config } from './config.js';
import { emitEvent } from './events.js';

export class SocialMonitor {
  constructor() {
    this.parser = new Parser();
    this.seenPosts = new Set();
    this.timer = null;
    this.currentInstanceIndex = 0;
    this.isPolling = false;
  }

  start() {
    if (config.TWITTER_KEYWORDS.length === 0) {
      console.log('[SOCIAL] Niente keyword configurate (TWITTER_KEYWORDS vuoto). Modulo social disattivo.');
      return;
    }
    if (this.timer) return;

    console.log(`[SOCIAL] Avvio Social Monitor (Keywords: ${config.TWITTER_KEYWORDS.join(', ')})...`);
    this.poll();
    this.timer = setInterval(() => this.poll(), config.TWITTER_POLL_INTERVAL_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[SOCIAL] Social Monitor fermato.');
    }
  }

  async fetchInstanceRss(instanceUrl, keyword) {
    const rssUrl = `${instanceUrl.replace(/\/$/, '')}/search/rss?q=${encodeURIComponent(keyword)}`;
    const feed = await this.parser.parseURL(rssUrl);
    return feed;
  }

  async poll() {
    if (this.isPolling || config.TWITTER_KEYWORDS.length === 0) return;
    this.isPolling = true;

    const instances = config.NITTER_INSTANCES;
    if (instances.length === 0) {
      console.warn('[SOCIAL] Nessuna istanza Nitter configurata.');
      this.isPolling = false;
      return;
    }

    try {
      for (const keyword of config.TWITTER_KEYWORDS) {
        let success = false;

        // Prova le istanze Nitter in ordine con fallback
        for (let i = 0; i < instances.length; i++) {
          const idx = (this.currentInstanceIndex + i) % instances.length;
          const instanceUrl = instances[idx];

          try {
            const feed = await this.fetchInstanceRss(instanceUrl, keyword);
            const items = feed.items || [];

            for (const item of items) {
              const postId = item.guid || item.link;
              if (!postId || this.seenPosts.has(postId)) continue;

              this.seenPosts.add(postId);

              const mentionData = {
                keyword,
                title: item.title || '',
                snippet: item.contentSnippet || item.content || '',
                link: item.link || '',
                pubDate: item.pubDate || new Date().toISOString(),
                instanceUsed: instanceUrl
              };

              console.log(`[SOCIAL] Menzia trovata per '${keyword}': ${mentionData.title.slice(0, 60)}...`);
              emitEvent('social-mention', mentionData);
            }

            success = true;
            this.currentInstanceIndex = idx;
            break; // Istanza riuscita per questa keyword
          } catch (err) {
            console.warn(`[SOCIAL] Fallimento istanza ${instanceUrl} per '${keyword}': ${err.message}. Tenta la prossima...`);
          }
        }

        if (!success) {
          console.warn(`[SOCIAL] Impossibile raggiungere alcuna istanza Nitter per la keyword '${keyword}'. Degrado no-op.`);
        }
      }
    } catch (err) {
      console.warn(`[SOCIAL] Errore imprevisto nel polling social: ${err.message}`);
    } finally {
      this.isPolling = false;
    }
  }
}
