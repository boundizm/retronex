const { EmbedBuilder } = require('discord.js');
const { caseEmbed } = require('./modlog');
const { t } = require('../texts');

// Hedef üzerinde işlem yapılabilir mi? Hata metni ya da null döner.
function checkTarget(interaction, member, botCan) {
  if (!member) return null; // sunucuda değil
  if (member.id === interaction.user.id) return t('mod.target.self');
  if (member.id === interaction.client.user.id) return t('mod.target.bot');
  if (member.id === interaction.guild.ownerId) return t('mod.target.owner');
  if (interaction.user.id !== interaction.guild.ownerId &&
      interaction.member.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
    return t('mod.target.hierarchy');
  }
  if (!botCan(member)) return t('mod.target.botcant');
  return null;
}

// Cezalı kullanıcıya DM (itiraz bilgisiyle). Gönderilemezse false.
async function dmPunished(user, guild, c, extra = '') {
  const e = new EmbedBuilder(caseEmbed(c).toJSON())
    .setTitle(t('dm.title', { guild: guild.name, case: c.id }))
    .setFooter({ text: t('dm.footer') })
    .setDescription(`${extra}\n${t('dm.hint', { case: c.id })}`.trim());
  return user.send({ embeds: [e] }).then(() => true).catch(() => false);
}

module.exports = { checkTarget, dmPunished };
