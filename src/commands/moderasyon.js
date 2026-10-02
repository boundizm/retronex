const {
  SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, EmbedBuilder, ChannelType,
} = require('discord.js');
const config = require('../config');
const db = require('../database');
const { ok, fail, ts, parseDuration, formatDuration, truncate, ephemeral } = require('../utils/helpers');
const { t } = require('../texts');
const { checkTarget, dmPunished } = require('../utils/moderation');
const { sendCaseLog, typeInfo, checkWarnEscalation, sendLog } = require('../utils/modlog');

const MAX_TIMEOUT_SEC = 28 * 86400;

const base = (name, desc, perm) =>
  new SlashCommandBuilder()
    .setName(name)
    .setDescription(desc)
    .setDefaultMemberPermissions(perm)
    .setContexts(InteractionContextType.Guild);

const reasonOpt = (o) => o.setName('sebep').setDescription('Sebep').setMaxLength(500);

// ----------------------------------------------------------------- ban
const ban = {
  data: base('ban', 'Kullanıcıyı sunucudan yasaklar', PermissionFlagsBits.BanMembers)
    .addUserOption((o) => o.setName('kullanici').setDescription('Yasaklanacak kullanıcı').setRequired(true))
    .addStringOption(reasonOpt)
    .addIntegerOption((o) => o.setName('mesaj-sil').setDescription('Kaç günlük mesajı silinsin (0-7)').setMinValue(0).setMaxValue(7)),
  async execute(i) {
    const user = i.options.getUser('kullanici', true);
    const member = i.options.getMember('kullanici');
    const reason = i.options.getString('sebep') || t('mod.noreason');
    const err = checkTarget(i, member, (m) => m.bannable);
    if (err) return i.reply(fail(err));
    if (!member && user.id === i.user.id) return i.reply(fail(t('mod.ban.self')));

    await i.deferReply({ flags: ephemeral });
    const c = db.addCase({ guildId: i.guildId, userId: user.id, modId: i.user.id, type: 'ban', reason });
    await dmPunished(user, i.guild, c);
    try {
      await i.guild.members.ban(user, { reason: `${i.user.tag}: ${reason}`, deleteMessageSeconds: (i.options.getInteger('mesaj-sil') ?? 0) * 86400 });
    } catch (e) {
      db.deleteCase(c.id);
      return i.editReply(fail(t('mod.ban.failed', { error: e.message })));
    }
    await sendCaseLog(i.guild, c);
    return i.editReply(ok(t('mod.ban.success', { user: user.tag, case: c.id })));
  },
};

const unban = {
  data: base('unban', 'Yasağı kaldırır', PermissionFlagsBits.BanMembers)
    .addStringOption((o) => o.setName('kullanici-id').setDescription('Kullanıcı ID').setRequired(true))
    .addStringOption(reasonOpt),
  async execute(i) {
    const id = i.options.getString('kullanici-id', true).trim();
    const reason = i.options.getString('sebep') || t('mod.noreason');
    try {
      await i.guild.members.unban(id, `${i.user.tag}: ${reason}`);
    } catch {
      return i.reply(fail(t('mod.unban.notfound')));
    }
    for (const c of db.getUserCases(i.guildId, id, 'ban')) db.deactivateCase(c.id);
    const c = db.addCase({ guildId: i.guildId, userId: id, modId: i.user.id, type: 'unban', reason });
    await sendCaseLog(i.guild, c);
    return i.reply(ok(t('mod.unban.success', { id })));
  },
};

// ----------------------------------------------------------------- kick
const kick = {
  data: base('at', 'Kullanıcıyı sunucudan atar', PermissionFlagsBits.KickMembers)
    .addUserOption((o) => o.setName('kullanici').setDescription('Atılacak kullanıcı').setRequired(true))
    .addStringOption(reasonOpt),
  async execute(i) {
    const user = i.options.getUser('kullanici', true);
    const member = i.options.getMember('kullanici');
    if (!member) return i.reply(fail(t('generic.notinguild')));
    const err = checkTarget(i, member, (m) => m.kickable);
    if (err) return i.reply(fail(err));
    const reason = i.options.getString('sebep') || t('mod.noreason');

    await i.deferReply({ flags: ephemeral });
    const c = db.addCase({ guildId: i.guildId, userId: user.id, modId: i.user.id, type: 'kick', reason });
    await dmPunished(user, i.guild, c);
    try {
      await member.kick(`${i.user.tag}: ${reason}`);
    } catch (e) {
      db.deleteCase(c.id);
      return i.editReply(fail(t('mod.kick.failed', { error: e.message })));
    }
    await sendCaseLog(i.guild, c);
    return i.editReply(ok(t('mod.kick.success', { user: user.tag, case: c.id })));
  },
};

