import { Connection, PublicKey } from '@solana/web3.js';
import { config } from './config.js';
import { userDatabase } from './userDatabase.js';
import { emitEvent } from './events.js';

class BalanceMonitor {
  constructor() {
    this.connection = new Connection(config.SOLANA_RPC_URL, 'confirmed');
    this.lastBalances = new Map();
    this.intervalId = null;
  }

  start() {
    console.log('[BALANCE-MONITOR] Avvio monitoraggio portafogli utenti...');
    // Controlla ogni 30 secondi (30000 ms)
    this.intervalId = setInterval(() => this.checkBalances(), 120000);
    this.checkBalances();
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async checkBalances() {
    try {
      const users = Array.from(userDatabase.users.values());
      for (const user of users) {
        if (!user.publicKey) continue;
        
        try {
          const pubKey = new PublicKey(user.publicKey);
          const balanceLamports = await this.connection.getBalance(pubKey);
          const balanceSol = balanceLamports / 1e9;
          
          const lastBalance = this.lastBalances.get(user.discordUserId);
          
          // Avvisiamo solo se il saldo è aumentato (deposito)
          // Usiamo una soglia di 0.005 SOL per evitare notifiche su piccole variazioni o errori di approssimazione
          if (lastBalance !== undefined && balanceSol > lastBalance + 0.005) {
            const depositAmount = balanceSol - lastBalance;
            console.log(`[BALANCE-MONITOR] Rilevato deposito di ${depositAmount.toFixed(4)} SOL per l'utente ${user.discordUserId}`);
            emitEvent('deposit', {
              discordUserId: user.discordUserId,
              depositAmount,
              newBalance: balanceSol,
              publicKey: user.publicKey
            });
          }
          
          this.lastBalances.set(user.discordUserId, balanceSol);
        } catch (err) {
          if (!err.message.includes('fetch failed') && !err.message.includes('Too Many Requests')) {
            console.error(`[BALANCE-MONITOR] Errore controllo saldo per utente ${user.discordUserId}:`, err.message);
          }
        }
      }
    } catch (err) {
      console.error('[BALANCE-MONITOR] Errore generale durante il controllo saldi:', err.message);
    }
  }
}

export const balanceMonitor = new BalanceMonitor();
