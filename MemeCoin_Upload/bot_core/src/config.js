import dotenv from 'dotenv';
dotenv.config();

function parseBool(val, defaultVal = false) {
  if (val === undefined || val === null || val === '') return defaultVal;
  return String(val).trim().toLowerCase() === 'true' || String(val).trim() === '1';
}

function parseNumber(val, defaultVal) {
  const parsed = Number(val);
  return isNaN(parsed) ? defaultVal : parsed;
}

function parseList(val, defaultVal = []) {
  if (!val || typeof val !== 'string') return defaultVal;
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

export const config = {
  SOLANA_RPC_URL: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  WALLET_PRIVATE_KEY: process.env.WALLET_PRIVATE_KEY || '',
  DRY_RUN: parseBool(process.env.DRY_RUN, true),
  MAX_SOL_PER_TRADE: parseNumber(process.env.MAX_SOL_PER_TRADE, 0.05),
  MAX_SOL_PER_DAY: parseNumber(process.env.MAX_SOL_PER_DAY, 0.2),
  MIN_LIQUIDITY_USD: parseNumber(process.env.MIN_LIQUIDITY_USD, 5000),
  DEX_MIN_VOLUME_24H_USD: parseNumber(process.env.DEX_MIN_VOLUME_24H_USD, 10000),
  DEX_POLL_INTERVAL_MS: parseNumber(process.env.DEX_POLL_INTERVAL_MS, 15000),
  MIN_RUGCHECK_SCORE: parseNumber(process.env.MIN_RUGCHECK_SCORE, 60),
  SLIPPAGE_BPS: parseNumber(process.env.SLIPPAGE_BPS, 300),
  TWITTER_KEYWORDS: parseList(process.env.TWITTER_KEYWORDS, []),
  NITTER_INSTANCES: parseList(process.env.NITTER_INSTANCES, [
    'https://nitter.privacydev.net',
    'https://nitter.poast.org'
  ]),
  TWITTER_POLL_INTERVAL_MS: parseNumber(process.env.TWITTER_POLL_INTERVAL_MS, 60000),
  DISCORD_TOKEN: process.env.DISCORD_TOKEN || '',
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID || '',
  DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID || '',
  DISCORD_CHANNEL_ID: process.env.DISCORD_CHANNEL_ID || '',
  DISCORD_OWNER_ID: process.env.DISCORD_OWNER_ID || '',
  DASHBOARD_PORT: parseNumber(process.env.DASHBOARD_PORT, 3000),
  ENABLED_CHAINS: parseList(process.env.ENABLED_CHAINS, ['solana']),
  MAX_CURRENCY_CHANNELS: parseNumber(process.env.MAX_CURRENCY_CHANNELS, 20),
  MIN_CHANNEL_PROFIT_SCORE: parseNumber(process.env.MIN_CHANNEL_PROFIT_SCORE, 75),
  AI_API_URL: process.env.AI_API_URL || 'http://localhost:4000',
  AI_MIN_SCORE: parseNumber(process.env.AI_MIN_SCORE, 60),
  TRAINING_MODE: parseBool(process.env.TRAINING_MODE, false)
};

export function validateConfig() {
  const warnings = [];
  const errors = [];

  if (config.MAX_SOL_PER_TRADE <= 0) {
    errors.push('MAX_SOL_PER_TRADE deve essere maggiore di 0.');
  }

  if (config.MAX_SOL_PER_DAY <= 0) {
    errors.push('MAX_SOL_PER_DAY deve essere maggiore di 0.');
  }

  if (config.MAX_SOL_PER_TRADE > config.MAX_SOL_PER_DAY) {
    warnings.push('ATTENZIONE: MAX_SOL_PER_TRADE è maggiore di MAX_SOL_PER_DAY.');
  }

  if (!config.DRY_RUN && !config.WALLET_PRIVATE_KEY) {
    warnings.push('SICUREZZA: DRY_RUN=false ma nessuna WALLET_PRIVATE_KEY è configurata. Il sistema forzerà la simulazione.');
  }

  if (!config.DISCORD_TOKEN) {
    warnings.push('AVVISO: DISCORD_TOKEN mancante. Il bot Discord non si connetterà finché non verrà fornito il token.');
  }

  if (!config.DISCORD_CLIENT_ID) {
    warnings.push('AVVISO: DISCORD_CLIENT_ID mancante. I comandi slash non potranno essere registrati su Discord.');
  }

  if (!config.DISCORD_OWNER_ID) {
    warnings.push('SICUREZZA: DISCORD_OWNER_ID non configurato. Il comando /killswitch sarà aperto a chiunque!');
  }

  console.log('================ CONFIGURAZIONE AVVIO ================');
  console.log(`[SYS] DRY_RUN Mode: ${config.DRY_RUN ? 'ABILITATO (Simulazione)' : 'DISABILITATO (LIVE TRADING)'}`);
  console.log(`[SYS] Training Mode: ${config.TRAINING_MODE ? 'ABILITATO (Silenzioso)' : 'DISABILITATO'}`);
  console.log(`[SYS] Wallet Configurato: ${config.WALLET_PRIVATE_KEY ? 'SÌ' : 'NO'}`);
  console.log(`[SYS] Max SOL/Trade: ${config.MAX_SOL_PER_TRADE} SOL | Max SOL/Giorno: ${config.MAX_SOL_PER_DAY} SOL`);
  console.log(`[SYS] Filtro Liquidità Min: $${config.MIN_LIQUIDITY_USD} | Volume 24h Min: $${config.DEX_MIN_VOLUME_24H_USD}`);
  console.log(`[SYS] Soglia RugCheck: ${config.MIN_RUGCHECK_SCORE}/100`);
  console.log(`[SYS] AI Evaluator: ${config.AI_API_URL ? `ATTIVO (Min Score: ${config.AI_MIN_SCORE})` : 'DISABILITATO'}`);

  if (warnings.length > 0) {
    console.log('\n--- AVVISI DI SICUREZZA E CONFIGURAZIONE ---');
    warnings.forEach(w => console.warn(`[WARN] ${w}`));
  }

  if (errors.length > 0) {
    console.error('\n--- ERRORE CONFIGURAZIONE CRITICO ---');
    errors.forEach(e => console.error(`[ERR] ${e}`));
    throw new Error('Configurazione non valida: ' + errors.join('; '));
  }

  console.log('======================================================\n');
}
