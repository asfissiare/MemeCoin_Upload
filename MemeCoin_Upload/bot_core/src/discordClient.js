import { t } from './locales.js';
import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  Events,
  ChannelType
} from 'discord.js';
import { Connection, PublicKey, SystemProgram, VersionedTransaction, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { config } from './config.js';
import { eventBus } from './events.js';
import { riskManager } from './riskManager.js';
import { proxyManager } from './proxyManager.js';
import { tradeExecutor } from './tradeExecutor.js';
import { userDatabase } from './userDatabase.js';
import { switchereService } from './switchereService.js';
import { paperTradingEngine } from './paperTrading.js';
import { getDashboardUrl } from './dashboard.js';

export class DiscordClient {
  constructor() {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
    });
    this.isReady = false;
    this.recentCandidates = [];
    this.notifiedNewsMints = new Set();
    this.notifiedImportantMints = new Set();
  }

  calculateProfitScore(candidate, rugCheckScore = 0) {
    const liquidity = Math.max(1, Number(candidate.liquidityUsd || 1));
    const vol5m = Number(candidate.volume5mUsd || 0);
    const buys5m = Number(candidate.buys5m || 0);

    const volRatio = Math.min(40, (vol5m / liquidity) * 100);

    let buyScore = 10;
    if (buys5m >= 100) buyScore = 30;
    else if (buys5m >= 30) buyScore = 25;
    else if (buys5m >= 10) buyScore = 20;

    const safetyScore = Math.max(0, 30 - Math.round(Number(rugCheckScore || 0) / 2));

    return Math.min(99, Math.max(50, Math.round(volRatio + buyScore + safetyScore)));
  }

  isCrazyOpportunity(candidate, rugCheckScore = 0, profitScore = 75) {
    const liquidity = Number(candidate.liquidityUsd || 0);
    const vol5m = Number(candidate.volume5mUsd || 0);
    const vol24h = Number(candidate.volume24hUsd || 0);

    return (
      liquidity >= 15000 &&
      (vol5m >= 5000 || vol24h >= 50000) &&
      rugCheckScore <= 15 &&
      profitScore >= 85
    );
  }

  async start() {
    if (!config.DISCORD_TOKEN) {
      console.warn('[DISCORD] Token Discord non fornito in .env. Il client Discord non verrà avviato.');
      return;
    }

    this.setupEventForwarding();

    this.client.once(Events.ClientReady, async () => {
      console.log(`[DISCORD] Bot connesso come ${this.client.user.tag}! Presente in ${this.client.guilds.cache.size} server Discord.`);
      this.isReady = true;

      await this.registerSlashCommands();
      this.startTrialInactivityCheckLoop();

      for (const guild of this.client.guilds.cache.values()) {
        await this.setupServerStructure(guild);
      }
    });

    this.client.on(Events.GuildCreate, async (guild) => {
      console.log(`[DISCORD] Bot aggiunto al server: ${guild.name} (${guild.id})`);
      try {
        await this.registerSlashCommandsForGuild(guild.id);
        await this.setupServerStructure(guild);
      } catch (err) {
        console.warn(`[DISCORD] Impossibile configurare server ${guild.name}: ${err.message}`);
      }
    });

    this.client.on('interactionCreate', async (interaction) => {
      try {
        if (interaction.isChatInputCommand()) {
          await this.handleSlashCommand(interaction);
        } else if (interaction.isButton()) {
          await this.handleButtonInteraction(interaction);
        }
      } catch (err) {
        console.warn(`[DISCORD] Errore interazione ignorato: ${err.message}`);
      }
    });

    try {
      await this.client.login(config.DISCORD_TOKEN);
    } catch (err) {
      console.error(`[DISCORD] Errore login: ${err.message}`);
    }
  }

  async registerSlashCommands() {
    if (!config.DISCORD_CLIENT_ID) {
      console.warn('[DISCORD] DISCORD_CLIENT_ID non configurato.');
      return;
    }

    const commands = this.getCommandPayload();
    const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);

    try {
      await rest.put(
        Routes.applicationCommands(config.DISCORD_CLIENT_ID),
        { body: [] }
      ).catch(() => {});

      for (const guild of this.client.guilds.cache.values()) {
        await rest.put(
          Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, guild.id),
          { body: commands }
        ).catch(() => {});
      }
      console.log('[DISCORD] Slash commands puliti e registrati in modo unico per ogni server!');
    } catch (err) {
      console.error(`[DISCORD] Errore registrazione comandi: ${err.message}`);
    }
  }

  async registerSlashCommandsForGuild(guildId) {
    if (!config.DISCORD_CLIENT_ID || !guildId) return;
    const commands = this.getCommandPayload();
    const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
    try {
      await rest.put(
        Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, guildId),
        { body: commands }
      );
    } catch (err) {
      // Silent catch
    }
  }

  getCommandPayload() {
    return [
      new SlashCommandBuilder()
        .setName('language')
        .setDescription('Change bot language / Cambia lingua del bot')
        .addStringOption(opt => 
          opt.setName('lang')
          .setDescription('Language (en/it)')
          .setRequired(true)
          .addChoices(
            { name: 'English', value: 'en' },
            { name: 'Italiano', value: 'it' }
          )
        ),
      new SlashCommandBuilder()
        .setName('dashboard')
        .setDescription('Ottieni il tuo link personale e segreto per accedere alla Web Dashboard'),

      new SlashCommandBuilder()
        .setName('wallet')
        .setDescription('Gestisci il tuo wallet Solana in modo privato e sicuro')
        .addSubcommand(sub =>
          sub.setName('register')
            .setDescription('Collega e cifra la tua chiave privata nel database (AES-256)')
            .addStringOption(opt => opt.setName('key').setDescription('Solana Private Key (Base58)').setRequired(true))
        )
        .addSubcommand(sub =>
          sub.setName('info')
            .setDescription('Visualizza il saldo reale, indirizzo pubblico e stato del wallet')
        )
        .addSubcommand(sub =>
          sub.setName('limits')
            .setDescription('Imposta i limiti di spesa e tolleranza al rischio (Ex Budget)')
            .addNumberOption(opt => opt.setName('max_trade').setDescription('Max SOL per singolo acquisto (es. 0.05)').setRequired(false))
            .addNumberOption(opt => opt.setName('max_day').setDescription('Max SOL di budget giornaliero (es. 0.20)').setRequired(false))
        )
        .addSubcommand(sub =>
          sub.setName('cashout')
            .setDescription('Preleva i tuoi SOL trasferendoli su Phantom o Binance')
            .addNumberOption(opt => opt.setName('amount').setDescription('Importo in SOL da prelevare').setRequired(true))
            .addStringOption(opt => opt.setName('address').setDescription('Indirizzo Solana di destinazione').setRequired(true))
        )
        .addSubcommand(sub =>
          sub.setName('export')
            .setDescription('Esporta la tua chiave privata (nessun altro la vedrà)')
        )
        .addSubcommand(sub =>
          sub.setName('remove')
            .setDescription('Cancella irreversibilmente il tuo wallet dal database')
        ),

      new SlashCommandBuilder()
        .setName('trade')
        .setDescription('Controlla le operazioni del bot con soldi reali')
        .addSubcommand(sub =>
          sub.setName('start')
            .setDescription('Avvia gli acquisti automatici sul tuo wallet')
        )
        .addSubcommand(sub =>
          sub.setName('pause')
            .setDescription('Ferma momentaneamente i nuovi acquisti automatici')
        ),

      new SlashCommandBuilder()
        .setName('paper')
        .setDescription('Gestisci il Trading in Simulazione (Zero Rischio)')
        .addSubcommand(sub => sub.setName('start').setDescription('Avvia la simulazione'))
        .addSubcommand(sub => sub.setName('status').setDescription('Vedi il bilancio finto'))
        .addSubcommand(sub => sub.setName('results').setDescription('Vedi i trade finti chiusi'))
        .addSubcommand(sub => sub.setName('reset').setDescription('Azzera il conto finto a 1 SOL')),

      new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Comandi di amministrazione globale (Solo Owner)')
        .addSubcommand(sub => 
          sub.setName('killswitch')
            .setDescription('Blocco d\'emergenza globale')
            .addBooleanOption(opt => opt.setName('attiva').setDescription('true = Blocca acquisti').setRequired(true))
        )
    ].map(cmd => cmd.toJSON());
  }

  createControlPanelEmbed() {
    const embed = new EmbedBuilder()
      .setTitle('SOLANA TRADING TERMINAL')
      .setDescription(`Pannello interattivo per la gestione del trading automatico, acquisto SOL e Simulazione Paper.\n\n🌐 **[Visualizza la Web Dashboard Live]()**`)
      .setColor(0x0F172A)
      .addFields(
        { name: 'Acquisto Diretto (1-Clic)', value: 'Seleziona un importo qui sotto per acquistare SOL con calcolo trasparente delle fee.', inline: false },
        { name: 'Gestione Wallet & Auto-Trade', value: 'Usa i bottoni per controllare il saldo, attivare/mettere in pausa l\'Auto-Trade o visualizzare i candidati.', inline: false },
        { name: 'Simulazione Paper Trading (Zero Rischio)', value: 'Testa strategie in tempo reale su meme coin vere con 1.00 Paper SOL virtuali.', inline: false }
      )
      .setTimestamp();

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('btn_buy_5').setLabel('EUR 5 SOL').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('btn_buy_10').setLabel('EUR 10 SOL').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('btn_buy_20').setLabel('EUR 20 SOL').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('btn_buy_50').setLabel('EUR 50 SOL').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('btn_buy_100').setLabel('EUR 100 SOL').setStyle(ButtonStyle.Success)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('btn_wallet_info').setLabel('Saldo & Wallet').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('btn_toggle_autotrade').setLabel('Pausa / Attiva Trade').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('btn_candidates').setLabel('Token Idonei').setStyle(ButtonStyle.Secondary)
    );

    const row3 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('btn_paper_buy').setLabel('Simula Trade (Demo)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('btn_paper_portfolio').setLabel('Portfolio Demo').setStyle(ButtonStyle.Secondary)
    );

    return { embed, components: [row1, row2, row3] };
  }

  async handleSlashCommand(interaction) {
    const { commandName, user } = interaction;
    const discordUserId = user.id;

    // --- SECURITY LOCKDOWN ---
    // Single-User Mode: Only the owner can use the bot's commands.
    if (discordUserId !== config.DISCORD_OWNER_ID) {
      console.warn(`[SECURITY] Tentativo di accesso non autorizzato da parte di ${user.tag} (${discordUserId}) al comando /${commandName}`);
      this.sendSecurityAlert(`🚨 **TENTATIVO DI INFILTRAZIONE**\nL'utente **${user.tag}** (\`${discordUserId}\`) ha tentato di eseguire il comando \`/${commandName}\` in un server non autorizzato. L'attacco è stato bloccato automaticamente.`, 'HIGH');
      
      return interaction.reply({ 
        content: 'Accesso Negato. Questo bot è privato.', 
        flags: 64 
      });
    }
    // -------------------------

    if (commandName === 'language') {
        const lang = interaction.options.getString('lang');
        userDatabase.setLanguage(interaction.user.id, lang);
        return interaction.reply({ content: t('language_updated', lang), flags: 64 });
      }

            if (commandName === 'dashboard') {
        await interaction.deferReply({ flags: 64 });
        const { getDashboardUrl } = await import('./dashboard.js');
        const url = getDashboardUrl(discordUserId);
        const user = userDatabase.getUserInfo(discordUserId);
        
        let desc = '';
        if (!user) {
           desc = "⚠️ **Non hai ancora registrato un wallet!**\nPer sbloccare la tua Dashboard Privata (dove vedrai il tuo saldo, il PnL e i tuoi trade), usa prima il comando `/wallet register`.\n\nNel frattempo, puoi guardare la **Dashboard Pubblica** qui:\n\n**[🌐 APRI DASHBOARD PUBBLICA](" + url + ")**";
        } else {
           desc = "🔐 **Accesso Autorizzato**\nEcco il tuo link segreto e univoco alla Dashboard Web Privata:\n\n**[🌐 APRI LA TUA DASHBOARD](" + url + ")**";
        }
        
        await interaction.editReply({ embeds: [new EmbedBuilder().setDescription(desc).setColor(user ? '#00f3ff' : '#ffaa00')] });
        return;
      }
      if (commandName === 'admin') {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'killswitch') {
          const attiva = interaction.options.getBoolean('attiva');
          riskManager.updateKillSwitch(attiva, 'Admin Discord');
          await interaction.reply({ flags: 64, embeds: [new EmbedBuilder().setDescription('Kill Switch ' + (attiva ? 'ATTIVATO' : 'DISATTIVATO') + '.').setColor(attiva ? '#ff0000' : '#00ff00')] });
        }
        return;
      }

    if (commandName === 'wallet') {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'register') {
        const key = interaction.options.getString('key');
        try {
          const info = userDatabase.registerUserWallet(discordUserId, key);
          await interaction.reply({ flags: 64, embeds: [new EmbedBuilder().setDescription('Wallet registrato e cifrato! Indirizzo: ' + info.publicKey).setColor('#00ff00')] });
        } catch (err) {
          await interaction.reply({ flags: 64, embeds: [new EmbedBuilder().setDescription('Errore: ' + err.message).setColor('#ff0000')] });
        }
        return;
      }
      if (subcommand === 'info') {
        await this.showWalletInfo(interaction);
        return;
      }
      if (subcommand === 'limits') {
        const maxTrade = interaction.options.getNumber('max_trade');
        const maxDay = interaction.options.getNumber('max_day');
        try {
          const limits = {};
          if (maxTrade !== null) limits.maxSolPerTrade = maxTrade;
          if (maxDay !== null) limits.maxSolPerDay = maxDay;
          if (Object.keys(limits).length === 0) {
             await interaction.reply({ flags: 64, embeds: [new EmbedBuilder().setDescription('Specifica almeno un parametro (max_trade o max_day).').setColor('#ffaa00')] });
             return;
          }
          userDatabase.updateUserSettings(discordUserId, limits);
          await interaction.reply({ flags: 64, embeds: [new EmbedBuilder().setDescription('Limiti aggiornati con successo!').setColor('#00ff00')] });
        } catch (err) {
          await interaction.reply({ flags: 64, embeds: [new EmbedBuilder().setDescription('Errore: ' + err.message).setColor('#ff0000')] });
        }
        return;
      }
      if (subcommand === 'cashout') {
        const amount = interaction.options.getNumber('amount');
        const dest = interaction.options.getString('address');
        await this.handleCashout(interaction, amount, dest);
        return;
      }
      if (subcommand === 'export') {
        const key = userDatabase.exportPrivateKey(discordUserId);
        if (!key) {
          await interaction.reply({ flags: 64, embeds: [new EmbedBuilder().setDescription('Nessun wallet registrato.').setColor('#ffaa00')] });
          return;
        }
        await interaction.reply({ flags: 64, embeds: [new EmbedBuilder().setDescription('NON CONDIVIDERE QUESTA CHIAVE!\n\n' + key).setColor('#ff0000')] });
        return;
      }
      if (subcommand === 'remove') {
        const deleted = userDatabase.removeUserWallet(discordUserId);
        await interaction.reply({ flags: 64, embeds: [new EmbedBuilder().setDescription(deleted ? 'Wallet rimosso e cancellato dal database.' : 'Nessun wallet registrato.').setColor(deleted ? '#00ff00' : '#ffaa00')] });
        return;
      }
    }

    if (commandName === 'trade') {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'start') {
        const userInfo = userDatabase.getUserInfo(discordUserId);
        if (!userInfo) {
           await interaction.reply({ flags: 64, embeds: [new EmbedBuilder().setDescription('Devi prima registrare il tuo wallet con /wallet register.').setColor('#ffaa00')] });
           return;
        }
        userDatabase.updateUserSettings(discordUserId, { autoTradeEnabled: true });
        config.DRY_RUN = false; // Live mode globally active!
        
        try {
          const fs = require('fs');
          const path = require('path');
          const envPath = path.resolve(process.cwd(), '.env');
          if (fs.existsSync(envPath)) {
            let envData = fs.readFileSync(envPath, 'utf8');
            if (envData.includes('DRY_RUN=')) {
              envData = envData.replace(/DRY_RUN=.*/g, 'DRY_RUN=false');
            } else {
              envData += '\nDRY_RUN=false\n';
            }
            fs.writeFileSync(envPath, envData);
          }
        } catch (e) {}

        await interaction.reply({ flags: 64, embeds: [
          new EmbedBuilder()
            .setTitle('🔥 LIVE TRADING ATTIVATO!')
            .setDescription('Il bot è ora in modalità Live (Denaro Reale). Inizierà ad acquistare in automatico i prossimi token che supereranno tutti i filtri di sicurezza.\n\nUsa la TUA Dashboard privata per monitorare in tempo reale gli acquisti e le posizioni.')
            .setColor('#ef4444')
        ] });
        return;
      }
      if (subcommand === 'pause') {
        try {
          userDatabase.updateUserSettings(discordUserId, { autoTradeEnabled: false });
          await interaction.reply({ flags: 64, embeds: [new EmbedBuilder().setDescription('Live trading in pausa. Le posizioni aperte verranno gestite, ma non verranno fatti nuovi acquisti.').setColor('#ffaa00')] });
        } catch (err) {
          await interaction.reply({ flags: 64, embeds: [new EmbedBuilder().setDescription('Errore: ' + err.message).setColor('#ff0000')] });
        }
        return;
      }
    }

    if (commandName === 'paper') {
      const subcommand = interaction.options.getSubcommand();
      
      if (subcommand === 'start') {
        paperTradingEngine.toggleTrialMode(discordUserId, true);
        await interaction.reply({ flags: 64, embeds: [
          new EmbedBuilder()
            .setTitle('🟢 Paper Trading Attivato')
            .setDescription('Modalità simulazione attivata! Ora puoi testare il trading senza usare SOL reali.')
            .setColor('#10b981')
        ]});
      }
      else if (subcommand === 'stop') {
        paperTradingEngine.toggleTrialMode(discordUserId, false);
        await interaction.reply({ flags: 64, embeds: [
          new EmbedBuilder()
            .setTitle('⏸️ Paper Trading In Pausa')
            .setDescription('La modalità simulazione è in pausa. I trade virtuali aperti sono stati chiusi.')
            .setColor('#f59e0b')
        ]});
      }
      else if (subcommand === 'status') {
        const stats = paperTradingEngine.getResultsSummary(discordUserId);
        const embed = new EmbedBuilder()
          .setTitle('📊 Stato Paper Trading')
          .setColor(stats.trialEnabled ? '#10b981' : '#f59e0b')
          .addFields(
            { name: 'Status', value: stats.trialEnabled ? 'ATTIVA' : 'PAUSA', inline: true },
            { name: 'Saldo Totale', value: `${stats.paperSolBalance.toFixed(4)} SOL`, inline: true },
            { name: 'Trade Aperti', value: `${stats.openTradesCount}`, inline: true },
            { name: 'Trade Chiusi', value: `${stats.closedTradesCount}`, inline: true },
            { name: 'Win Rate', value: `${stats.winRate}% (${stats.wins}W / ${stats.losses}L)`, inline: true },
            { name: 'Profitto Netto', value: `${Number(stats.totalPnlSol).toFixed(4)} SOL`, inline: true }
          );
        await interaction.reply({ flags: 64, embeds: [embed] });
      }
      else if (subcommand === 'reset') {
        paperTradingEngine.resetPaperBalance(discordUserId, 1.0);
        await interaction.reply({ flags: 64, embeds: [
          new EmbedBuilder()
            .setTitle('🔄 Paper Trading Resettato')
            .setDescription('Saldo totale ripristinato a 1 SOL e storico svuotato.')
            .setColor('#00f3ff')
        ]});
      }
      else if (subcommand === 'results') {
        const stats = paperTradingEngine.getResultsSummary(discordUserId);
        const pnlNum = Number(stats.totalPnlSol);
        const embed = new EmbedBuilder()
          .setTitle('📈 Risultati Paper Trading')
          .setColor(pnlNum >= 0 ? '#10b981' : '#ef4444')
          .setDescription('Riepilogo delle performance in simulazione:')
          .addFields(
            { name: 'Totale Trade', value: `${stats.totalTrades}`, inline: true },
            { name: 'Trade Chiusi', value: `${stats.closedTradesCount}`, inline: true },
            { name: 'Saldo Totale', value: `${stats.paperSolBalance.toFixed(4)} SOL`, inline: true },
            { name: 'Win Rate', value: `${stats.winRate}%`, inline: true },
            { name: 'Vinte / Perse', value: `${stats.wins} W / ${stats.losses} L`, inline: true },
            { name: 'Profitto Netto', value: `${pnlNum.toFixed(4)} SOL`, inline: true }
          );
        await interaction.reply({ flags: 64, embeds: [embed] });
      }
      return;
    }
    
    await interaction.reply({ flags: 64, embeds: [new EmbedBuilder().setDescription('Comando non riconosciuto o deprecato.').setColor('#ffaa00')] });
  }

  async handleButtonInteraction(interaction) {
    const { customId, user } = interaction;

    if (customId.startsWith('btn_buy_')) {
      const amountEur = Number(customId.replace('btn_buy_', ''));
      await this.processBuyEstimate(interaction, amountEur);
      return;
    }

    if (customId === 'btn_wallet_info') {
      await this.showWalletInfo(interaction);
      return;
    }

    if (customId === 'btn_toggle_autotrade') {
      const userInfo = userDatabase.getUserInfo(user.id);
      if (!userInfo) {
        await interaction.reply({ flags: 64, content: 'Nessun wallet registrato. Registra prima la chiave con `/wallet register key:<chiave>`.',
          flags: 64
        });
        return;
      }

      const newStatus = !userInfo.autoTradeEnabled;
      const updated = userDatabase.updateUserSettings(user.id, { autoTradeEnabled: newStatus });

      await interaction.reply({ flags: 64, content: `Auto-Trading ora **${updated.autoTradeEnabled ? 'ATTIVO' : 'IN PAUSA'}** per il tuo wallet (\`${updated.publicKey}\`).`,
        flags: 64
      });
      return;
    }

    if (customId === 'btn_candidates') {
      await this.showCandidates(interaction);
      return;
    }

    if (customId.startsWith('btn_sell_paper_')) {
      const positionId = customId.replace('btn_sell_paper_', '');
      await interaction.deferReply({ flags: 64 });
      try {
        const pf = await paperTradingEngine.getPortfolioWithLivePnL(user.id);
        const targetPos = pf.openPositions.find(p => p.id === positionId);
        const currentPrice = targetPos ? targetPos.currentPriceUsd : 0;

        const { position } = paperTradingEngine.executePaperSell(user.id, positionId, currentPrice);
        const isProfitable = position.pnlPercent >= 0;
        const pnlSign = isProfitable ? '+' : '';

        const embed = new EmbedBuilder()
          .setTitle(`[POSIZIONE CHIUSA] ${position.symbol}`)
          .setDescription(`🎉 **Trade Simulato Concluso!**`)
          .setColor(isProfitable ? 0x10B981 : 0xEF4444)
          .addFields(
            { name: 'Valuta Venduta', value: `${position.name} (\`${position.symbol}\`)`, inline: false },
            { name: 'Prezzo Ingresso', value: `\`$${position.entryPriceUsd}\``, inline: true },
            { name: 'Prezzo Uscita', value: `\`$${position.exitPriceUsd}\``, inline: true },
            { name: 'Profitto / Perdita Incassata', value: `\`${pnlSign}${position.pnlPercent.toFixed(2)}% (${pnlSign}${position.pnlSol.toFixed(4)} SOL)\``, inline: false }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        await interaction.editReply({ content: err.message });
      }
      return;
    }

    if (customId === 'btn_trial_continue') {
      paperTradingEngine.continueTrialSession(user.id);
      const embed = new EmbedBuilder()
        .setTitle('TRIAL SESSION EXTENDED')
        .setDescription(`Trial session active. Automated trading continues for <@${user.id}>.`)
        .setColor(0x10B981)
        .setTimestamp();
      await interaction.reply({ flags: 64, embeds: [embed], flags: 64 });
      return;
    }

    if (customId === 'btn_trial_close') {
      paperTradingEngine.closeTrialSession(user.id, 'USER_CLOSED_REMINDER');
      const embed = new EmbedBuilder()
        .setTitle('TRIAL SESSION CLOSED')
        .setDescription(`Trial session closed for <@${user.id}>. All open positions have been liquidated.`)
        .setColor(0xEF4444)
        .setTimestamp();
      await interaction.reply({ flags: 64, embeds: [embed], flags: 64 });
      return;
    }

    if (customId === 'btn_paper_buy') {
      await this.handlePaperBuy(interaction);
      return;
    }

    if (customId === 'btn_paper_portfolio') {
      await this.showPaperPortfolio(interaction);
    }
  }

  startTrialInactivityCheckLoop() {
    setInterval(async () => {
      if (!this.isReady) return;
      paperTradingEngine.checkInactivityTimers(
        async (userId) => {
          for (const guild of this.client.guilds.cache.values()) {
            const channel = this.findFirstWritableChannel(guild);
            if (channel) {
              const embed = new EmbedBuilder()
                .setTitle('TRIAL SESSION REMINDER (12H)')
                .setDescription(`Attention <@${userId}>: Your automated trial trading session has been active for 12 hours. Please select an option below to continue or close your session.`)
                .setColor(0xF59E0B)
                .setTimestamp();

              const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('btn_trial_continue').setLabel('Continue').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('btn_trial_close').setLabel('Close').setStyle(ButtonStyle.Danger)
              );

              await channel.send({ content: `<@${userId}>`, embeds: [embed], components: [row] }).catch(() => {});
            }
          }
        },
        async (userId) => {
          for (const guild of this.client.guilds.cache.values()) {
            const channel = this.findFirstWritableChannel(guild);
            if (channel) {
              const embed = new EmbedBuilder()
                .setTitle('TRIAL SESSION AUTO-CLOSED (24H)')
                .setDescription(`Notice <@${userId}>: Your trial session has been automatically closed after 24 hours of inactivity.`)
                .setColor(0xEF4444)
                .setTimestamp();

              await channel.send({ content: `<@${userId}>`, embeds: [embed] }).catch(() => {});
            }
          }
        }
      );
    }, 60000);
  }

  async handlePaperBuy(interaction) {
    if (this.recentCandidates.length === 0) {
      await interaction.reply({ flags: 64, content: 'Nessuna valuta meme idonea disponibile al momento per la simulazione.', flags: 64 });
      return;
    }

    const candidate = this.recentCandidates[this.recentCandidates.length - 1];
    try {
      const { portfolio, position } = paperTradingEngine.executePaperBuy(interaction.user.id, candidate, 0.05);

      const embed = new EmbedBuilder()
        .setTitle(`[ORDINE DI SIMULAZIONE APERTO] ${position.symbol}`)
        .setDescription('**Posizione Aperta con Successo!** Il bot sta monitorando la valuta in tempo reale.\nPer vedere il tuo **Guadagno / Profitto % (PnL)** aggiornato ed incassare/vendere, usa il bottone **`Portfolio Demo`** o il comando `/trial portfolio`.')
        .setColor(0x6366F1)
        .addFields(
          { name: 'Valuta Acquistata', value: `${position.name} (\`${position.mint}\`)`, inline: false },
          { name: 'SOL Simulati Investiti', value: `\`${position.solInvested} Trial SOL\``, inline: true },
          { name: 'Prezzo Ingresso USD', value: `\`$${position.entryPriceUsd}\``, inline: true },
          { name: 'Token Ricevuti', value: `\`~${Number(position.tokensReceived).toLocaleString()} ${position.symbol}\``, inline: true },
          { name: 'Saldo Libero Rimanente', value: `\`${portfolio.paperSolBalance.toFixed(4)} Trial SOL\``, inline: false }
        )
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_paper_portfolio').setLabel('Vedi Guadagno & Portfolio Demo').setStyle(ButtonStyle.Success)
      );

      await interaction.reply({ flags: 64, embeds: [embed], components: [row], flags: 64 });
    } catch (err) {
      await interaction.reply({ flags: 64, content: err.message, flags: 64 });
    }
  }

  async showPaperPortfolio(interaction) {
    await interaction.deferReply({ flags: 64 });

    try {
      const data = await paperTradingEngine.getPortfolioWithLivePnL(interaction.user.id);
      const isProfitable = data.totalUnrealizedPnlSol >= 0;
      const pnlColor = isProfitable ? 0x10B981 : 0xEF4444;
      const pnlSign = isProfitable ? '+' : '';

      const embed = new EmbedBuilder()
        .setTitle('PORTFOLIO TRIAL MODE (LIVE PnL & GUADAGNI)')
        .setDescription('Resoconto in tempo reale del tuo portafoglio di simulazione aggiornato sui prezzi DexScreener.')
        .setColor(pnlColor)
        .addFields(
          { name: 'Saldo Libero SOL', value: `\`${data.paperSolBalance.toFixed(4)} Trial SOL\``, inline: true },
          { name: 'Valore Posizioni Aperte', value: `\`${data.totalPositionsValueSol.toFixed(4)} Trial SOL\``, inline: true },
          { name: 'Valore Totale Portafoglio', value: `\`${data.totalPortfolioValueSol.toFixed(4)} Trial SOL\``, inline: true },
          { name: 'Profitto / Perdita Totale (PnL Live)', value: `\`${pnlSign}${data.totalUnrealizedPnlSol.toFixed(4)} Trial SOL\``, inline: false }
        )
        .setTimestamp();

      const sellButtons = [];

      if (data.openPositions.length > 0) {
        const details = data.openPositions.map((p, idx) => {
          const posPnlSign = p.pnlPercent >= 0 ? '+' : '';
          const posPnlSymbol = p.pnlPercent >= 0 ? '📈' : '📉';

          if (idx < 5) {
            sellButtons.push(
              new ButtonBuilder()
                .setCustomId(`btn_sell_paper_${p.id}`)
                .setLabel(`Vendi ${p.symbol} (${posPnlSign}${p.pnlPercent.toFixed(1)}%)`)
                .setStyle(p.pnlPercent >= 0 ? ButtonStyle.Success : ButtonStyle.Danger)
            );
          }

          return `**[${idx + 1}] ${p.symbol}** (${p.name})\n` +
            `\`Ingresso:\` $${p.entryPriceUsd} | \`Prezzo Live:\` $${p.currentPriceUsd}\n` +
            `\`Investiti:\` ${p.solInvested} SOL -> \`Valore Attuale:\` ${p.currentValueSol.toFixed(4)} SOL\n` +
            `${posPnlSymbol} **Guadagno/Perdita:** \`${posPnlSign}${p.pnlPercent.toFixed(2)}% (${posPnlSign}${p.pnlSol.toFixed(4)} SOL)\``;
        }).join('\n\n');

        embed.addFields({ name: 'Posizioni Aperte & Guadagni Live (PnL)', value: details, inline: false });
      } else {
        embed.addFields({ name: 'Posizioni Aperte', value: 'Nessuna posizione aperta al momento. Usa `/trial buy` o clicca `Simula Trade (Demo)` per iniziare!', inline: false });
      }

      const components = [];
      if (sellButtons.length > 0) {
        const row = new ActionRowBuilder().addComponents(sellButtons.slice(0, 5));
        components.push(row);
      }

      await interaction.editReply({ embeds: [embed], components });
    } catch (err) {
      await interaction.editReply({ content: `Errore durante il calcolo del portafoglio: ${err.message}` });
    }
  }

  async showTrialResultsTable(interaction) {
    const summary = paperTradingEngine.getResultsSummary(interaction.user.id);
    const isProfitable = summary.totalPnlSol >= 0;
    const pnlSign = isProfitable ? '+' : '';

    const embed = new EmbedBuilder()
      .setTitle('TABELLA RISULTATI & PROFITTI TRIAL MODE')
      .setColor(isProfitable ? 0x10B981 : 0xEF4444)
      .addFields(
        { name: 'Saldo Virtuale Attuale', value: `\`${summary.paperSolBalance.toFixed(4)} Trial SOL\``, inline: true },
        { name: 'Win Rate (Percentuale Vittorie)', value: `\`${summary.winRate}%\``, inline: true },
        { name: 'Profitti Netto Totali', value: `\`${pnlSign}${summary.totalPnlSol.toFixed(4)} SOL\``, inline: true },
        { name: 'Trade Chiusi (Win / Loss)', value: `\`${summary.wins} Vinti / ${summary.losses} Persi (Totale ${summary.closedTradesCount})\``, inline: false }
      )
      .setTimestamp();

    if (summary.closedPositions.length > 0) {
      let tableRows = summary.closedPositions.slice(-10).map((p, idx) => {
        const pnlSign = p.pnlPercent >= 0 ? '+' : '';
        const symbol = p.symbol.padEnd(8, ' ');
        const pnlStr = `${pnlSign}${p.pnlPercent.toFixed(1)}%`.padEnd(8, ' ');
        const exitReason = p.exitReason || 'CLOSED';
        return `[${idx + 1}] ${symbol} | PnL: ${pnlStr} | Status: ${exitReason}`;
      }).join('\n');

      embed.addFields({
        name: 'Storico Ordini Conclusi',
        value: `\`\`\`text\n${tableRows}\n\`\`\``,
        inline: false
      });
    } else {
      embed.addFields({
        name: 'Storico Ordini Conclusi',
        value: 'Nessun ordine simulato concluso al momento.',
        inline: false
      });
    }

    await interaction.reply({ flags: 64, embeds: [embed], flags: 64 });
  }

  async processBuyEstimate(interaction, importoEur) {
    const user = interaction.user;
    const userInfo = userDatabase.getUserInfo(user.id);
    const walletPubkey = userInfo?.publicKey || tradeExecutor.walletKeypair?.publicKey.toBase58();

    if (!walletPubkey) {
      await interaction.reply({ flags: 64, content: 'Nessun wallet registrato. Usa prima `/wallet register` o configura la chiave nel file `.env`.',
        flags: 64
      });
      return;
    }

    await interaction.deferReply({ flags: 64 });

    try {
      const estimate = await switchereService.estimatePurchase(importoEur, 'EUR', 'SOL');
      const purchaseUrl = switchereService.generatePurchaseUrl(walletPubkey, importoEur, 'EUR', 'SOL');

      const embed = new EmbedBuilder()
        .setTitle(`ACQUISTO DI EUR ${importoEur} SOLANA (SWITCHERE)`)
        .setURL(purchaseUrl)
        .setColor(0x10B981)
        .setDescription('Calcolo trasparente delle commissioni. **Nessun dato personale o di pagamento viene registrato (100% Zero-Data Policy)**.')
        .addFields(
          { name: 'Importo Lordo', value: `\`${estimate.breakdown.grossAmount}\``, inline: true },
          { name: 'SOL Stimati Ricevuti', value: `\`${estimate.breakdown.estimatedOutput}\``, inline: true },
          { name: 'Prezzo Mercato SOL', value: `\`EUR ${estimate.solPriceFiat.toFixed(2)}\``, inline: true },
          { name: 'Fee Processing Switchere (3.9%)', value: `\`${estimate.breakdown.processingFee}\``, inline: true },
          { name: 'Fee Gateway Carta (~1.1%)', value: `\`${estimate.breakdown.cardGatewayFee}\``, inline: true },
          { name: 'Totale Commissioni Trattenute', value: `\`${estimate.breakdown.totalPlatformFees}\``, inline: true },
          { name: 'Importo Netto Convertito', value: `\`${estimate.breakdown.netAmountInvested}\``, inline: false },
          { name: 'Wallet Destinazione', value: `\`${walletPubkey}\``, inline: false }
        )
        .setTimestamp();

      const linkRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel(`Acquista EUR ${importoEur} SOL ora su Switchere`)
          .setStyle(ButtonStyle.Link)
          .setURL(purchaseUrl)
      );

      await interaction.editReply({ embeds: [embed], components: [linkRow] });
    } catch (err) {
      await interaction.editReply({
        content: `Errore nella stima Switchere: ${err.message}`
      });
    }
  }

  async showWalletInfo(interaction) {
    const user = interaction.user;
    const userInfo = userDatabase.getUserInfo(user.id);

    let pubkey = userInfo?.publicKey;
    let autoTradeState = userInfo ? (userInfo.autoTradeEnabled ? 'ATTIVO' : 'IN PAUSA') : 'N/A';
    let spentToday = userInfo ? userInfo.spentTodaySol : 0;
    let maxDay = userInfo ? userInfo.maxSolPerDay : config.MAX_SOL_PER_DAY;
    let maxTrade = userInfo ? userInfo.maxSolPerTrade : config.MAX_SOL_PER_TRADE;

    let keypair = userInfo ? userDatabase.getDecryptedKeypair(user.id) : tradeExecutor.walletKeypair;
    if (!pubkey && keypair) {
      pubkey = keypair.publicKey.toBase58();
    }

    if (!pubkey) {
      await interaction.reply({ flags: 64, content: 'Nessun wallet registrato. Registra la tua chiave con `/wallet register key:<chiave>`.',
        flags: 64
      });
      return;
    }

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: ['Ephemeral'] });
    }

    let balanceSol = 'N/A';
    let balanceEur = 'N/A';
    try {
      if (keypair) {
        const balanceLamports = await tradeExecutor.connection.getBalance(keypair.publicKey);
        const solVal = balanceLamports / 1e9;
        balanceSol = solVal.toFixed(4);
        
        // Fetch SOL price in EUR from Binance
        try {
          const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLEUR');
          if (res.ok) {
            const data = await res.json();
            const priceEur = parseFloat(data.price);
            balanceEur = `€ ${(solVal * priceEur).toFixed(2)}`;
          }
        } catch (fetchErr) {
          console.warn('[DISCORD] Errore recupero prezzo SOL/EUR:', fetchErr.message);
        }
      }
    } catch (err) {
      balanceSol = `Errore RPC (${err.message})`;
    }

    const embed = new EmbedBuilder()
      .setTitle('METRICHE WALLET PERSONALE')
      .setColor(0x10B981)
      .addFields(
        { name: 'Indirizzo Pubblico', value: `\`${pubkey}\``, inline: false },
        { name: 'Saldo SOL Attuale', value: `\`${balanceSol} SOL\` (${balanceEur})`, inline: true },
        { name: 'Stato Auto-Trade', value: `\`${autoTradeState}\``, inline: true },
        { name: 'Spesi Oggi', value: `${spentToday.toFixed(4)} / ${maxDay} SOL`, inline: true },
        { name: 'Limite Singolo Trade', value: `${maxTrade} SOL`, inline: true },
        { name: 'Explorer', value: `[Visualizza su Solscan](https://solscan.io/account/${pubkey})`, inline: false }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }

  async showCandidates(interaction) {
    if (this.recentCandidates.length === 0) {
      await interaction.reply({ flags: 64, content: 'Nessun candidato idoneo rilevato nella finestra corrente.',
        flags: 64
      });
      return;
    }

    const listText = this.recentCandidates.slice(-5).map((c, i) =>
      `**[${i + 1}] ${c.symbol}** (${c.name})\n` +
      `\`Mint:\` \`${c.mint}\` | \`Prezzo:\` $${c.priceUsd}\n` +
      `\`Liquidità:\` $${Number(c.liquidityUsd).toLocaleString()} | \`Vol 24h:\` $${Number(c.volume24hUsd).toLocaleString()}\n` +
      `[Grafico DexScreener](${c.url})`
    ).join('\n\n');

    const embed = new EmbedBuilder()
      .setTitle('ULTIMI TOKEN MEME IDONEI')
      .setColor(0x8B5CF6)
      .setDescription(listText)
      .setTimestamp();

    await interaction.reply({ flags: 64, embeds: [embed], flags: 64 });
  }

  async setupServerStructure(guild) {
    try {
      const category = await this.getOrCreateCurrenciesCategory(guild);

      let generalChannel = guild.channels.cache.find(c => c.name === 'general' && c.type === ChannelType.GuildText);
      if (!generalChannel) {
        generalChannel = await guild.channels.create({
          name: 'general',
          type: ChannelType.GuildText,
          parent: category ? category.id : null,
          topic: 'General Discussion & Community Chat'
        });
      }
      await generalChannel.setPosition(0).catch(() => {});

      let importantChannel = guild.channels.cache.find(c => c.name === 'important' && c.type === ChannelType.GuildText);
      if (!importantChannel) {
        importantChannel = await guild.channels.create({
          name: 'important',
          type: ChannelType.GuildText,
          parent: category ? category.id : null,
          topic: 'HIGH-CONVICTION MOONSHOT OPPORTUNITIES & RARE ALERTS'
        });
      }
      await importantChannel.setPosition(1).catch(() => {});
    } catch (err) {
      console.warn(`[DISCORD] Errore inizializzazione server per ${guild.name}: ${err.message}`);
    }
  }

  async getOrCreateCurrenciesCategory(guild) {
    const categoryName = 'CURRENCIES';
    try {
      let category = guild.channels.cache.find(c => c.name === categoryName && c.type === ChannelType.GuildCategory);
      if (!category) {
        category = await guild.channels.create({
          name: categoryName,
          type: ChannelType.GuildCategory
        });
      }
      return category;
    } catch (err) {
      return null;
    }
  }

  async getOrCreateCurrencyChannel(guild, candidate, profitScore = 75) {
    const chainPrefix = (candidate.chain && candidate.chain !== 'solana') ? `${candidate.chain}-` : '';
    const rawName = candidate.name || candidate.symbol || 'token';
    const channelName = (chainPrefix + rawName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    try {
      const category = await this.getOrCreateCurrenciesCategory(guild);

      let existing = guild.channels.cache.find(c => c.name === channelName && c.type === ChannelType.GuildText);

      if (existing) {
        if (category && existing.parentId !== category.id) {
          try {
            await existing.setParent(category.id);
          } catch (err) {
            // Continue
          }
        }
        return existing;
      }

      // Enforce channel limit: count currency channels (exclude 'general', 'important')
      if (category) {
        const currencyChannels = guild.channels.cache.filter(c =>
          c.parentId === category.id &&
          c.type === ChannelType.GuildText &&
          c.name !== 'general' &&
          c.name !== 'important'
        );

        if (currencyChannels.size >= config.MAX_CURRENCY_CHANNELS) {
          // Find and delete the oldest/least active channel
          const sorted = [...currencyChannels.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
          const deleteCount = (currencyChannels.size - config.MAX_CURRENCY_CHANNELS) + 1;
          for (let i = 0; i < deleteCount; i++) {
            const toDelete = sorted[i];
            if (toDelete) {
              console.log(`[DISCORD] Deleting old channel #${toDelete.name} to enforce limit.`);
              await toDelete.delete().catch(() => {});
            }
          }
        }
      }

      const newChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category ? category.id : null,
        topic: `[${(candidate.chain || 'solana').toUpperCase()}] ${candidate.name} (${candidate.symbol}) | Mint: ${candidate.mint}`
      });

      console.log(`[DISCORD] Created channel #${channelName} in CURRENCIES for ${guild.name}`);
      return newChannel;
    } catch (err) {
      console.warn(`[DISCORD] Error creating channel for ${candidate.symbol}: ${err.message}`);
      return this.findFirstWritableChannel(guild);
    }
  }

  async getImportantChannel(guild) {
    try {
      const category = await this.getOrCreateCurrenciesCategory(guild);
      let channel = guild.channels.cache.find(c => c.name === 'important' && c.type === ChannelType.GuildText);
      if (channel) return channel;

      channel = await guild.channels.create({
        name: 'important',
        type: ChannelType.GuildText,
        parent: category ? category.id : null,
        topic: 'HIGH-CONVICTION MOONSHOT OPPORTUNITIES & RARE ALERTS'
      });
      await channel.setPosition(1).catch(() => {});
      return channel;
    } catch (err) {
      return null;
    }
  }

  findFirstWritableChannel(guild) {
    if (guild.systemChannel && guild.systemChannel.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages)) {
      return guild.systemChannel;
    }
    return guild.channels.cache.find(c =>
      c.type === ChannelType.GuildText &&
      c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages)
    );
  }

  async updateCurrencyChannelWithSingleLiveMessage(currencyChannel, liveEmbed) {
    try {
      const messages = await currencyChannel.messages.fetch({ limit: 50 }).catch(() => null);
      if (messages && messages.size > 0) {
        const deleted = await currencyChannel.bulkDelete(messages, true).catch(() => null);
        if (!deleted || deleted.size < messages.size) {
          const remaining = messages.filter(m => !deleted || !deleted.has(m.id));
          for (const msg of remaining.values()) {
            await msg.delete().catch(() => {});
          }
        }
      }
      await currencyChannel.send({ embeds: [liveEmbed] });
    } catch (err) {
      await currencyChannel.send({ embeds: [liveEmbed] }).catch(() => {});
    }
  }

  setupEventForwarding() {
    eventBus.on('bot-event', async (eventPayload) => {
      if (eventPayload.type === 'dashboard-url') {
        const url = eventPayload.data;
        console.log(`[DISCORD] Evento dashboard-url ricevuto! URL: ${url}`);
        const checkReadyAndSend = async () => {
          if (!this.isReady) {
            console.log(`[DISCORD] Discord non ancora pronto. Riprovo tra 1s...`);
            setTimeout(checkReadyAndSend, 1000);
            return;
          }
          console.log(`[DISCORD] Discord pronto! Tento di inviare al canale...`);
          try {
            const channelId = '1531018336631132171'; // Target dashboard channel
            let channel = this.client.channels.cache.get(channelId);
            if (!channel) {
              channel = await this.client.channels.fetch(channelId).catch(err => {
                console.warn(`[DISCORD] Impossibile trovare il canale dashboard (ID: ${channelId}): ${err.message}`);
                return null;
              });
            }
            
            if (channel && channel.isTextBased()) {
              const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
              if (messages && messages.size > 0) {
                const deleted = await channel.bulkDelete(messages, true).catch(() => null);
                if (!deleted || deleted.size < messages.size) {
                  const remaining = messages.filter(m => !deleted || !deleted.has(m.id));
                  for (const msg of remaining.values()) {
                    await msg.delete().catch(() => {});
                  }
                }
              }
              const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('🌐 AI Trading Dashboard')
                .setDescription(`Accedi alla dashboard pubblica aggiornata cliccando sul link qui sotto:\n\n**[🔗 Apri Dashboard Web](${url})**\n\n*Nota: la dashboard si aggiorna in tempo reale mostrando proxy, PnL live e le coin rilevate.*`)
                .setTimestamp()
                .setFooter({ text: 'MemeCoin AI Bot' });
              await channel.send({ embeds: [embed] });
              console.log(`[DISCORD] Dashboard link postato con successo nel canale ${channel.name}`);
            } else {
              console.warn(`[DISCORD] Il canale dashboard ${channelId} non è valido o non è testuale.`);
            }
          } catch (err) {
            console.warn(`[DISCORD] Error updating dashboard channel: ${err.message}`);
          }
        };
        checkReadyAndSend();
        return;
      }

      if (eventPayload.type === 'deposit') {
        const data = eventPayload.data;
        if (data && data.discordUserId) {
          try {
            const discordUser = await this.client.users.fetch(data.discordUserId);
            if (discordUser) {
              const dmEmbed = new EmbedBuilder()
                .setTitle('💰 Deposito Ricevuto!')
                .setColor('#00ff00')
                .setDescription(`Abbiamo rilevato un nuovo deposito sul tuo portafoglio Solana di trading!`)
                .addFields(
                  { name: 'Importo Depositato', value: `${data.depositAmount.toFixed(4)} SOL`, inline: true },
                  { name: 'Nuovo Saldo Totale', value: `${data.newBalance.toFixed(4)} SOL`, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'MemeCoin AI Bot - Notifiche Wallet' });
              
              await discordUser.send({ embeds: [dmEmbed] });
              console.log(`[DISCORD] Inviato DM di notifica deposito all'utente ${data.discordUserId}`);
            }
          } catch (err) {
            console.error(`[DISCORD] Errore invio DM per deposito a ${data.discordUserId}:`, err.message);
          }
        }
        return;
      }

      if (eventPayload.type === 'candidate') {
        this.recentCandidates.push(eventPayload.data);
        if (this.recentCandidates.length > 20) {
          this.recentCandidates.shift();
        }
        // DO NOT SEND RAW CANDIDATES TO DISCORD ANYMORE (Spam prevention)
        return;
      }

      if (eventPayload.type === 'trade') {
        const tradeData = eventPayload.data;
        if (tradeData && tradeData.simulated === false && tradeData.discordUserId) {
          try {
            const discordUser = await this.client.users.fetch(tradeData.discordUserId);
            if (discordUser) {
              const embedColor = eventPayload.type === 'trade' ? '#00ff00' : '#ff0000';
              const embedTitle = eventPayload.type === 'trade' 
                ? `✅ LIVE TRADE ESEGUITO: ${tradeData.candidate?.symbol || 'Token'}` 
                : `❌ LIVE TRADE FALLITO: ${tradeData.candidate?.symbol || 'Token'}`;
              
              const dmEmbed = new EmbedBuilder()
                .setTitle(embedTitle)
                .setColor(embedColor)
                .addFields(
                  { name: 'Importo (SOL)', value: `${tradeData.amountSol}`, inline: true },
                  { name: 'Dettagli / Motivo', value: tradeData.reason || 'Nessun dettaglio aggiuntivo', inline: false }
                )
                .setTimestamp()
                .setFooter({ text: 'MemeCoin AI Bot - Notifiche Live Trading' });

              if (tradeData.txHash) {
                dmEmbed.addFields({ name: 'Transaction', value: `[Vedi su Solscan](https://solscan.io/tx/${tradeData.txHash})`, inline: false });
              }

              await discordUser.send({ embeds: [dmEmbed] });
              console.log(`[DISCORD] Inviato DM di aggiornamento (tipo: ${eventPayload.type}) all'utente ${tradeData.discordUserId}`);
            }
          } catch (e) {
            console.warn(`[DISCORD] Errore invio DM all'utente ${tradeData.discordUserId}: ${e.message}`);
          }
        }
      }

      if (eventPayload.type === 'trade-sell') {
        const sellData = eventPayload.data;
        if (sellData && sellData.discordUserId) {
          try {
            const discordUser = await this.client.users.fetch(sellData.discordUserId);
            if (discordUser) {
              const dmEmbed = new EmbedBuilder()
                .setTitle(`💸 LIVE TRADE CHIUSO: ${sellData.symbol}`)
                .setColor('#00ff00')
                .setDescription(`Il bot ha venduto la posizione per raggiungere un Take Profit o Stop Loss in totale autonomia!`)
                .addFields(
                  { name: 'Motivo', value: sellData.reason || 'Sconosciuto', inline: true },
                  { name: 'SOL Ricevuti (Stima)', value: `${sellData.solReceived.toFixed(4)} SOL`, inline: true },
                  { name: 'Transaction', value: `[Vedi su Solscan](https://solscan.io/tx/${sellData.txHash})`, inline: false }
                )
                .setTimestamp()
                .setFooter({ text: 'MemeCoin AI Bot - Auto-Sell' });

              await discordUser.send({ embeds: [dmEmbed] });
              console.log(`[DISCORD] Inviato DM di Auto-Vendita all'utente ${sellData.discordUserId}`);
            }
          } catch (e) {
            console.warn(`[DISCORD] Errore invio DM vendita all'utente ${sellData.discordUserId}: ${e.message}`);
          }
        }
        return; // Non spammare nel channel pubblico
      }

      if (!this.isReady) return;

      // Modalità Allenamento Silenzioso: se TRAINING_MODE è true, non spammare Discord con le simulazioni,
      // a meno che non sia un link dashboard. Usa la web dashboard per monitorare!
      if (config.TRAINING_MODE && (eventPayload.type === 'ai-approved' || eventPayload.type === 'trade' || eventPayload.type === 'skip')) {
        return;
      }

      const candidate = eventPayload.data?.candidate || eventPayload.data;
      const rugScore = eventPayload.data?.score || eventPayload.data?.rugScore || 0;
      const aiScore = eventPayload.data?.aiScore || 0;
      const profitScore = candidate ? this.calculateProfitScore(candidate, rugScore) : 75;

      const embed = this.createEmbedForEvent(eventPayload);
      if (!embed) return;

      if (config.DISCORD_CHANNEL_ID) {
        try {
          const channel = await this.client.channels.fetch(config.DISCORD_CHANNEL_ID);
          if (channel && channel.isTextBased()) {
            await channel.send({ embeds: [embed] });
            return;
          }
        } catch (err) {
          // Continue
        }
      }

      for (const guild of this.client.guilds.cache.values()) {
        try {
          if (candidate && candidate.symbol) {
            // 1. Canale dedicato alla valuta: only for high-scoring tokens, enforces channel limit
            const currencyChannel = await this.getOrCreateCurrencyChannel(guild, candidate, profitScore);
            if (currencyChannel) {
              await this.updateCurrencyChannelWithSingleLiveMessage(currencyChannel, embed);
            }

            // 2. Canale #important: Invia l'opportunità eccezionale eliminando prima eventuali messaggi vecchi o duplicati dello stesso token
            if (this.isCrazyOpportunity(candidate, rugScore, profitScore)) {
              await this.sendOrUpdateImportantMessage(guild, candidate, profitScore, rugScore);
            }
          } else {
            const defaultChannel = this.findFirstWritableChannel(guild);
            if (defaultChannel) {
              await defaultChannel.send({ embeds: [embed] });
            }
          }
        } catch (err) {
          console.warn(`[DISCORD] Error sending event to ${guild.name}: ${err.message}`);
        }
      }
    });
  }

  async sendOrUpdateImportantMessage(guild, candidate, profitScore, rugScore) {
    try {
      const importantChannel = await this.getImportantChannel(guild);
      if (!importantChannel) return;

      // Cerca i messaggi esistenti in #important per rimuovere copie o notifiche precedenti dello stesso mint/symbol
      const messages = await importantChannel.messages.fetch({ limit: 50 }).catch(() => null);
      if (messages && messages.size > 0) {
        const duplicates = messages.filter(msg => {
          const contentStr = JSON.stringify(msg.embeds || {}) + ' ' + (msg.content || '');
          return contentStr.includes(candidate.mint) || contentStr.includes(candidate.symbol);
        });

        for (const dupMsg of duplicates.values()) {
          await dupMsg.delete().catch(() => {});
        }
      }

      const importantEmbed = new EmbedBuilder()
        .setTitle(`[HIGH-CONVICTION OPPORTUNITY] ${candidate.symbol}`)
        .setURL(candidate.url)
        .setColor(0xF59E0B)
        .addFields(
          { name: 'Valuta / Token', value: `${candidate.name} (\`${candidate.mint}\`)`, inline: false },
          { name: 'Profit Score', value: `\`${profitScore} / 100\``, inline: true },
          { name: 'RugCheck Score', value: `\`${rugScore} / 100\``, inline: true },
          { name: 'Liquidità USD', value: `$${Number(candidate.liquidityUsd).toLocaleString()}`, inline: true },
          { name: 'Volume 5m / 24h', value: `$${Number(candidate.volume5mUsd || 0).toLocaleString()} / $${Number(candidate.volume24hUsd).toLocaleString()}`, inline: true },
          { name: 'Segnale', value: 'Parametri eccezionali di volume, sicurezza e liquidità rilevati.', inline: false }
        )
        .setTimestamp();

      const contentMsg = config.TRAINING_MODE ? 'RARE HIGH-CONVICTION OPPORTUNITY DETECTED (Training)' : '@everyone RARE HIGH-CONVICTION OPPORTUNITY DETECTED';
      await importantChannel.send({ content: contentMsg, embeds: [importantEmbed] });
      this.notifiedImportantMints.add(candidate.mint);
    } catch (err) {
      console.warn(`[DISCORD] Errore invio messaggio #important: ${err.message}`);
    }
  }

  createLiveMarketEmbed(candidate, profitScore, rugScore) {
    const chain = (candidate.chain || 'solana').toUpperCase();
    return new EmbedBuilder()
      .setTitle(`[${chain}] ${candidate.name} (${candidate.symbol})`)
      .setURL(candidate.url)
      .setColor(0x3B82F6)
      .addFields(
        { name: 'Token', value: `${candidate.name} (\`${candidate.mint}\`)`, inline: false },
        { name: 'Chain', value: `\`${chain}\``, inline: true },
        { name: 'Price USD', value: `\`$${candidate.priceUsd || 'N/A'}\``, inline: true },
        { name: 'Liquidity', value: `\`$${Number(candidate.liquidityUsd || 0).toLocaleString()}\``, inline: true },
        { name: 'Vol 5m', value: `\`$${Number(candidate.volume5mUsd || 0).toLocaleString()} (${candidate.buys5m || 0} buys)\``, inline: true },
        { name: 'Vol 24h', value: `\`$${Number(candidate.volume24hUsd || 0).toLocaleString()}\``, inline: true },
        { name: 'Profit Score', value: `\`${profitScore} / 100\``, inline: true },
        { name: 'RugCheck', value: `\`${rugScore} / 100\``, inline: true },
        { name: 'Chart', value: `[DexScreener](${candidate.url})`, inline: false }
      )
      .setTimestamp();
  }

  createEmbedForEvent(eventPayload) {
    const { type, data, detectedAt } = eventPayload;

    if (type === 'skip') {
      return null;
    }

    if (type === 'rugcheck') {
      return null; // Silent for rugcheck to prevent spam
    }

    if (type === 'ai-approved') {
      const profitScore = this.calculateProfitScore(data.candidate, data.rugScore);

      return new EmbedBuilder()
        .setTitle(`[AI INSIDER ALERT] ${data.candidate.symbol} | Confidence: ${data.score}%`)
        .setURL(data.candidate.url)
        .setColor(0x8B5CF6)
        .addFields(
          { name: 'Valuta / Token', value: `${data.candidate.name} (\`${data.candidate.mint}\`)`, inline: false },
          { name: 'AI Confidence Score', value: `\`${data.score} / 100\``, inline: true },
          { name: 'RugCheck Score', value: `\`${data.rugScore} / 100\``, inline: true },
          { name: 'Liquidità USD', value: `$${Number(data.candidate.liquidityUsd).toLocaleString()}`, inline: true },
          { name: 'Volume 5m / 24h', value: `$${Number(data.candidate.volume5mUsd || 0).toLocaleString()} (5m) / $${Number(data.candidate.volume24hUsd).toLocaleString()}`, inline: true },
          { name: 'Stato', value: 'Accumulazione Insider rilevata. Approvato per simulazione/acquisto.', inline: false }
        )
        .setTimestamp(new Date(detectedAt));
    }

    if (type === 'trade') {
      const isSim = data.simulated;
      const profitScore = this.calculateProfitScore(data.candidate, 0);

      return new EmbedBuilder()
        .setTitle(`[${isSim ? 'SIMULATED EXECUTION' : 'LIVE ORDER EXECUTED'}] ${data.candidate.symbol} | Score: ${profitScore}/100`)
        .setURL(data.candidate.url)
        .setColor(isSim ? 0x6366F1 : 0x10B981)
        .addFields(
          { name: 'Valuta Acquistata', value: `${data.candidate.name} (\`${data.candidate.mint}\`)`, inline: false },
          { name: 'Profit Score', value: `\`${profitScore} / 100\``, inline: true },
          { name: 'SOL Allocati', value: `${data.amountSol} SOL`, inline: true },
          { name: 'Token Ricevuti (Est.)', value: `~${Number(data.outAmountTokens).toLocaleString()} ${data.candidate.symbol}`, inline: true },
          { name: 'Aggregatore DEX', value: 'Jupiter Swap API v6', inline: true },
          { name: 'Hash Transazione', value: data.txHash ? `[Visualizza su Solscan](https://solscan.io/tx/${data.txHash})` : 'Simulazione (Dry-Run)', inline: false }
        )
        .setTimestamp();
    }

    if (type === 'social-mention') {
      return new EmbedBuilder()
        .setTitle(`[SIGNAL DETECTED] ${data.keyword.toUpperCase()}`)
        .setURL(data.link || '')
        .setColor(0x0EA5E9)
        .addFields(
          { name: 'Source Header', value: data.title || 'Signal Event', inline: false },
          { name: 'Content Preview', value: (data.snippet || '').slice(0, 300) || 'N/A', inline: false }
        )
        .setTimestamp(new Date(detectedAt));
    }

    return null;
  }

  async showLivePortfolio(interaction) {
    await interaction.deferReply({ flags: 64 });
    
    const user = userDatabase.users.get(interaction.user.id);
    if (!user || !user.publicKey) {
      return interaction.editReply('Nessun wallet registrato. Usa `/wallet register`.');
    }

    try {
      const pubKey = new PublicKey(user.publicKey);
      const connection = new Connection(config.SOLANA_RPC_URL, 'confirmed');
      const solBalanceLamports = await connection.getBalance(pubKey);
      const solBalance = solBalanceLamports / 1e9;

      // Fetch SPL tokens
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubKey, {
        programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
      });

      const holdings = [];
      const mints = [];

      tokenAccounts.value.forEach(account => {
        const info = account.account.data.parsed.info;
        const amount = info.tokenAmount.uiAmount;
        if (amount > 0) {
          holdings.push({ mint: info.mint, amount });
          mints.push(info.mint);
        }
      });

      let totalUsdValue = 0;
      let tokensText = '';

      if (mints.length > 0) {
        const chunkSize = 30;
        const prices = {};
        for (let i = 0; i < mints.length; i += chunkSize) {
          const chunk = mints.slice(i, i + chunkSize).join(',');
          try {
            const res = await proxyManager.fetchWithProxy(`https://api.dexscreener.com/latest/dex/tokens/${chunk}`);
            const data = await res.json();
            if (data && data.pairs) {
              data.pairs.forEach(pair => {
                if (pair.baseToken && !prices[pair.baseToken.address]) {
                  prices[pair.baseToken.address] = {
                    priceUsd: parseFloat(pair.priceUsd || 0),
                    symbol: pair.baseToken.symbol,
                    url: pair.url
                  };
                }
              });
            }
          } catch (e) {
            console.warn('[PORTFOLIO] Errore fetch DexScreener per portfolio', e.message);
          }
        }

        for (const holding of holdings) {
          const priceData = prices[holding.mint] || { priceUsd: 0, symbol: 'UNKNOWN' };
          const valueUsd = priceData.priceUsd * holding.amount;
          totalUsdValue += valueUsd;
          
          const symbolLink = priceData.url ? `[${priceData.symbol}](${priceData.url})` : priceData.symbol;
          tokensText += `• **${symbolLink}**: ${holding.amount.toFixed(2)} ($${valueUsd.toFixed(2)})\n`;
        }
      } else {
        tokensText = '*Nessun token presente nel wallet.*';
      }

      let solPrice = 150; 
      try {
        const solRes = await fetch('https://api.dexscreener.com/latest/dex/search?q=solana');
        const solData = await solRes.json();
        if (solData.pairs && solData.pairs.length > 0) {
          solPrice = parseFloat(solData.pairs[0].priceUsd);
        }
      } catch (e) {}
      
      const solValueUsd = solBalance * solPrice;
      const grandTotalUsd = totalUsdValue + solValueUsd;

      const embed = new EmbedBuilder()
        .setTitle('📊 Live Trading Portfolio')
        .setColor(0x00ff00)
        .setDescription(`Ecco i token reali contenuti nel tuo wallet (\`${user.publicKey}\`).`)
        .addFields(
          { name: 'SOL Disponibili', value: `${solBalance.toFixed(4)} SOL (~$${solValueUsd.toFixed(2)})`, inline: false },
          { name: 'Token Altcoin (Meme)', value: tokensText, inline: false },
          { name: 'Valore Totale Stimato', value: `**$${grandTotalUsd.toFixed(2)} USD**`, inline: false }
        )
        .setTimestamp()
        .setFooter({ text: 'Nota: I prezzi sono stime live da DexScreener.' });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      await interaction.editReply(`Errore nel caricamento del portfolio: ${err.message}`);
    }
  }

  async handleCashout(interaction) {
    const amountStr = interaction.options.getNumber('amount');
    const destination = interaction.options.getString('address');

    await interaction.deferReply({ flags: 64 });

    const user = userDatabase.users.get(interaction.user.id);
    if (!user || !user.encryptedPrivateKey) {
      return interaction.editReply('Nessun wallet registrato o chiave mancante.');
    }

    try {
      const destPubkey = new PublicKey(destination);
      const keypair = userDatabase.getDecryptedKeypair(interaction.user.id);
      
      if (!keypair) {
        return interaction.editReply('Errore interno: impossibile decifrare il wallet.');
      }

      const connection = new Connection(config.SOLANA_RPC_URL, 'confirmed');
      const balance = await connection.getBalance(keypair.publicKey);
      
      const lamportsToSend = amountStr * 1e9;
      if (balance < lamportsToSend + 5000) {
        return interaction.editReply(`Saldo insufficiente per prelevare ${amountStr} SOL (inclusa la fee di rete). Saldo attuale: ${(balance/1e9).toFixed(4)} SOL`);
      }

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: destPubkey,
          lamports: lamportsToSend,
        })
      );

      const latestBlockhash = await connection.getLatestBlockhash();
      transaction.recentBlockhash = latestBlockhash.blockhash;
      transaction.feePayer = keypair.publicKey;

      transaction.sign(keypair);

      const signature = await connection.sendRawTransaction(transaction.serialize());
      await connection.confirmTransaction({
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
      }, 'confirmed');

      const embed = new EmbedBuilder()
        .setTitle('💸 Cashout Eseguito con Successo')
        .setColor(0x00ff00)
        .addFields(
          { name: 'Importo Inviato', value: `${amountStr} SOL`, inline: true },
          { name: 'Destinazione', value: `\`${destination}\``, inline: false },
          { name: 'Transazione', value: `[Vedi su Solscan](https://solscan.io/tx/${signature})`, inline: false }
        )
        .setTimestamp();
        
      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error(err);
      await interaction.editReply(`Errore durante il prelievo: ${err.message}`);
    }
  }

  async sendSecurityAlert(message, level = 'MEDIUM') {
    if (!config.DISCORD_OWNER_ID) return;
    try {
      const ownerUser = await this.client.users.fetch(config.DISCORD_OWNER_ID);
      if (ownerUser) {
        const color = level === 'CRITICAL' ? 0x990000 : (level === 'HIGH' ? 0xff0000 : 0xffaa00);
        const embed = new EmbedBuilder()
          .setTitle(`[SECURITY ALERT] Livello: ${level}`)
          .setDescription(message)
          .setColor(color)
          .setTimestamp();
        await ownerUser.send({ embeds: [embed] });
      }
    } catch (err) {
      console.error(`[SECURITY] Impossibile inviare l'allarme DM all'owner: ${err.message}`);
    }
  }
}

export const discordClient = new DiscordClient();
