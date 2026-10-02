const config = require('../config');
const db = require('../database');
const { t } = require('../texts');

const cooldowns = new Map(); // `${guild}:${user}` -> timestamp

async function applyLevelRoles(member, level) {
  const roles = db.getLevelRoles(member.guild.id);
  if (!roles.length) return;
  const eligible = roles.filter((r) => r.level <= level);
  const target = eligible.at(-1); // ulaşılan en yüksek seviye rolü
  const managed = new Set(roles.map((r) => r.role_id));

  const toRemove = member.roles.cache.filter((r) => managed.has(r.id) && r.id !== target?.role_id);
  if (toRemove.size) await member.roles.remove(toRemove, 'Seviye rolü güncelleme').catch(() => {});
  if (target && !member.roles.cache.has(target.role_id)) {
    await member.roles.add(target.role_id, `Seviye ${level} rolü`).catch((e) =>
      console.error(`[seviye] rol verilemedi: ${e.message}`));
  }
}

async function handleMessage(message) {
  if (!message.guild || message.author.bot || message.webhookId) return;
  const settings = db.getSettings(message.guild.id);
  if (!settings.level_enabled) return;

  const key = `${message.guild.id}:${message.author.id}`;
  const last = cooldowns.get(key) ?? 0;
  if (Date.now() - last < config.xp.cooldownMs) return;
  cooldowns.set(key, Date.now());

  const gain = Math.floor(Math.random() * (config.xp.max - config.xp.min + 1)) + config.xp.min;
  const res = db.addXp(message.guild.id, message.author.id, gain);
  if (!res.leveledUp) return;

  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (member) await applyLevelRoles(member, res.level);

  const channel = settings.level_channel
    ? await message.guild.channels.fetch(settings.level_channel).catch(() => null)
    : message.channel;
  await (channel ?? message.channel)
    .send({ content: t('level.up', { user: `${message.author}`, level: res.level }), allowedMentions: { users: [message.author.id] } })
    .catch(() => {});
}

// Periyodik temizlik: eski cooldown kayıtları
setInterval(() => {
  const cutoff = Date.now() - config.xp.cooldownMs;
  for (const [k, t] of cooldowns) if (t < cutoff) cooldowns.delete(k);
}, 10 * 60_000).unref();

module.exports = { handleMessage, applyLevelRoles };
