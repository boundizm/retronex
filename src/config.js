require('dotenv').config();

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID || null,

  colors: {
    main: 0x5865f2,
    success: 0x57f287,
    warn: 0xfee75c,
    danger: 0xed4245,
    info: 0x3498db,
  },

  // Seviye sistemi
  xp: { min: 15, max: 25, cooldownMs: 60_000 },

  // Varsayılan ceza eşiği: 3 aktif uyarıda 60 dk susturma
  defaults: { warnThreshold: 3, warnTimeoutMin: 60 },

  voice: {
    hubChannelId: process.env.VOICE_HUB_CHANNEL_ID || '1555149263925813258',
    createCooldownMs: 5_000,
    maxNameLength: 100,
  },

  tickets: {
    panelChannelId: process.env.TICKET_PANEL_CHANNEL_ID || '1555279909553709066',
    categoryId: process.env.TICKET_CATEGORY_ID || '1555279862326104124',
    color: 0x1db924,
  },
};
