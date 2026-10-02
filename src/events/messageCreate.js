const { Events } = require('discord.js');
const { handleMessage } = require('../features/levels');

module.exports = {
  name: Events.MessageCreate,
  execute: (message) => handleMessage(message).catch((e) => console.error('[seviye]', e)),
};
