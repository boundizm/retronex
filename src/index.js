const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');
const config = require('./config');
const { loadCommands, loadEvents } = require('./loader');

if (!config.token) {
  console.error('DISCORD_TOKEN bulunamadı. .env dosyasını oluştur (.env.example\'a bak).');
  process.exit(1);
}

const client = new Client({
  // MessageContent (ayrıcalıklı intent) gerekmez: seviye sistemi sadece mesajın varlığını sayar.
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // ayrıcalıklı: Developer Portal'dan "Server Members Intent" açılmalı
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.AutoModerationExecution,
  ],
  partials: [Partials.Channel],
});

client.commands = new Collection(loadCommands().map((c) => [c.data.name, c]));
loadEvents(client);

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
client.login(config.token);
