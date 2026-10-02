const {
  SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType, InteractionContextType,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags,
} = require('discord.js');
const { submitReport } = require('../features/reports');

const rapor = {
  data: new SlashCommandBuilder()
    .setName('rapor')
    .setDescription('Bir kullanıcıyı yetkililere raporla')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) => o.setName('kullanici').setDescription('Raporlanan kullanıcı').setRequired(true))
    .addStringOption((o) => o.setName('sebep').setDescription('Ne oldu?').setRequired(true).setMaxLength(1000))
    .addAttachmentOption((o) => o.setName('kanit').setDescription('Ekran görüntüsü vb. (opsiyonel)')),
  async execute(i) {
    const target = i.options.getUser('kullanici', true);
    if (target.bot) return i.reply({ content: 'Botlar raporlanamaz.', flags: MessageFlags.Ephemeral });
    const att = i.options.getAttachment('kanit');
    return submitReport(i, { targetId: target.id, reason: i.options.getString('sebep', true), evidence: att?.url });
  },
};

// Sağ tık -> Uygulamalar -> "Mesajı Raporla"
const mesajRapor = {
  data: new ContextMenuCommandBuilder()
    .setName('Mesajı Raporla')
    .setType(ApplicationCommandType.Message)
    .setContexts(InteractionContextType.Guild),
  async execute(i) {
    const msg = i.targetMessage;
    const modal = new ModalBuilder()
      .setCustomId(`rapor:modal:${msg.channelId}:${msg.id}:${msg.author.id}`)
      .setTitle('Mesajı Raporla')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('sebep').setLabel('Sebep').setStyle(TextInputStyle.Paragraph)
          .setRequired(true).setMaxLength(900).setPlaceholder('Bu mesajda ne sorun var?'),
      ));
    return i.showModal(modal);
  },
};

module.exports = [rapor, mesajRapor];
