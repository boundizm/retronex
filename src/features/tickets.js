const {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
  ChannelType, PermissionFlagsBits,
} = require('discord.js');
const config = require('../config');
const db = require('../database');
const { fail, ok } = require('../utils/helpers');
const { t } = require('../texts');

// Kategori anahtarları sabit; adları/açıklamaları panelden düzenlenir (ticket.cat.<anahtar>.label|desc).
const CATEGORIES = { genel: 'destek', sikayet: 'sikayet', isbirligi: 'isbirligi' };

function panelMessage() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket:select')
    .setPlaceholder(t('ticket.panel.placeholder'))
    .addOptions(Object.keys(CATEGORIES).map((value) => ({
      value, label: t(`ticket.cat.${value}.label`), description: t(`ticket.cat.${value}.desc`),
    })));
  return {
    embeds: [new EmbedBuilder()
      .setColor(config.colors.ticket)
      .setTitle(t('ticket.panel.title'))
      .setDescription(t('ticket.panel.desc'))],
    components: [new ActionRowBuilder().addComponents(menu)],
  };
}

// Paneli garanti eder: varsa günceller, yoksa gönderir. (Başlık değişebildiği için menüden tanınır.)
async function ensurePanel(client) {
  const channel = await client.channels.fetch(config.tickets.panelChannelId).catch(() => null);
  if (!channel?.isTextBased()) throw new Error(`Panel kanalı bulunamadı: ${config.tickets.panelChannelId}`);
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const existing = recent?.find((m) => m.author.id === client.user.id
    && m.components.some((row) => row.components.some((c) => c.customId === 'ticket:select')));
  if (existing) { await existing.edit(panelMessage()); return 'updated'; }
  await channel.send(panelMessage());
  return 'sent';
}

const closeRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('ticket:kapat').setLabel(t('ticket.btn.close')).setStyle(ButtonStyle.Danger));

function isStaff(i) {
  const s = db.getSettings(i.guildId);
  return i.memberPermissions.has(PermissionFlagsBits.ManageChannels)
    || i.memberPermissions.has(PermissionFlagsBits.ModerateMembers)
    || (s.staff_role && i.member.roles.cache.has(s.staff_role));
}

async function handleSelect(i) {
  const key = i.values[0];
  // Seçili kalmasın diye paneli sıfırla
  await i.message.edit(panelMessage()).catch(() => {});
  if (!CATEGORIES[key]) return i.reply(fail(t('ticket.invalid')));
  const catLabel = t(`ticket.cat.${key}.label`);

  // Kullanıcı başına tek açık bilet
  for (const tk of db.getUserTickets(i.guildId, i.user.id)) {
    if (i.guild.channels.cache.has(tk.channel_id)) {
      return i.reply(fail(t('ticket.exists', { channel: tk.channel_id })));
    }
    db.removeTicket(tk.channel_id); // kanal elle silinmiş
  }

  const category = await i.guild.channels.fetch(config.tickets.categoryId).catch(() => null);
  if (category?.type !== ChannelType.GuildCategory) {
    console.error('[bilet] kategori bulunamadı:', config.tickets.categoryId);
    return i.reply(fail(t('ticket.nocategory')));
  }

  await i.deferReply({ flags: 64 });
  const staffRole = db.getSettings(i.guildId).staff_role;
  const allow = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];
  const overwrites = category.permissionOverwrites.cache
    .map((o) => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny }))
    .filter((o) => o.id !== i.guild.id && o.id !== i.user.id && o.id !== staffRole && o.id !== i.client.user.id);
  overwrites.push(
    { id: i.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: i.user.id, allow },
    { id: i.client.user.id, allow: [...allow, PermissionFlagsBits.ManageChannels] },
  );
  if (staffRole) overwrites.push({ id: staffRole, allow });

  let channel;
  try {
    const slug = i.user.username.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'uye';
    channel = await i.guild.channels.create({
      name: `${CATEGORIES[key]}-${slug}`.slice(0, 100),
      type: ChannelType.GuildText,
      parent: category.id,
      topic: t('ticket.topic', { category: catLabel, tag: i.user.tag, id: i.user.id }),
      permissionOverwrites: overwrites,
      reason: `Bilet: ${catLabel} (${i.user.tag})`,
    });
  } catch (e) {
    console.error('[bilet] kanal oluşturulamadı:', e.message);
    return i.editReply(fail(t('ticket.failed', { error: e.message })));
  }
  db.addTicket(channel.id, i.guildId, i.user.id, key);

  await channel.send({
    content: `${i.user}${staffRole ? ` <@&${staffRole}>` : ''}`,
    allowedMentions: { users: [i.user.id], roles: staffRole ? [staffRole] : [] },
    embeds: [new EmbedBuilder().setColor(config.colors.ticket)
      .setTitle(t('ticket.welcome.title', { category: catLabel }))
      .setDescription(t('ticket.welcome.desc'))],
    components: [closeRow()],
  });
  return i.editReply(ok(t('ticket.created', { channel: `${channel}` })));
}

async function handleButton(i) {
  const tk = db.getTicket(i.channelId);
  if (!tk) return i.reply(fail(t('ticket.notticket')));
  if (tk.user_id !== i.user.id && !isStaff(i)) return i.reply(fail(t('ticket.noperm')));
  await i.reply({ content: t('ticket.closed', { user: `${i.user}` }), allowedMentions: { parse: [] } });
  db.removeTicket(i.channelId);
  setTimeout(() => i.channel.delete(`Bilet kapatıldı (${i.user.tag})`).catch(() => {}), 5000);
}

module.exports = { ensurePanel, handleSelect, handleButton };
