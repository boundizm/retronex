const { Events } = require('discord.js');
const voice = require('../features/voice');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`✅ ${client.user.tag} hazır — ${client.guilds.cache.size} sunucu`);
    await voice.cleanup(client).catch((e) => console.error('[ses] temizlik:', e));
  },
};
