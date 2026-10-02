const {
  ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder,
} = require('discord.js');
const config = require('../config');
const db = require('../database');
const { ok, fail } = require('../utils/helpers');
const { t } = require('../texts');

const createCooldown = new Map();

const OWNER_PERMS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.MoveMembers];

// ---------------------------------------------------------------- oluşturma / silme
async function createPrivateChannel(member, hub) {
  const guild = member.guild;
  const parent = hub.parent;
  const inherited = parent
    ? parent.permissionOverwrites.cache.map((o) => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny }))
    : [];
  const owned = db.getOwnedVoiceChannel(guild.id, member.id);
  if (owned) {
    const existing = guild.channels.cache.get(owned.channel_id);
    if (existing) { await member.voice.setChannel(existing).catch(() => {}); return existing; }
    db.removeVoiceChannel(owned.channel_id);
  }

  const channel = await guild.channels.create({
    name: t('voice.name', { username: member.user.username }).slice(0, config.voice.maxNameLength),
    type: ChannelType.GuildVoice,
    parent: parent?.id,
    bitrate: Math.min(hub.bitrate, guild.maximumBitrate),
    permissionOverwrites: [
      ...inherited.filter((o) => o.id !== member.id),
      { id: member.id, type: 1, allow: OWNER_PERMS },
    ],
    reason: `Özel ses kanalı: ${member.user.tag}`,
  });
  db.addVoiceChannel(channel.id, guild.id, member.id);
  const moved = await member.voice.setChannel(channel).then(() => true).catch(() => false);
  if (!moved) await deleteTracked(channel); // kullanıcı çoktan ayrılmış
  return channel;
}

async function deleteTracked(channel) {
  db.removeVoiceChannel(channel.id);
  await channel.delete('Özel ses kanalı boş').catch(() => {});
}

async function onVoiceStateUpdate(oldState, newState) {
  const guild = newState.guild;
  const member = newState.member;
  if (!member || member.user.bot) return;
  const hubId = config.voice.hubChannelId;

  // Hub'a giren kullanıcıya oda aç
  if (newState.channelId === hubId && oldState.channelId !== hubId) {
    const last = createCooldown.get(member.id) ?? 0;
    if (Date.now() - last < config.voice.createCooldownMs) {
      await member.voice.disconnect('Çok hızlı oda oluşturma').catch(() => {});
    } else {
      createCooldown.set(member.id, Date.now());
      try {
        await createPrivateChannel(member, newState.channel);
      } catch (e) {
        console.error('[ses] oda oluşturulamadı:', e.message);
        await member.voice.disconnect().catch(() => {});
      }
    }
  }

  // Ayrılınca: boşsa sil, sahip ayrıldıysa devret
  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    const tracked = db.getVoiceChannel(oldState.channelId);
    const channel = oldState.channel;
    if (!tracked || !channel) return;
    const humans = channel.members.filter((m) => !m.user.bot);
    if (humans.size === 0) return deleteTracked(channel);
    if (tracked.owner_id === member.id) await transferOwnership(channel, humans.first().id, tracked.owner_id);
  }
}

async function transferOwnership(channel, newOwnerId, oldOwnerId) {
  db.setVoiceOwner(channel.id, newOwnerId);
  await channel.permissionOverwrites.edit(newOwnerId, Object.fromEntries(OWNER_PERMS.map((p) => [permName(p), true]))).catch(() => {});
  if (oldOwnerId && oldOwnerId !== newOwnerId) await channel.permissionOverwrites.delete(oldOwnerId).catch(() => {});
}

const permName = (flag) => Object.entries(PermissionFlagsBits).find(([, v]) => v === flag)[0];

// Bot kapalıyken boşalan / silinen kanalları temizle
async function cleanup(client) {
  for (const row of db.allVoiceChannels()) {
    const guild = client.guilds.cache.get(row.guild_id);
    const ch = guild?.channels.cache.get(row.channel_id);
    if (!ch) { db.removeVoiceChannel(row.channel_id); continue; }
    if (ch.members.filter((m) => !m.user.bot).size === 0) await deleteTracked(ch);
  }
}

