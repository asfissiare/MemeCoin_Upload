import { config } from './config.js';

export class RiskManager {
  constructor() {
    this.spentTodaySol = 0;
    this.killSwitchActive = false;
    this.killSwitchReason = '';
    this.killSwitchAuthor = '';
    this.killSwitchTimestamp = null;
    this.currentDayString = this.getTodayDateString();
  }

  getTodayDateString() {
    return new Date().toISOString().split('T')[0]; // Format YYYY-MM-DD (UTC)
  }

  checkDailyReset() {
    const today = this.getTodayDateString();
    if (today !== this.currentDayString) {
      console.log(`[RISK] Reset contatore spesa giornaliero (${this.spentTodaySol} SOL spesi il ${this.currentDayString}). Nuovo giorno: ${today}`);
      this.spentTodaySol = 0;
      this.currentDayString = today;
    }
  }

  evaluateTrade(amountSol) {
    this.checkDailyReset();

    if (this.killSwitchActive) {
      return {
        allowed: false,
        reason: `Kill switch ATTIVO. Motivo: ${this.killSwitchReason} (da user: ${this.killSwitchAuthor || 'sistema'} il ${this.killSwitchTimestamp})`
      };
    }

    if (amountSol > config.MAX_SOL_PER_TRADE) {
      return {
        allowed: false,
        reason: `Importo trade (${amountSol} SOL) supera il massimo consentito per singolo trade (${config.MAX_SOL_PER_TRADE} SOL).`
      };
    }

    if (this.spentTodaySol + amountSol > config.MAX_SOL_PER_DAY) {
      const remaining = Math.max(0, config.MAX_SOL_PER_DAY - this.spentTodaySol);
      return {
        allowed: false,
        reason: `Importo trade (${amountSol} SOL) supererebbe il limite di spesa giornaliero di ${config.MAX_SOL_PER_DAY} SOL. (Spesi oggi: ${this.spentTodaySol.toFixed(4)} SOL, Rimanente: ${remaining.toFixed(4)} SOL).`
      };
    }

    return {
      allowed: true,
      reason: 'Trade autorizzato dai controlli del Risk Manager.'
    };
  }

  recordSpend(amountSol) {
    this.checkDailyReset();
    this.spentTodaySol = Number((this.spentTodaySol + amountSol).toFixed(6));
    console.log(`[RISK] Registrata spesa di ${amountSol} SOL. Totale speso oggi: ${this.spentTodaySol.toFixed(4)} / ${config.MAX_SOL_PER_DAY} SOL.`);
  }

  activateKillSwitch(reason = 'Attivazione manuale / di emergenza', authorId = 'system') {
    this.killSwitchActive = true;
    this.killSwitchReason = reason;
    this.killSwitchAuthor = authorId;
    this.killSwitchTimestamp = new Date().toISOString();
    console.warn(`[RISK] KILL SWITCH ATTIVATO da ${authorId}. Motivo: ${reason}`);
    return this.getStatus();
  }

  deactivateKillSwitch(reason = 'Disattivazione manuale', authorId = 'system') {
    this.killSwitchActive = false;
    this.killSwitchReason = '';
    this.killSwitchAuthor = authorId;
    this.killSwitchTimestamp = new Date().toISOString();
    console.log(`[RISK] KILL SWITCH DISATTIVATO da ${authorId}. Motivo: ${reason}`);
    return this.getStatus();
  }

  getStatus() {
    this.checkDailyReset();
    const remainingToday = Math.max(0, config.MAX_SOL_PER_DAY - this.spentTodaySol);
    return {
      dryRun: config.DRY_RUN,
      spentTodaySol: this.spentTodaySol,
      maxSolPerDay: config.MAX_SOL_PER_DAY,
      maxSolPerTrade: config.MAX_SOL_PER_TRADE,
      remainingTodaySol: remainingToday,
      killSwitchActive: this.killSwitchActive,
      killSwitchReason: this.killSwitchReason,
      killSwitchAuthor: this.killSwitchAuthor,
      killSwitchTimestamp: this.killSwitchTimestamp,
      date: this.currentDayString
    };
  }
}

export const riskManager = new RiskManager();
