const fs = require('fs');
const file = 'src/discordClient.js';
let content = fs.readFileSync(file, 'utf8');

const oldDashboardCode = `      if (commandName === 'dashboard') {
        await interaction.deferReply({ ephemeral: true });
        const { getDashboardUrl } = await import('./dashboard.js');
        const url = getDashboardUrl(discordUserId);
        await interaction.editReply({ content: 'Ecco il tuo link segreto alla Dashboard Web:\\n\\n' + url });
        return;
      }`;

const newDashboardCode = `      if (commandName === 'dashboard') {
        await interaction.deferReply({ ephemeral: true });
        const { getDashboardUrl } = await import('./dashboard.js');
        const url = getDashboardUrl(discordUserId);
        const user = userDatabase.getUserInfo(discordUserId);
        
        let desc = '';
        if (!user) {
           desc = "⚠️ **Non hai ancora registrato un wallet!**\\nPer sbloccare la tua Dashboard Privata (dove vedrai il tuo saldo, il PnL e i tuoi trade), usa prima il comando \`/wallet register\`.\\n\\nNel frattempo, puoi guardare la **Dashboard Pubblica** qui:\\n\\n**[🌐 APRI DASHBOARD PUBBLICA](" + url + ")**";
        } else {
           desc = "🔐 **Accesso Autorizzato**\\nEcco il tuo link segreto e univoco alla Dashboard Web Privata:\\n\\n**[🌐 APRI LA TUA DASHBOARD](" + url + ")**";
        }
        
        await interaction.editReply({ embeds: [new EmbedBuilder().setDescription(desc).setColor(user ? '#00f3ff' : '#ffaa00')] });
        return;
      }`;

if (content.includes(oldDashboardCode)) {
  content = content.replace(oldDashboardCode, newDashboardCode);
} else {
  // Try regex if exact match fails
  content = content.replace(/if \(commandName === 'dashboard'\) \{[\s\S]*?return;\n      \}/, newDashboardCode);
}

fs.writeFileSync(file, content, 'utf8');