// ---------------------------------------------------------------- kullanıcı eylemleri
// Kullanıcının bulunduğu kendi özel kanalını ve sahiplik bilgisini döndürür.
function context(i, { needOwner = true } = {}) {
  const channel = i.member.voice?.channel;
  if (!channel) return { error: t('voice.err.nochannel') };
  const tracked = db.getVoiceChannel(channel.id);
  if (!tracked) return { error: t('voice.err.notprivate') };
  if (needOwner && tracked.owner_id !== i.user.id) return { error: t('voice.err.notowner', { owner: tracked.owner_id }) };
  return { channel, tracked };
}

const actions = {
  async kilitle(i) {
    const { channel, error } = context(i); if (error) return fail(error);
    await channel.permissionOverwrites.edit(i.guild.roles.everyone, { Connect: false });
    return ok(t('voice.locked'));
  },
  async ac(i) {
    const { channel, error } = context(i); if (error) return fail(error);
    await channel.permissionOverwrites.edit(i.guild.roles.everyone, { Connect: null });
    return ok(t('voice.unlocked'));
  },
  async gizle(i) {
    const { channel, error } = context(i); if (error) return fail(error);
    await channel.permissionOverwrites.edit(i.guild.roles.everyone, { ViewChannel: false });
    return ok(t('voice.hidden'));
  },
  async goster(i) {
    const { channel, error } = context(i); if (error) return fail(error);
    await channel.permissionOverwrites.edit(i.guild.roles.everyone, { ViewChannel: null });
    return ok(t('voice.shown'));
  },
  async isim(i, name) {
    const { channel, error } = context(i); if (error) return fail(error);
    const clean = name.trim().slice(0, config.voice.maxNameLength);
    if (!clean) return fail(t('voice.badname'));
    await channel.setName(clean); // Discord isim değişikliği hız limiti: 10 dk'da 2
    return ok(t('voice.renamed', { name: clean }));
  },
  async limit(i, n) {
    const { channel, error } = context(i); if (error) return fail(error);
    if (!Number.isInteger(n) || n < 0 || n > 99) return fail(t('voice.badlimit'));
    await channel.setUserLimit(n);
    return ok(n ? t('voice.limit_set', { limit: n }) : t('voice.limit_off'));
  },
  async izin(i, user) {
    const { channel, error } = context(i); if (error) return fail(error);
    await channel.permissionOverwrites.edit(user.id, { ViewChannel: true, Connect: true });
    return ok(t('voice.allowed', { user: `${user}` }));
  },
  async yasakla(i, user) {
    const { channel, error } = context(i); if (error) return fail(error);
    if (user.id === i.user.id) return fail(t('voice.ban_self'));
    if (user.bot) return fail(t('voice.ban_bot'));
    await channel.permissionOverwrites.edit(user.id, { ViewChannel: false, Connect: false });
    const m = channel.members.get(user.id);
    if (m) await m.voice.disconnect('Özel kanaldan yasaklandı').catch(() => {});
    return ok(t('voice.banned', { user: `${user}` }));
  },
  async at(i, user) {
    const { channel, error } = context(i); if (error) return fail(error);
    if (user.id === i.user.id) return fail(t('voice.kick_self'));
    const m = channel.members.get(user.id);
    if (!m) return fail(t('voice.kick_notin'));
    await m.voice.disconnect('Özel kanaldan atıldı');
    return ok(t('voice.kicked', { user: `${user}` }));
  },
  async devret(i, user) {
    const { channel, tracked, error } = context(i); if (error) return fail(error);
    if (user.bot || user.id === i.user.id) return fail(t('voice.transfer_invalid'));
    if (!channel.members.has(user.id)) return fail(t('voice.transfer_notin'));
    await transferOwnership(channel, user.id, tracked.owner_id);
    return ok(t('voice.transferred', { user: `${user}` }));
  },
  async devral(i) {
    const { channel, tracked, error } = context(i, { needOwner: false }); if (error) return fail(error);
    if (tracked.owner_id === i.user.id) return fail(t('voice.claim_self'));
    if (channel.members.has(tracked.owner_id)) return fail(t('voice.claim_owner_present'));
    await transferOwnership(channel, i.user.id, tracked.owner_id);
    return ok(t('voice.claimed'));
  },
  async sil(i) {
    const { channel, error } = context(i); if (error) return fail(error);
    await deleteTracked(channel);
    return ok(t('voice.deleted'));
  },
  async bilgi(i) {
    const { channel, tracked, error } = context(i, { needOwner: false }); if (error) return fail(error);
    const ow = channel.permissionOverwrites.cache.get(i.guild.id);
    const e = new EmbedBuilder().setColor(config.colors.main).setTitle(`🔊 ${channel.name}`).addFields(
      { name: t('voice.info.f_owner'), value: `<@${tracked.owner_id}>`, inline: true },
      { name: t('voice.info.f_limit'), value: channel.userLimit ? String(channel.userLimit) : t('voice.info.unlimited'), inline: true },
      { name: t('voice.info.f_members'), value: String(channel.members.size), inline: true },
      { name: t('voice.info.f_lock'), value: ow?.deny.has(PermissionFlagsBits.Connect) ? t('voice.info.locked') : t('voice.info.open'), inline: true },
      { name: t('voice.info.f_visibility'), value: ow?.deny.has(PermissionFlagsBits.ViewChannel) ? t('voice.info.hidden') : t('voice.info.visible'), inline: true },
    );
    return { embeds: [e], flags: 64 };
  },
};

