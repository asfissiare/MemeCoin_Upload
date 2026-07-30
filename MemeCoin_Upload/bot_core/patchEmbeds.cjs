const fs = require('fs');
const file = 'src/discordClient.js';
let content = fs.readFileSync(file, 'utf8');

// Helper to convert simple content replies to embeds
// For example: { content: 'Modalità simulazione attivata!', ephemeral: true }
// to: { embeds: [new EmbedBuilder().setDescription('Modalità simulazione attivata!').setColor('#00f3ff')], ephemeral: true }

// Regex to catch content: '...', content: `...`, content: variable + '...'
// It's safer to just replace all `content: ` with `embeds: [new EmbedBuilder().setColor('#00f3ff').setDescription(` and then find the closing bracket if possible.

// But simpler: just replace specific known strings.
content = content.replace(/content: 'Modalit simulazione attivata!'/g, "embeds: [new EmbedBuilder().setDescription('Modalità simulazione attivata!').setColor('#00f3ff')]");
content = content.replace(/content: 'Non sei autorizzato ad usare questo comando.'/g, "embeds: [new EmbedBuilder().setDescription('Non sei autorizzato ad usare questo comando.').setColor('#ff0000')]");
content = content.replace(/content: 'Kill Switch ' \+ \(attiva \? 'ATTIVATO' : 'DISATTIVATO'\) \+ '\.'/g, "embeds: [new EmbedBuilder().setDescription('Kill Switch ' + (attiva ? 'ATTIVATO' : 'DISATTIVATO') + '.').setColor(attiva ? '#ff0000' : '#00ff00')]");
content = content.replace(/content: 'Wallet registrato e cifrato! Indirizzo: ' \+ info\.publicKey/g, "embeds: [new EmbedBuilder().setDescription('Wallet registrato e cifrato! Indirizzo: ' + info.publicKey).setColor('#00ff00')]");
content = content.replace(/content: 'Specifica almeno un parametro \(max_trade o max_day\)\.'/g, "embeds: [new EmbedBuilder().setDescription('Specifica almeno un parametro (max_trade o max_day).').setColor('#ffaa00')]");
content = content.replace(/content: 'Limiti aggiornati con successo!'/g, "embeds: [new EmbedBuilder().setDescription('Limiti aggiornati con successo!').setColor('#00ff00')]");
content = content.replace(/content: 'Nessun wallet registrato\.'/g, "embeds: [new EmbedBuilder().setDescription('Nessun wallet registrato.').setColor('#ffaa00')]");
content = content.replace(/content: 'NON CONDIVIDERE QUESTA CHIAVE!\\n\\n' \+ key/g, "embeds: [new EmbedBuilder().setDescription('NON CONDIVIDERE QUESTA CHIAVE!\\n\\n' + key).setColor('#ff0000')]");
content = content.replace(/content: deleted \? 'Wallet rimosso e cancellato dal database\.' : 'Nessun wallet registrato\.'/g, "embeds: [new EmbedBuilder().setDescription(deleted ? 'Wallet rimosso e cancellato dal database.' : 'Nessun wallet registrato.').setColor(deleted ? '#00ff00' : '#ffaa00')]");
content = content.replace(/content: 'Devi prima registrare il tuo wallet con \/wallet register\.'/g, "embeds: [new EmbedBuilder().setDescription('Devi prima registrare il tuo wallet con /wallet register.').setColor('#ffaa00')]");
content = content.replace(/content: 'Y" \*\*LIVE TRADING ATTIVATO!\*\* Usa la dashboard per monitorare gli acquisti\.'/g, "embeds: [new EmbedBuilder().setDescription('**LIVE TRADING ATTIVATO!** Usa la dashboard per monitorare gli acquisti.').setColor('#00ff00')]");
content = content.replace(/content: 'Live trading in pausa\. Le posizioni aperte verranno gestite, ma non verranno fatti nuovi acquisti\.'/g, "embeds: [new EmbedBuilder().setDescription('Live trading in pausa. Le posizioni aperte verranno gestite, ma non verranno fatti nuovi acquisti.').setColor('#ffaa00')]");
content = content.replace(/content: 'Trial Status: ' \+ \(pf\.trialEnabled \? 'ATTIVO' : 'PAUSA'\) \+ '\\nSaldo Virtuale: ' \+ pf\.paperSolBalance\.toFixed\(4\) \+ ' SOL\\nPosizioni Aperte: ' \+ open/g, "embeds: [new EmbedBuilder().setDescription('Trial Status: ' + (pf.trialEnabled ? 'ATTIVO' : 'PAUSA') + '\\nSaldo Virtuale: ' + pf.paperSolBalance.toFixed(4) + ' SOL\\nPosizioni Aperte: ' + open).setColor('#00f3ff')]");
content = content.replace(/content: 'Saldo virtuale ripristinato a 1 SOL e storico svuotato\.'/g, "embeds: [new EmbedBuilder().setDescription('Saldo virtuale ripristinato a 1 SOL e storico svuotato.').setColor('#00ff00')]");
content = content.replace(/content: 'Trade chiusi: ' \+ closed\.length \+ '\\nPnL Netto Virtuale: ' \+ pnl\.toFixed\(4\) \+ ' SOL'/g, "embeds: [new EmbedBuilder().setDescription('Trade chiusi: ' + closed.length + '\\nPnL Netto Virtuale: ' + pnl.toFixed(4) + ' SOL').setColor(pnl >= 0 ? '#00ff00' : '#ff0000')]");
content = content.replace(/content: 'Comando non riconosciuto o deprecato\.'/g, "embeds: [new EmbedBuilder().setDescription('Comando non riconosciuto o deprecato.').setColor('#ffaa00')]");

// Catch-all for basic errors:
content = content.replace(/content: 'Errore: ' \+ err\.message/g, "embeds: [new EmbedBuilder().setDescription('Errore: ' + err.message).setColor('#ff0000')]");

fs.writeFileSync(file, content, 'utf8');
