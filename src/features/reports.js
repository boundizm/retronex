const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags,
} = require('discord.js');
const config = require('../config');
const db = require('../database');
const { ok, fail, ts, truncate } = require('../utils/helpers');

const MAX_PENDING = 5;

function reportEmbed(r, status = null) {
  const e = new EmbedBuilder()
    .setColor(status === 'çözüldü' ? config.colors.success : status === 'reddedildi' ? config.colors.danger : config.colors.warn)
    .setTitle(`📢 Rapor #${r.id}`)
    .addFields(
      { name: 'Raporlayan', value: `<@${r.reporter_id}>`, inline: true },
      { name: 'Raporlanan', value: r.target_id ? `<@${r.target_id}>` : '—', inline: true },
      { name: 'Durum', value: status ? `${status} (<@${r.handled_by}>)` : 'bekliyor', inline: true },
      { name: 'Sebep', value: truncate(r.reason, 1000) },
    )
    .setTimestamp(r.created_at * 1000);
  if (r.evidence) e.addFields({ name: 'Kanıt', value: truncate(r.evidence, 1000) });
  return e;
}

const buttons = (id, disabled = false) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`rapor:kabul:${id}`).setLabel('İşlem yapıldı').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(disabled),
  new ButtonBuilder().setCustomId(`rapor:red:${id}`).setLabel('Geçersiz').setEmoji('🚫').setStyle(ButtonStyle.Danger).setDisabled(disabled),
);

// interaction: komut ya da modal. Cevabı kendisi verir.
async function submitReport(i, { targetId, reason, evidence }) {
  const s = db.getSettings(i.guildId);
  const channel = s.report_channel ? await i.guild.channels.fetch(s.report_channel).catch(() => null) : null;
  if (!channel) return i.reply(fail('Rapor kanalı ayarlanmamış. Bir yöneticiye `/ayar rapor-kanali` kullanmasını söyle.'));
  if (targetId === i.user.id) return i.reply(fail('Kendini raporlayamazsın.'));
  if (db.countPendingReports(i.guildId, i.user.id) >= MAX_PENDING) {
    return i.reply(fail(`En fazla ${MAX_PENDING} bekleyen raporun olabilir. Lütfen yetkililerin ilgilenmesini bekle.`));
  }

  const r = db.addReport({ guildId: i.guildId, reporterId: i.user.id, targetId, reason, evidence });
  const staff = s.staff_role ? `<@&${s.staff_role}>` : '';
  await channel.send({
    content: staff || undefined,
    embeds: [reportEmbed(r)],
    components: [buttons(r.id)],
    allowedMentions: { roles: s.staff_role ? [s.staff_role] : [] },
  });
  return i.reply(ok(`Raporun yetkililere iletildi. (Rapor #${r.id})`));
}

async function handleButton(i) {
  const [, action, idStr] = i.customId.split(':');
  if (!i.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
    return i.reply({ ...fail('Bunun için yetkin yok.') });
  }
  const r = db.getReport(Number(idStr));
  if (!r || r.status !== 'bekliyor') return i.reply({ ...fail('Bu rapor zaten sonuçlandırılmış.') });

  const status = action === 'kabul' ? 'çözüldü' : 'reddedildi';
  db.resolveReport(r.id, status, i.user.id);
  const updated = db.getReport(r.id);
  await i.update({ embeds: [reportEmbed(updated, status)], components: [buttons(r.id, true)] });

  const reporter = await i.client.users.fetch(r.reporter_id).catch(() => null);
  await reporter?.send(
    status === 'çözüldü'
      ? `✅ **${i.guild.name}** sunucusundaki **#${r.id}** numaralı raporun incelendi ve gerekli işlem yapıldı. Teşekkürler!`
      : `ℹ️ **${i.guild.name}** sunucusundaki **#${r.id}** numaralı raporun incelendi ancak işlem gerektirmediği değerlendirildi.`,
  ).catch(() => {});
}

module.exports = { submitReport, handleButton, reportEmbed };
