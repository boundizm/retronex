const { Events } = require('discord.js');
const voice = require('../features/voice');
const tickets = require('../features/tickets');
const { startPanel } = require('../web/server');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    startPanel(client);
    console.log(`✅ ${client.user.tag} hazır — ${client.guilds.cache.size} sunucu`);
    await tickets.ensurePanel(client).catch((e) => console.error('[bilet] panel:', e.message));
    await voice.cleanup(client).catch((e) => console.error('[ses] temizlik:', e));
  },
};
