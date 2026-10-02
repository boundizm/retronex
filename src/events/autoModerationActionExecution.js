const { Events, AutoModerationActionType } = require('discord.js');
const db = require('../database');
const { t } = require('../texts');
const { sendCaseLog, checkWarnEscalation } = require('../utils/modlog');
const { dmPunished } = require('../utils/moderation');

const recent = new Map(); // `${guild}:${user}` -> ts, aynı spam dalgasında tekrar tekrar uyarı yazmamak için
const WARN_COOLDOWN_MS = 15_000;

module.exports = {
  name: Events.AutoModerationActionExecution,
  async execute(execution) {
    // Her eylem için ayrı olay gelir; sadece mesaj engelleme eylemini say.
    if (execution.action.type !== AutoModerationActionType.BlockMessage) return;
    const { guild, userId } = execution;
    const user = await guild.client.users.fetch(userId).catch(() => null);
    if (!user || user.bot) return;

    const key = `${guild.id}:${userId}`;
    if (Date.now() - (recent.get(key) ?? 0) < WARN_COOLDOWN_MS) return;
    recent.set(key, Date.now());

    const c = db.addCase({
      guildId: guild.id, userId, modId: 'otomod', type: 'uyari',
      reason: t('automod.reason', { rule: execution.ruleName, keyword: execution.matchedKeyword ? ` (“${execution.matchedKeyword}”)` : '' }),
    });
    await dmPunished(user, guild, c, t('automod.dm_extra'));
    await sendCaseLog(guild, c);
    await checkWarnEscalation(guild, userId);
  },
};

setInterval(() => {
  const cutoff = Date.now() - WARN_COOLDOWN_MS;
  for (const [k, t] of recent) if (t < cutoff) recent.delete(k);
}, 60_000).unref();
