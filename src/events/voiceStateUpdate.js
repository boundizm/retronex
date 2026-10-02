const { Events } = require('discord.js');
const { onVoiceStateUpdate } = require('../features/voice');

module.exports = {
  name: Events.VoiceStateUpdate,
  execute: (o, n) => onVoiceStateUpdate(o, n).catch((e) => console.error('[ses]', e)),
};
