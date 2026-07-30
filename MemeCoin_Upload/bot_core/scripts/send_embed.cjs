require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

client.once('ready', async () => {
  try {
    let cmdChannel = null;
    
    // Cerca in tutte le guild il canale che si chiama "cmd"
    for (const [guildId, guild] of client.guilds.cache) {
       const channel = guild.channels.cache.find(c => c.name === 'cmd' || c.name === 'commands');
       if (channel) {
         cmdChannel = channel;
         break;
       }
    }
    
    // Se non lo trova, prova a usare il primo disponibile o l'important channel
    if (!cmdChannel) {
       for (const [guildId, guild] of client.guilds.cache) {
         const channel = guild.channels.cache.find(c => c.type === 0); // 0 = GUILD_TEXT
         if (channel) {
            cmdChannel = channel;
            break;
         }
       }
    }

    if (!cmdChannel) {
      console.error('Nessun canale testuale trovato.');
      process.exit(1);
    }

    const embed = new EmbedBuilder()
      .setTitle('🚀 **MemeCoin AI Bot - Command Reference**')
      .setDescription('Welcome to the ultimate AI-powered Solana trading bot. The commands have been streamlined to make your experience as clean and secure as possible. Here is what you can do:')
      .setColor(0x00FF00)
      .addFields(
        { name: '📊 `/dashboard`', value: 'Get your **secret magic link** to access the Web Dashboard. Monitor live PnL, open positions, system uptime, and AI stats in a beautiful web interface.', inline: false },
        { name: '💼 `/wallet`', value: 'Manage your funds privately.\n- `register`: Link your Solana Private Key (AES-256 encrypted).\n- `info`: View your real balance and wallet status.\n- `limits`: Set your max risk (e.g. max SOL per trade/day).\n- `cashout`: Withdraw SOL to Phantom or Binance.\n- `export` / `remove`: View or delete your key permanently.', inline: false },
        { name: '⚡ `/trade`', value: 'Control the automated AI purchases.\n- `start`: Enable live trading with real money.\n- `pause`: Stop the bot from making new purchases.', inline: false },
        { name: '🎮 `/paper`', value: 'Test the AI with fake money (1.0 SOL).\n- `start`: Enable paper trading.\n- `status` / `results`: Check your virtual PnL and active trades.\n- `reset`: Wipe your paper balance back to 1.0 SOL.', inline: false },
        { name: '🔒 Security First', value: 'All commands are **ephemeral**, meaning their output is only visible to you. Nobody else in the server can see your wallet balance, settings, or trades.', inline: false }
      )
      .setFooter({ text: 'Antigravity AI Trading System V3' })
      .setTimestamp();

    await cmdChannel.send({ embeds: [embed] });
    console.log('Embed inviato con successo al canale ' + cmdChannel.name);
    process.exit(0);
  } catch (err) {
    console.error('Errore:', err);
    process.exit(1);
  }
});

client.login(process.env.DISCORD_TOKEN);
