const {
  SlashCommandBuilder, InteractionContextType, ApplicationIntegrationType,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
} = require('discord.js');
const db = require('../database');
const { fail } = require('../utils/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('itiraz')
    .setDescription('Aldığın bir cezaya itiraz et')
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    // Yasaklı kullanıcılar sunucuda yazamadığı için bot DM'inde de çalışır.
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
    .addIntegerOption((o) => o.setName('ceza-no').setDescription('Ceza numarası (DM/log mesajında yazar)').setRequired(true).setMinValue(1)),
  async execute(i) {
    const id = i.options.getInteger('ceza-no', true);
    const c = db.getCase(id);
    if (!c || c.user_id !== i.user.id) return i.reply(fail('Bu numarada sana ait bir ceza bulunamadı.'));
    if (!c.active) return i.reply(fail('Bu ceza zaten geçersiz ya da kaldırılmış.'));
    if (db.hasPendingAppeal(id)) return i.reply(fail('Bu ceza için zaten bekleyen bir itirazın var.'));

    const modal = new ModalBuilder()
      .setCustomId(`itiraz:modal:${id}`)
      .setTitle(`Ceza #${id} İtirazı`)
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('metin').setLabel('Neden haksız olduğunu düşünüyorsun?')
          .setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(20).setMaxLength(1000),
      ));
    return i.showModal(modal);
  },
};