// ----------------------------------------------------------------- sustur
const sustur = {
  data: base('sustur', 'Kullanıcıyı geçici olarak susturur (timeout)', PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('kullanici').setDescription('Susturulacak kullanıcı').setRequired(true))
    .addStringOption((o) => o.setName('sure').setDescription('Örn: 10m, 2h, 1d (en fazla 28 gün)').setRequired(true))
    .addStringOption(reasonOpt),
  async execute(i) {
    const user = i.options.getUser('kullanici', true);
    const member = i.options.getMember('kullanici');
    if (!member) return i.reply(fail(t('generic.notinguild')));
    const err = checkTarget(i, member, (m) => m.moderatable);
    if (err) return i.reply(fail(err));
    const sec = parseDuration(i.options.getString('sure', true));
    if (!sec || sec > MAX_TIMEOUT_SEC) return i.reply(fail(t('mod.timeout.badduration')));
    const reason = i.options.getString('sebep') || t('mod.noreason');

    await i.deferReply({ flags: ephemeral });
    try {
      await member.timeout(sec * 1000, `${i.user.tag}: ${reason}`);
    } catch (e) {
      return i.editReply(fail(t('mod.timeout.failed', { error: e.message })));
    }
    const c = db.addCase({ guildId: i.guildId, userId: user.id, modId: i.user.id, type: 'sustur', reason, durationSec: sec });
    await dmPunished(user, i.guild, c);
    await sendCaseLog(i.guild, c);
    return i.editReply(ok(t('mod.timeout.success', { user: user.tag, duration: formatDuration(sec), case: c.id })));
  },
};

const unmute = {
  data: base('susturma-kaldir', 'Kullanıcının susturmasını kaldırır', PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
    .addStringOption(reasonOpt),
  async execute(i) {
    const user = i.options.getUser('kullanici', true);
    const member = i.options.getMember('kullanici');
    if (!member?.isCommunicationDisabled()) return i.reply(fail(t('mod.untimeout.notmuted')));
    const reason = i.options.getString('sebep') || t('mod.noreason');
    try {
      await member.timeout(null, `${i.user.tag}: ${reason}`);
    } catch (e) {
      return i.reply(fail(t('mod.untimeout.failed', { error: e.message })));
    }
    for (const c of db.getUserCases(i.guildId, user.id, 'sustur')) db.deactivateCase(c.id);
    const c = db.addCase({ guildId: i.guildId, userId: user.id, modId: i.user.id, type: 'susturma_kaldir', reason });
    await sendCaseLog(i.guild, c);
    return i.reply(ok(t('mod.untimeout.success', { user: user.tag })));
  },
};

// ----------------------------------------------------------------- uyarı
const uyar = {
  data: base('uyar', 'Kullanıcıya uyarı verir', PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('kullanici').setDescription('Uyarılacak kullanıcı').setRequired(true))
    .addStringOption((o) => reasonOpt(o).setRequired(true)),
  async execute(i) {
    const user = i.options.getUser('kullanici', true);
    if (user.bot) return i.reply(fail(t('mod.warn.bot')));
    const member = i.options.getMember('kullanici');
    const err = checkTarget(i, member, () => true);
    if (err) return i.reply(fail(err));
    const reason = i.options.getString('sebep', true);

    await i.deferReply({ flags: ephemeral });
    const c = db.addCase({ guildId: i.guildId, userId: user.id, modId: i.user.id, type: 'uyari', reason });
    await dmPunished(user, i.guild, c);
    await sendCaseLog(i.guild, c);
    const esc = await checkWarnEscalation(i.guild, user.id);
    const n = db.countActiveWarns(i.guildId, user.id);
    return i.editReply(ok(t('mod.warn.success', { user: user.tag, case: c.id, count: n }) + (esc ? `\n${t('mod.warn.escalated', { case: esc.id })}` : '')));
  },
};

const uyarilar = {
  data: base('uyarilar', 'Kullanıcının uyarılarını listeler', PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true)),
  async execute(i) {
    const user = i.options.getUser('kullanici', true);
    const list = db.getUserCases(i.guildId, user.id, 'uyari');
    if (!list.length) return i.reply({ content: t('mod.warns.empty'), flags: ephemeral });
    const lines = list.slice(0, 15).map((c) =>
      t('mod.warns.line', { icon: c.active ? '🟡' : '⚪', case: c.id, date: ts(c.created_at, 'd'), reason: truncate(c.reason ?? t('mod.noreason'), 90), mod: `<@${c.mod_id}>` }));
    const e = new EmbedBuilder().setColor(config.colors.warn)
      .setTitle(t('mod.warns.title', { user: user.tag }))
      .setDescription(lines.join('\n'))
      .setFooter({ text: t('mod.warns.footer', { active: db.countActiveWarns(i.guildId, user.id), total: list.length }) });
    return i.reply({ embeds: [e], flags: ephemeral });
  },
};