async function run(i, action, arg) {
  try {
    return await actions[action](i, arg);
  } catch (e) {
    console.error('[ses]', action, e.message);
    return fail(t('voice.failed', { error: e.message }));
  }
}

// ---------------------------------------------------------------- panel
function panelMessage() {
  const btn = (id, key, style = ButtonStyle.Secondary) =>
    new ButtonBuilder().setCustomId(`ses:${id}`).setLabel(t(`voice.btn.${key}`)).setStyle(style);
  return {
    embeds: [new EmbedBuilder().setColor(config.colors.main).setTitle(t('voice.panel.title')).setDescription(t('voice.panel.desc'))],
    components: [
      new ActionRowBuilder().addComponents(btn('kilitle', 'lock'), btn('ac', 'unlock'), btn('gizle', 'hide'), btn('goster', 'show')),
      new ActionRowBuilder().addComponents(btn('isim', 'name', ButtonStyle.Primary), btn('limit', 'limit', ButtonStyle.Primary), btn('devral', 'claim', ButtonStyle.Success), btn('bilgi', 'info'), btn('sil', 'delete', ButtonStyle.Danger)),
    ],
  };
}

const modal = (id, title, label, placeholder, maxLength) => new ModalBuilder().setCustomId(`ses:modal:${id}`).setTitle(title)
  .addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('deger').setLabel(label).setPlaceholder(placeholder).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(maxLength)));

async function handleComponent(i) {
  const parts = i.customId.split(':'); // ses:<action> | ses:modal:<action>
  if (i.isModalSubmit()) {
    const value = i.fields.getTextInputValue('deger');
    return i.reply(await run(i, parts[2], parts[2] === 'limit' ? Number(value) : value));
  }
  const action = parts[1];
  if (action === 'isim' || action === 'limit') {
    const { error } = context(i);
    if (error) return i.reply(fail(error));
    return i.showModal(action === 'isim'
      ? modal('isim', t('voice.modal.name_title'), t('voice.modal.name_label'), t('voice.modal.name_ph'), config.voice.maxNameLength)
      : modal('limit', t('voice.modal.limit_title'), t('voice.modal.limit_label'), t('voice.modal.limit_ph'), 2));
  }
  return i.reply(await run(i, action));
}

module.exports = { onVoiceStateUpdate, cleanup, run, panelMessage, handleComponent };
