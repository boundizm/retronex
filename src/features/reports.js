const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags,
} = require('discord.js');
const config = require('../config');
const db = require('../database');
const { t } = require('../texts');
const { ok, fail, ts, truncate } = require('../utils/helpers');

const MAX_PENDING = 5;

const STATUS_LABEL = { 'çözüldü': 'report.status.resolved', reddedildi: 'report.status.rejected' };

function reportEmbed(r, status = null) {
  const e = new EmbedBuilder()
    .setColor(status === 'çözüldü' ? config.colors.success : status === 'reddedildi' ? config.colors.danger : config.colors.warn)
    .setTitle(t('report.title', { id: r.id }))
    .addFields(
      { name: t('report.field.reporter'), value: `<@${r.reporter_id}>`, inline: true },
      { name: t('report.field.target'), value: r.target_id ? `<@${r.target_id}>` : '—', inline: true },
      { name: t('report.field.status'), value: status ? t('report.status.handled', { status: t(STATUS_LABEL[status]), mod: r.handled_by }) : t('report.status.pending'), inline: true },
      { name: t('report.field.reason'), value: truncate(r.reason, 1000) },
    )
    .setTimestamp(r.created_at * 1000);
  if (r.evidence) e.addFields({ name: t('report.field.evidence'), value: truncate(r.evidence, 1000) });
  return e;
}

const buttons = (id, disabled = false) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`rapor:kabul:${id}`).setLabel(t('report.btn.accept')).setStyle(ButtonStyle.Success).setDisabled(disabled),
  new ButtonBuilder().setCustomId(`rapor:red:${id}`).setLabel(t('report.btn.reject')).setStyle(ButtonStyle.Danger).setDisabled(disabled),
);

// interaction: komut ya da modal. Cevabı kendisi verir.
async function submitReport(i, { targetId, reason, evidence }) {
  const s = db.getSettings(i.guildId);
  const channel = s.report_channel ? await i.guild.channels.fetch(s.report_channel).catch(() => null) : null;
  if (!channel) return i.reply(fail(t('report.no_channel')));
  if (targetId === i.user.id) return i.reply(fail(t('report.self')));
  if (db.countPendingReports(i.guildId, i.user.id) >= MAX_PENDING) {
    return i.reply(fail(t('report.limit', { max: MAX_PENDING })));
  }

  const r = db.addReport({ guildId: i.guildId, reporterId: i.user.id, targetId, reason, evidence });
  const staff = s.staff_role ? `<@&${s.staff_role}>` : '';
  await channel.send({
    content: staff || undefined,
    embeds: [reportEmbed(r)],
    components: [buttons(r.id)],
    allowedMentions: { roles: s.staff_role ? [s.staff_role] : [] },
  });
  return i.reply(ok(t('report.sent', { id: r.id })));
}

async function handleButton(i) {
  const [, action, idStr] = i.customId.split(':');
  if (!i.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
    return i.reply(fail(t('generic.nopermission')));
  }
  const r = db.getReport(Number(idStr));
  if (!r || r.status !== 'bekliyor') return i.reply(fail(t('report.already')));

  const status = action === 'kabul' ? 'çözüldü' : 'reddedildi';
  db.resolveReport(r.id, status, i.user.id);
  const updated = db.getReport(r.id);
  await i.update({ embeds: [reportEmbed(updated, status)], components: [buttons(r.id, true)] });

  const reporter = await i.client.users.fetch(r.reporter_id).catch(() => null);
  await reporter?.send(
    t(status === 'çözüldü' ? 'report.dm.resolved' : 'report.dm.rejected', { guild: i.guild.name, id: r.id }),
  ).catch(() => {});
}

module.exports = { submitReport, handleButton, reportEmbed };
