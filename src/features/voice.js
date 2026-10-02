const {
  ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder,
} = require('discord.js');
const config = require('../config');
const db = require('../database');
const { ok, fail } = require('../utils/helpers');

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
    name: `🔊 ${member.displayName}`.slice(0, config.voice.maxNameLength),
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
  const { voice_hub: hubId } = db.getSettings(guild.id);

  // Hub'a giren kullanıcıya oda aç
  if (hubId && newState.channelId === hubId && oldState.channelId !== hubId) {
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
  if (!channel) return { error: 'Önce bir özel ses kanalına girmelisin.' };
  const tracked = db.getVoiceChannel(channel.id);
  if (!tracked) return { error: 'Bulunduğun kanal bir özel ses kanalı değil.' };
  if (needOwner && tracked.owner_id !== i.user.id) return { error: `Bu kanalın sahibi <@${tracked.owner_id}>; sadece o yönetebilir.` };
  return { channel, tracked };
}

const actions = {
  async kilitle(i) {
    const { channel, error } = context(i); if (error) return fail(error);
    await channel.permissionOverwrites.edit(i.guild.roles.everyone, { Connect: false });
    return ok('Kanal kilitlendi; yeni kimse giremez. (`/ses izin` ile birini davet edebilirsin)');
  },
  async ac(i) {
    const { channel, error } = context(i); if (error) return fail(error);
    await channel.permissionOverwrites.edit(i.guild.roles.everyone, { Connect: null });
    return ok('Kanal kilidi açıldı.');
  },
  async gizle(i) {
    const { channel, error } = context(i); if (error) return fail(error);
    await channel.permissionOverwrites.edit(i.guild.roles.everyone, { ViewChannel: false });
    return ok('Kanal gizlendi.');
  },
  async goster(i) {
    const { channel, error } = context(i); if (error) return fail(error);
    await channel.permissionOverwrites.edit(i.guild.roles.everyone, { ViewChannel: null });
    return ok('Kanal artık herkese görünür.');
  },
  async isim(i, name) {
    const { channel, error } = context(i); if (error) return fail(error);
    const clean = name.trim().slice(0, config.voice.maxNameLength);
    if (!clean) return fail('Geçersiz isim.');
    await channel.setName(clean); // Discord isim değişikliği hız limiti: 10 dk'da 2
    return ok(`Kanal adı **${clean}** oldu.`);
  },
  async limit(i, n) {
    const { channel, error } = context(i); if (error) return fail(error);
    if (!Number.isInteger(n) || n < 0 || n > 99) return fail('Limit 0 (sınırsız) ile 99 arasında olmalı.');
    await channel.setUserLimit(n);
    return ok(n ? `Kullanıcı limiti **${n}** yapıldı.` : 'Kullanıcı limiti kaldırıldı.');
  },
  async izin(i, user) {
    const { channel, error } = context(i); if (error) return fail(error);
    await channel.permissionOverwrites.edit(user.id, { ViewChannel: true, Connect: true });
    return ok(`${user} artık kanala girebilir.`);
  },
  async yasakla(i, user) {
    const { channel, error } = context(i); if (error) return fail(error);
    if (user.id === i.user.id) return fail('Kendini yasaklayamazsın.');
    if (user.bot) return fail('Botlar için kullanılamaz.');
    await channel.permissionOverwrites.edit(user.id, { ViewChannel: false, Connect: false });
    const m = channel.members.get(user.id);
    if (m) await m.voice.disconnect('Özel kanaldan yasaklandı').catch(() => {});
    return ok(`${user} bu kanaldan yasaklandı.`);
  },
  async at(i, user) {
    const { channel, error } = context(i); if (error) return fail(error);
    if (user.id === i.user.id) return fail('Kendini atamazsın.');
    const m = channel.members.get(user.id);
    if (!m) return fail('Bu kullanıcı kanalında değil.');
    await m.voice.disconnect('Özel kanaldan atıldı');
    return ok(`${user} kanaldan atıldı.`);
  },
  async devret(i, user) {
    const { channel, tracked, error } = context(i); if (error) return fail(error);
    if (user.bot || user.id === i.user.id) return fail('Geçerli bir kullanıcı seç.');
    if (!channel.members.has(user.id)) return fail('Kullanıcı kanalda olmalı.');
    await transferOwnership(channel, user.id, tracked.owner_id);
    return ok(`Kanal sahipliği ${user} kullanıcısına devredildi.`);
  },
  async devral(i) {
    const { channel, tracked, error } = context(i, { needOwner: false }); if (error) return fail(error);
    if (tracked.owner_id === i.user.id) return fail('Zaten kanalın sahibisin.');
    if (channel.members.has(tracked.owner_id)) return fail('Sahibi hâlâ kanalda; sahiplik devralınamaz.');
    await transferOwnership(channel, i.user.id, tracked.owner_id);
    return ok('Kanalın yeni sahibi sensin.');
  },
  async sil(i) {
    const { channel, error } = context(i); if (error) return fail(error);
    await deleteTracked(channel);
    return ok('Kanal silindi.');
  },
  async bilgi(i) {
    const { channel, tracked, error } = context(i, { needOwner: false }); if (error) return fail(error);
    const ow = channel.permissionOverwrites.cache.get(i.guild.id);
    const e = new EmbedBuilder().setColor(config.colors.main).setTitle(`🔊 ${channel.name}`).addFields(
      { name: 'Sahip', value: `<@${tracked.owner_id}>`, inline: true },
      { name: 'Limit', value: channel.userLimit ? String(channel.userLimit) : 'sınırsız', inline: true },
      { name: 'Üye', value: String(channel.members.size), inline: true },
      { name: 'Kilit', value: ow?.deny.has(PermissionFlagsBits.Connect) ? '🔒 kilitli' : '🔓 açık', inline: true },
      { name: 'Görünürlük', value: ow?.deny.has(PermissionFlagsBits.ViewChannel) ? '🙈 gizli' : '👁️ görünür', inline: true },
    );
    return { embeds: [e], flags: 64 };
  },
};

