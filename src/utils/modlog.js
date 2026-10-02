const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const db = require('../database');
const { ts, formatDuration, truncate } = require('./helpers');

const TYPES = {
  ban: { label: 'Yasaklama', emoji: '🔨', color: config.colors.danger },
  unban: { label: 'Yasak Kaldırma', emoji: '🔓', color: config.colors.success },
  kick: { label: 'Atma', emoji: '👢', color: config.colors.danger },
  sustur: { label: 'Susturma', emoji: '🔇', color: config.colors.warn },
  susturma_kaldir: { label: 'Susturma Kaldırma', emoji: '🔊', color: config.colors.success },
  uyari: { label: 'Uyarı', emoji: '⚠️', color: config.colors.warn },
  otomod: { label: 'Otomatik Moderasyon', emoji: '🤖', color: config.colors.info },
};

const typeInfo = (type) => TYPES[type] || { label: type, emoji: '📌', color: config.colors.main };

function caseEmbed(c) {
  const t = typeInfo(c.type);
  const e = new EmbedBuilder()
    .setColor(t.color)
    .setTitle(`${t.emoji} ${t.label} | Ceza #${c.id}`)
    .addFields(
      { name: 'Kullanıcı', value: `<@${c.user_id}> (\`${c.user_id}\`)`, inline: true },
      { name: 'Yetkili', value: c.mod_id === 'otomod' ? '🤖 Otomatik' : `<@${c.mod_id}>`, inline: true },
      { name: 'Sebep', value: truncate(c.reason, 1000) || '—' },
    )
    .setTimestamp(c.created_at * 1000);
  if (c.duration_sec) e.addFields({ name: 'Süre', value: formatDuration(c.duration_sec), inline: true });
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
  const reason = `${s.warn_threshold} aktif uyarıya ulaşıldı (otomatik)`;
  await member.timeout(Math.min(sec, 28 * 86400) * 1000, reason).catch(() => null);
  const c = db.addCase({ guildId: guild.id, userId, modId: guild.client.user.id, type: 'sustur', reason, durationSec: sec });
  await sendCaseLog(guild, c);
  return c;
}

module.exports = { typeInfo, caseEmbed, getLogChannel, sendLog, sendCaseLog, checkWarnEscalation };
