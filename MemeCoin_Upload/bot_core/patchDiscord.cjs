const fs = require('fs');
const file = 'src/discordClient.js';
let content = fs.readFileSync(file, 'utf8');

// Add locales import
if (!content.includes('import { t } from')) {
    content = "import { t } from './locales.js';\n" + content;
}

// Add language command to getCommandPayload
if (!content.includes('.setName(\'language\')')) {
    content = content.replace(
        "return [",
        "return [\n      new SlashCommandBuilder()\n        .setName('language')\n        .setDescription('Change bot language / Cambia lingua del bot')\n        .addStringOption(opt => \n          opt.setName('lang')\n          .setDescription('Language (en/it)')\n          .setRequired(true)\n          .addChoices(\n            { name: 'English', value: 'en' },\n            { name: 'Italiano', value: 'it' }\n          )\n        ),"
    );
}

// Add language command handler
if (!content.includes("if (commandName === 'language')")) {
    content = content.replace(
        "if (commandName === 'dashboard')",
        "if (commandName === 'language') {\n        const lang = interaction.options.getString('lang');\n        userDatabase.setLanguage(interaction.user.id, lang);\n        return interaction.reply({ content: t('language_updated', lang), ephemeral: true });\n      }\n\n      if (commandName === 'dashboard')"
    );
}

// Patch specific hardcoded replies for dashboard to use t()
content = content.replace(
    /return interaction\.reply\(\{ content: `Ecco il tuo link segreto alla Dashboard Web:\\n\\n\*\*\\[🌐 Apri la mia Dashboard\\]\(\$\{link\}\)\*\*`, ephemeral: true \}\);/g,
    "const lang = userDatabase.getUserInfo(interaction.user.id)?.language || 'en';\n        return interaction.reply({ content: t('dashboard_secret_link', lang) + `**[🌐 Open Dashboard](${link})**`, ephemeral: true });"
);

fs.writeFileSync(file, content, 'utf8');