const uyariSil = {
  data: base('uyari-sil', 'Bir uyarıyı geçersiz kılar', PermissionFlagsBits.ModerateMembers)
    .addIntegerOption((o) => o.setName('ceza-no').setDescription('Uyarı numarası').setRequired(true).setMinValue(1)),
  async execute(i) {
    const c = db.getCase(i.options.getInteger('ceza-no', true));
    if (!c || c.guild_id !== i.guildId || c.type !== 'uyari') return i.reply(fail(t('mod.delwarn.notfound')));
    db.deactivateCase(c.id);
    await sendLog(i.guild, { content: t('mod.delwarn.log', { case: c.id, target: c.user_id, mod: i.user.id }), allowedMentions: { parse: [] } });
    return i.reply(ok(t('mod.delwarn.success', { case: c.id })));
  },
};

const cezalar = {
  data: base('cezalar', 'Kullanıcının tüm ceza geçmişini gösterir', PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true)),
  async execute(i) {
    const user = i.options.getUser('kullanici', true);
    const list = db.getUserCases(i.guildId, user.id);
    if (!list.length) return i.reply({ content: t('mod.cases.clean'), flags: ephemeral });
    const lines = list.slice(0, 15).map((c) => {
      const ti = typeInfo(c.type);
      return t('mod.cases.line', { emoji: ti.emoji, case: c.id, type: ti.label, date: ts(c.created_at, 'd'), reason: truncate(c.reason ?? t('mod.noreason'), 70) });
    });
    const e = new EmbedBuilder().setColor(config.colors.main)
      .setTitle(t('mod.cases.title', { user: user.tag }))
      .setDescription(lines.join('\n'))
      .setFooter({ text: t('mod.cases.footer', { total: list.length }) });
    return i.reply({ embeds: [e], flags: ephemeral });
  },
};

// ----------------------------------------------------------------- kanal araçları
const temizle = {
  data: base('temizle', 'Kanaldaki mesajları siler', PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) => o.setName('miktar').setDescription('1-100').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption((o) => o.setName('kullanici').setDescription('Sadece bu kullanıcının mesajları')),
  async execute(i) {
    if (!i.channel?.isTextBased() || i.channel.isDMBased()) return i.reply(fail(t('mod.purge.unavailable')));
    await i.deferReply({ flags: ephemeral });
    const amount = i.options.getInteger('miktar', true);
    const user = i.options.getUser('kullanici');
    let msgs = await i.channel.messages.fetch({ limit: user ? 100 : amount });
    if (user) msgs = msgs.filter((m) => m.author.id === user.id).first(amount);
    try {
      const deleted = await i.channel.bulkDelete(msgs, true);
      await sendLog(i.guild, { content: t('mod.purge.log', { mod: i.user.id, channel: `${i.channel}`, count: deleted.size, target: user ? ` (${user.tag})` : '' }), allowedMentions: { parse: [] } });
      return i.editReply(ok(t('mod.purge.success', { count: deleted.size })));
    } catch (e) {
      return i.editReply(fail(t('mod.purge.failed', { error: e.message })));
    }
  },
};

const lockCmd = (name, desc, lock) => ({
  data: base(name, desc, PermissionFlagsBits.ManageChannels)
    .addChannelOption((o) => o.setName('kanal').setDescription('Varsayılan: bu kanal').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
  async execute(i) {
    const ch = i.options.getChannel('kanal') ?? i.channel;
    try {
      await ch.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: lock ? false : null }, { reason: `${i.user.tag}: ${name}` });
    } catch (e) {
      return i.reply(fail(t('generic.failed', { error: e.message })));
    }
    await sendLog(i.guild, { content: t(lock ? 'mod.lock.log' : 'mod.unlock.log', { mod: i.user.id, channel: `${ch}` }), allowedMentions: { parse: [] } });
    return i.reply(ok(t(lock ? 'mod.lock.success' : 'mod.unlock.success', { channel: `${ch}` })));
  },
});

const yavasmod = {
  data: base('yavasmod', 'Kanal yavaş modunu ayarlar', PermissionFlagsBits.ManageChannels)
    .addIntegerOption((o) => o.setName('saniye').setDescription('0 = kapat (en fazla 21600)').setRequired(true).setMinValue(0).setMaxValue(21600))
    .addChannelOption((o) => o.setName('kanal').setDescription('Varsayılan: bu kanal').addChannelTypes(ChannelType.GuildText)),
  async execute(i) {
    const ch = i.options.getChannel('kanal') ?? i.channel;
    const sec = i.options.getInteger('saniye', true);
    try {
      await ch.setRateLimitPerUser(sec, `${i.user.tag}: yavaş mod`);
    } catch (e) {
      return i.reply(fail(t('generic.failed', { error: e.message })));
    }
    return i.reply(ok(sec ? t('mod.slow.on', { channel: `${ch}`, seconds: sec }) : t('mod.slow.off', { channel: `${ch}` })));
  },
};

module.exports = [ban, unban, kick, sustur, unmute, uyar, uyarilar, uyariSil, cezalar, temizle,
  lockCmd('kilitle', 'Kanalı herkese yazmaya kapatır', true),
  lockCmd('kilit-ac', 'Kanal kilidini kaldırır', false),
  yavasmod];
