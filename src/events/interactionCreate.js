const { Events, MessageFlags } = require('discord.js');
const { submitReport, handleButton: reportButton } = require('../features/reports');
const { submitAppeal, handleButton: appealButton } = require('../features/appeals');
const voice = require('../features/voice');
const tickets = require('../features/tickets');
const { fail } = require('../utils/helpers');

async function route(i) {
  if (i.isChatInputCommand() || i.isContextMenuCommand()) {
    const cmd = i.client.commands.get(i.commandName);
    return cmd?.execute(i);
  }

  const [scope, kind, ...rest] = (i.customId ?? '').split(':');

  if (i.isStringSelectMenu() && scope === 'ticket') return tickets.handleSelect(i);

  if (i.isButton()) {
    if (scope === 'ticket') return tickets.handleButton(i);
    if (scope === 'rapor') return reportButton(i);
    if (scope === 'itiraz') return appealButton(i);
    if (scope === 'ses') return voice.handleComponent(i);
  }

  if (i.isModalSubmit()) {
    if (scope === 'ses') return voice.handleComponent(i);
    if (scope === 'itiraz' && kind === 'modal') {
      return submitAppeal(i, Number(rest[0]), i.fields.getTextInputValue('metin'));
    }
    if (scope === 'rapor' && kind === 'modal') {
      const [channelId, messageId, authorId] = rest;
      const author = await i.client.users.fetch(authorId).catch(() => null);
      if (author?.bot) return i.reply(fail('Botlar raporlanamaz.'));
      return submitReport(i, {
        targetId: authorId,
        reason: i.fields.getTextInputValue('sebep'),
        evidence: `https://discord.com/channels/${i.guildId}/${channelId}/${messageId}`,
      });
    }
  }
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(i) {
    try {
      await route(i);
    } catch (err) {
      console.error(`[etkileşim] ${i.commandName ?? i.customId}:`, err);
      const payload = { ...fail('Bir hata oluştu, lütfen daha sonra tekrar dene.'), flags: MessageFlags.Ephemeral };
      if (!i.isRepliable()) return;
      if (i.deferred || i.replied) await i.followUp(payload).catch(() => {});
      else await i.reply(payload).catch(() => {});
    }
  },
};
