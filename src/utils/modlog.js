const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const db = require('../database');
const { formatDuration, truncate } = require('./helpers');
const { t } = require('../texts');

const TYPES = {
  ban: { emoji: '🔨', color: 'danger' },
  unban: { emoji: '🔓', color: 'success' },
  kick: { emoji: '👢', color: 'danger' },
  sustur: { emoji: '🔇', color: 'warn' },
  susturma_kaldir: { emoji: '🔊', color: 'success' },
  uyari: { emoji: '⚠️', color: 'warn' },
  otomod: { emoji: '🤖', color: 'info' },
};

function typeInfo(type) {
  const known = TYPES[type];
  return {
    label: known ? t(`case.type.${type}`) : type,
    emoji: known?.emoji ?? '📌',
    color: config.colors[known?.color ?? 'main'],
  };
}

function caseEmbed(c) {
  const ti = typeInfo(c.type);
  const e = new EmbedBuilder()
    .setColor(ti.color)
    .setTitle(t('case.title', { emoji: ti.emoji, type: ti.label, case: c.id }))
    .addFields(
      { name: t('case.field.user'), value: `<@${c.user_id}> (\`${c.user_id}\`)`, inline: true },
      { name: t('case.field.mod'), value: c.mod_id === 'otomod' ? t('case.auto') : `<@${c.mod_id}>`, inline: true },
      { name: t('case.field.reason'), value: truncate(c.reason, 1000) || t('mod.noreason') },
    )
    .setTimestamp(c.created_at * 1000);
  if (c.duration_sec) e.addFields({ name: t('case.field.duration'), value: formatDuration(c.duration_sec), inline: true });
  return e;
}

async function getLogChannel(guild) {
  const id = db.getSettings(guild.id).modlog_channel;
  if (!id) return null;
  const ch = await guild.channels.fetch(id).catch(() => null);
  return ch?.isTextBased() ? ch : null;
}

async function sendLog(guild, payload) {
  const ch = await getLogChannel(guild);
  if (!ch) return;
  await ch.send(payload).catch((err) => console.error('[modlog]', err.message));
}

const sendCaseLog = (guild, c) => sendLog(guild, { embeds: [caseEmbed(c)] });

// Aktif uyarı sayısı eşiği aşarsa otomatik susturma uygular.
async function checkWarnEscalation(guild, userId) {
  const s = db.getSettings(guild.id);
  if (!s.warn_threshold || db.countActiveWarns(guild.id, userId) < s.warn_threshold) return null;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member?.moderatable) return null;
  const sec = s.warn_timeout_min * 60;
  const reason = t('case.escalation_reason', { count: s.warn_threshold });
  await member.timeout(Math.min(sec, 28 * 86400) * 1000, reason).catch(() => null);
  const c = db.addCase({ guildId: guild.id, userId, modId: guild.client.user.id, type: 'sustur', reason, durationSec: sec });
  await sendCaseLog(guild, c);
  return c;
}

module.exports = { typeInfo, caseEmbed, getLogChannel, sendLog, sendCaseLog, checkWarnEscalation };
