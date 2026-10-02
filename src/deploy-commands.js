const { REST, Routes } = require('discord.js');
const config = require('./config');
const { loadCommands } = require('./loader');

(async () => {
  if (!config.token || !config.clientId) throw new Error('DISCORD_TOKEN ve CLIENT_ID gerekli (.env).');
  const body = loadCommands().map((c) => c.data.toJSON());
  const rest = new REST().setToken(config.token);
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);
  await rest.put(route, { body });
  console.log(`✅ ${body.length} komut ${config.guildId ? 'sunucuya' : 'global olarak'} yüklendi.`);
  if (config.guildId) console.log('ℹ️ /itiraz\'ın bot DM\'inde çalışması için komutlar global yüklenmeli (GUILD_ID boş bırak).');
})().catch((e) => { console.error(e); process.exit(1); });