async function run(i, action, arg) {
  try {
    return await actions[action](i, arg);
  } catch (e) {
    console.error('[ses]', action, e.message);
    return fail(`İşlem başarısız: ${e.message}`);
  }
}

// ---------------------------------------------------------------- panel
function panelMessage() {
  const btn = (id, label, emoji, style = ButtonStyle.Secondary) =>
    new ButtonBuilder().setCustomId(`ses:${id}`).setLabel(label).setEmoji(emoji).setStyle(style);
  return {
    embeds: [new EmbedBuilder().setColor(config.colors.main).setTitle('🎙️ Özel Ses Kanalı Paneli')
      .setDescription('Hub kanalına girince sana özel bir ses kanalı açılır. Aşağıdaki butonlarla **bulunduğun** kanalı yönetebilirsin.\nKullanıcı bazlı işlemler için `/ses izin`, `/ses yasakla`, `/ses at`, `/ses devret` komutlarını kullan.')],
    components: [
      new ActionRowBuilder().addComponents(btn('kilitle', 'Kilitle', '🔒'), btn('ac', 'Kilidi Aç', '🔓'), btn('gizle', 'Gizle', '🙈'), btn('goster', 'Göster', '👁️')),
      new ActionRowBuilder().addComponents(btn('isim', 'İsim', '✏️', ButtonStyle.Primary), btn('limit', 'Limit', '👥', ButtonStyle.Primary), btn('devral', 'Devral', '👑', ButtonStyle.Success), btn('bilgi', 'Bilgi', 'ℹ️'), btn('sil', 'Sil', '🗑️', ButtonStyle.Danger)),
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
      ? modal('isim', 'Kanal Adı', 'Yeni ad', 'Örn: Habbo Sohbet', config.voice.maxNameLength)
      : modal('limit', 'Kullanıcı Limiti', 'Limit (0 = sınırsız)', '0-99', 2));
  }
  return i.reply(await run(i, action));
}

module.exports = { onVoiceStateUpdate, cleanup, run, panelMessage, handleComponent };
