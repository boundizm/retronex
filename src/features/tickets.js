const {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
  ChannelType, PermissionFlagsBits,
} = require('discord.js');
const config = require('../config');
const db = require('../database');
const { fail, ok } = require('../utils/helpers');

const CATEGORIES = {
  genel: {
    emoji: '📩', label: 'Genel Destek & Öneri', channelPrefix: 'destek',
    description: 'Topluluk, roller veya genel sorular ve önerileriniz için',
  },
  sikayet: {
    emoji: '⚠️', label: 'Şikayet & Kural İhlali', channelPrefix: 'sikayet',
    description: 'Kural ihlalleri, kullanıcı şikayetleri veya dolandırıcılık (scam) bildirimleri',
  },
  isbirligi: {
    emoji: '📢', label: 'İş Birliği & Tanıtım', channelPrefix: 'isbirligi',
    description: 'Otel tanıtımları, sunucu ortaklıkları ve reklam talepleri',
  },
};

const PANEL_TITLE = '🎫 RetroNEX Destek Merkezi';

function panelMessage() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket:select')
    .setPlaceholder('Bir kategori seçin...')
    .addOptions(Object.entries(CATEGORIES).map(([value, c]) => ({
      value, label: c.label, description: c.description, emoji: c.emoji,
    })));
  return {
    embeds: [new EmbedBuilder()
      .setColor(config.tickets.color)
      .setTitle(PANEL_TITLE)
      .setDescription('Aşağıdaki menüden ilgili konuyu seçerek biletini oluşturabilirsin. Talebini ve detayları açılan özel kanalda paylaşırsan sana çok daha hızlı yardımcı olabiliriz.')],
    components: [new ActionRowBuilder().addComponents(menu)],
  };
}

// Açılışta paneli garanti eder: varsa günceller, yoksa gönderir.
async function ensurePanel(client) {
  const channel = await client.channels.fetch(config.tickets.panelChannelId).catch(() => null);
  if (!channel?.isTextBased()) {
    console.error(`[bilet] panel kanalı bulunamadı: ${config.tickets.panelChannelId}`);
    return;
  }
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const existing = recent?.find((m) => m.author.id === client.user.id && m.embeds[0]?.title === PANEL_TITLE);
  if (existing) await existing.edit(panelMessage());
  else await channel.send(panelMessage());
}

const closeRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('ticket:kapat').setLabel('Bileti Kapat').setEmoji('🔒').setStyle(ButtonStyle.Danger));

function isStaff(i) {
  const s = db.getSettings(i.guildId);
  return i.memberPermissions.has(PermissionFlagsBits.ManageChannels)
    || i.memberPermissions.has(PermissionFlagsBits.ModerateMembers)
    || (s.staff_role && i.member.roles.cache.has(s.staff_role));
}

async function handleSelect(i) {
  const key = i.values[0];
  const cat = CATEGORIES[key];
  // Seçili kalmasın diye paneli sıfırla
  await i.message.edit(panelMessage()).catch(() => {});
  if (!cat) return i.reply(fail('Geçersiz kategori.'));

  // Kullanıcı başına tek açık bilet
  for (const t of db.getUserTickets(i.guildId, i.user.id)) {
    if (i.guild.channels.cache.has(t.channel_id)) {
      return i.reply(fail(`Zaten açık bir biletin var: <#${t.channel_id}>`));
    }
    db.removeTicket(t.channel_id); // kanal elle silinmiş
  }

  const category = await i.guild.channels.fetch(config.tickets.categoryId).catch(() => null);
  if (category?.type !== ChannelType.GuildCategory) {
    console.error('[bilet] kategori bulunamadı:', config.tickets.categoryId);
    return i.reply(fail('Bilet kategorisi bulunamadı, lütfen bir yetkiliye haber ver.'));
  }

  await i.deferReply({ flags: 64 });
  const staffRole = db.getSettings(i.guildId).staff_role;
  const allow = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];
  const overwrites = [
    ...category.permissionOverwrites.cache.map((o) => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny })),
  ].filter((o) => o.id !== i.guild.id && o.id !== i.user.id && o.id !== staffRole && o.id !== i.client.user.id);
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
      name: `${cat.channelPrefix}-${slug}`.slice(0, 100),
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `${cat.emoji} ${cat.label} | Bilet sahibi: ${i.user.tag} (${i.user.id})`,
      permissionOverwrites: overwrites,
      reason: `Bilet: ${cat.label} (${i.user.tag})`,
    });
  } catch (e) {
    console.error('[bilet] kanal oluşturulamadı:', e.message);
    return i.editReply(fail(`Bilet oluşturulamadı: ${e.message}`));
  }
  db.addTicket(channel.id, i.guildId, i.user.id, key);

  await channel.send({
    content: `${i.user}${staffRole ? ` <@&${staffRole}>` : ''}`,
    allowedMentions: { users: [i.user.id], roles: staffRole ? [staffRole] : [] },
    embeds: [new EmbedBuilder().setColor(config.tickets.color)
      .setTitle(`${cat.emoji} ${cat.label}`)
      .setDescription('Hoş geldin! Lütfen talebini ve tüm detayları buraya yaz; yetkililer en kısa sürede dönüş yapacak.\nİşin bittiğinde aşağıdaki butonla bileti kapatabilirsin.')],
    components: [closeRow()],
  });
  return i.editReply(ok(`Biletin oluşturuldu: ${channel}`));
}

async function handleButton(i) {
  const t = db.getTicket(i.channelId);
  if (!t) return i.reply(fail('Bu kanal kayıtlı bir bilet değil.'));
  if (t.user_id !== i.user.id && !isStaff(i)) return i.reply(fail('Bu bileti sadece sahibi ya da yetkililer kapatabilir.'));
  await i.reply({ content: `🔒 Bilet ${i.user} tarafından kapatıldı. Kanal 5 saniye içinde silinecek.`, allowedMentions: { parse: [] } });
  db.removeTicket(i.channelId);
  setTimeout(() => i.channel.delete(`Bilet kapatıldı (${i.user.tag})`).catch(() => {}), 5000);
}

module.exports = { ensurePanel, handleSelect, handleButton };
