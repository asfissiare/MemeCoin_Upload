export const locales = {
  en: {
    dashboard_secret_link: "Here is your secret Web Dashboard link:\n\n",
    wallet_not_registered: "You haven't registered any wallet.",
    wallet_balance: "**Your Wallet:**\nBalance: **{{balance}} SOL**",
    kill_switch_activated: "Kill Switch ACTIVATED.",
    kill_switch_deactivated: "Kill Switch DEACTIVATED.",
    unauthorized: "You are not authorized to use this command.",
    trial_activated: "Paper trading mode activated!",
    language_updated: "Language successfully updated to English! 🇬🇧",
    dashboard_channel_msg: "Access the updated public dashboard by clicking the link below:\n\n**[🌐 Open Web Dashboard]({{url}})**\n\n*Note: The dashboard updates in real-time showing proxies, live PnL, and detected coins.*",
    deposit_received: "We detected a new deposit to your Solana trading wallet!",
    deposit_amount: "Amount Deposited",
    new_balance: "New Total Balance",
    live_pnl: "LIVE PNL",
    tp_sl_hint: "Use /wallet config to change TP/SL.",
    rugcheck_fail: "RugCheck Failed! Coin is dangerous.",
    ai_rejected: "AI Rejected the coin.",
    buy_success: "Bought {{amount}} SOL of {{symbol}}!",
    sell_success: "Sold {{symbol}}! Profit: {{profit}} SOL."
  },
  it: {
    dashboard_secret_link: "Ecco il tuo link segreto alla Dashboard Web:\n\n",
    wallet_not_registered: "Non hai nessun wallet registrato.",
    wallet_balance: "**Il tuo Wallet:**\nSaldo: **{{balance}} SOL**",
    kill_switch_activated: "Kill Switch ATTIVATO.",
    kill_switch_deactivated: "Kill Switch DISATTIVATO.",
    unauthorized: "Non sei autorizzato ad usare questo comando.",
    trial_activated: "Modalità simulazione attivata!",
    language_updated: "Lingua aggiornata con successo all'Italiano! 🇮🇹",
    dashboard_channel_msg: "Accedi alla dashboard pubblica aggiornata cliccando sul link qui sotto:\n\n**[🌐 Apri Dashboard Web]({{url}})**\n\n*Nota: la dashboard si aggiorna in tempo reale mostrando proxy, PnL live e le coin rilevate.*",
    deposit_received: "Abbiamo rilevato un nuovo deposito sul tuo portafoglio Solana di trading!",
    deposit_amount: "Importo Depositato",
    new_balance: "Nuovo Saldo Totale",
    live_pnl: "PNL LIVE",
    tp_sl_hint: "Usa /wallet config per modificare TP/SL.",
    rugcheck_fail: "RugCheck Fallito! La moneta è pericolosa.",
    ai_rejected: "L'AI ha scartato la moneta.",
    buy_success: "Comprato {{amount}} SOL di {{symbol}}!",
    sell_success: "Venduto {{symbol}}! Profitto: {{profit}} SOL."
  }
};

export function t(key, lang = 'en', replacements = {}) {
  const dictionary = locales[lang] || locales['en'];
  let text = dictionary[key] || locales['en'][key] || key;
  for (const [k, v] of Object.entries(replacements)) {
    text = text.replace(new RegExp(`{{${k}}}`, 'g'), v);
  }
  return text;
}
