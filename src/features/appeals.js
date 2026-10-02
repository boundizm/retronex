const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits,
} = require('discord.js');
const config = require('../config');
const db = require('../database');
const { t } = require('../texts');
const { ok, fail, truncate } = require('../utils/helpers');
const { sendLog, typeInfo } = require('../utils/modlog');

const APPEALABLE = new Set(['ban', 'sustur', 'kick', 'uyari']);

function appealEmbed(a, c, status = null) {
  const ti = typeInfo(c.type);
  return new EmbedBuilder()
    .setColor(status === 'kabul' ? config.colors.success : status === 'red' ? config.colors.danger : config.colors.info)
    .setTitle(t('appeal.title', { id: a.id, case: c.id, type: ti.label }))
    .addFields(
      { name: t('appeal.field.user'), value: `<@${a.user_id}> (\`${a.user_id}\`)`, inline: true },
      { name: t('appeal.field.giver'), value: c.mod_id === 'otomod' ? t('case.auto') : `<@${c.mod_id}>`, inline: true },
      { name: t('appeal.field.status'), value: status ? t('appeal.status.handled', { status: t(status === 'kabul' ? 'appeal.status.accepted' : 'appeal.status.rejected'), mod: a.handled_by }) : t('appeal.status.pending'), inline: true },
      { name: t('appeal.field.case_reason'), value: truncate(c.reason ?? t('mod.noreason'), 500) },
      { name: t('appeal.field.text'), value: truncate(a.text, 1000) },
    )
    .setTimestamp(a.created_at * 1000);
}

const buttons = (id, disabled = false) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`itiraz:kabul:${id}`).setLabel(t('appeal.btn.accept')).setStyle(ButtonStyle.Success).setDisabled(disabled),
  new ButtonBuilder().setCustomId(`itiraz:red:${id}`).setLabel(t('appeal.btn.reject')).setStyle(ButtonStyle.Danger).setDisabled(disabled),
);

// Modal gönderildiğinde çağrılır (sunucudan ya da DM'den olabilir).
async function submitAppeal(i, caseId, text) {
  const c = db.getCase(caseId);
  if (!c || c.user_id !== i.user.id) return i.reply(fail(t('appeal.notfound')));
  if (!APPEALABLE.has(c.type)) return i.reply(fail(t('appeal.notappealable')));
  if (!c.active) return i.reply(fail(t('appeal.inactive')));
  if (db.hasPendingAppeal(c.id)) return i.reply(fail(t('appeal.pending')));

  const s = db.getSettings(c.guild_id);
  const guild = i.client.guilds.cache.get(c.guild_id);
  const channel = guild && s.appeal_channel ? await guild.channels.fetch(s.appeal_channel).catch(() => null) : null;
  if (!channel) return i.reply(fail(t('appeal.no_channel')));

  const a = db.addAppeal({ guildId: c.guild_id, caseId: c.id, userId: i.user.id, text });
  await channel.send({
    content: s.staff_role ? `<@&${s.staff_role}>` : undefined,
    embeds: [appealEmbed(a, c)],
    components: [buttons(a.id)],
    allowedMentions: { roles: s.staff_role ? [s.staff_role] : [] },
  });
  return i.reply(ok(t('appeal.sent', { id: a.id })));
}

async function revertCase(guild, c, reason) {
  if (c.type === 'ban') await guild.members.unban(c.user_id, reason).catch(() => {});
  else if (c.type === 'sustur') {
    const m = await guild.members.fetch(c.user_id).catch(() => null);
    await m?.timeout(null, reason).catch(() => {});
  }
  db.deactivateCase(c.id);
}

async function handleButton(i) {
  const [, action, idStr] = i.customId.split(':');
  const a = db.getAppeal(Number(idStr));
  if (!a || a.status !== 'bekliyor') return i.reply(fail(t('appeal.already')));
  const c = db.getCase(a.case_id);

  const needed = c.type === 'ban' ? PermissionFlagsBits.BanMembers : PermissionFlagsBits.ModerateMembers;
  if (!i.memberPermissions?.has(needed)) return i.reply(fail(t('appeal.noperm')));
  if (c.mod_id === i.user.id && !i.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return i.reply(fail(t('appeal.own')));
  }

  await i.deferUpdate();
  const accepted = action === 'kabul';
  db.resolveAppeal(a.id, accepted ? 'kabul' : 'red', i.user.id);
  if (accepted) await revertCase(i.guild, c, t('appeal.revert_reason', { id: a.id, mod: i.user.tag }));

  const updated = db.getAppeal(a.id);
  await i.editReply({ embeds: [appealEmbed(updated, c, accepted ? 'kabul' : 'red')], components: [buttons(a.id, true)] });
  await sendLog(i.guild, {
    content: t('appeal.log', { id: a.id, case: c.id, user: a.user_id, mod: i.user.id, result: t(accepted ? 'appeal.status.accepted' : 'appeal.status.rejected') }),
    allowedMentions: { parse: [] },
  });

  const user = await i.client.users.fetch(a.user_id).catch(() => null);
  await user?.send(t(accepted ? 'appeal.dm.accepted' : 'appeal.dm.rejected', { guild: i.guild.name, case: c.id })).catch(() => {});
}

module.exports = { submitAppeal, handleButton };
