const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const { caseEmbed } = require('./modlog');

// Hedef üzerinde işlem yapılabilir mi? Hata metni ya da null döner.
function checkTarget(interaction, member, botCan) {
  if (!member) return null; // sunucuda değil
  if (member.id === interaction.user.id) return 'Kendine bu işlemi uygulayamazsın.';
  if (member.id === interaction.client.user.id) return 'Bana bu işlemi uygulayamazsın.';
  if (member.id === interaction.guild.ownerId) return 'Sunucu sahibine işlem uygulanamaz.';
  if (interaction.user.id !== interaction.guild.ownerId &&
      interaction.member.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
    return 'Bu kullanıcının rolü seninkiyle aynı ya da senden yüksek.';
  }
  if (!botCan(member)) return 'Bu kullanıcıya işlem uygulayamıyorum (rolü benden yüksek olabilir).';
  return null;
}

// Cezalı kullanıcıya DM (itiraz bilgisiyle). Gönderilemezse false.
async function dmPunished(user, guild, c, extra = '') {
  const e = new EmbedBuilder(caseEmbed(c).toJSON())
    .setTitle(`${guild.name} | Ceza #${c.id}`)
    .setFooter({ text: 'Haksız olduğunu düşünüyorsan itiraz edebilirsin' });
  const hint = `\nİtiraz için \`/itiraz ceza-no:${c.id}\` komutunu kullan (sunucuda ya da bana DM'den).`;
  e.setDescription(`${extra}${hint}`.trim() || null);
  return user.send({ embeds: [e] }).then(() => true).catch(() => false);
}

module.exports = { checkTarget, dmPunished, colors: config.colors };
