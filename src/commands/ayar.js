const {
  SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType, EmbedBuilder,
} = require('discord.js');
const config = require('../config');
const db = require('../database');
const { ok, fail, ephemeral } = require('../utils/helpers');

const textChannel = (o, name, desc) =>
  o.setName(name).setDescription(desc).setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ayar')
    .setDescription('Bot ayarları')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('mod-log').setDescription('Moderasyon kayıt kanalı')
      .addChannelOption((o) => textChannel(o, 'kanal', 'Log kanalı')))
    .addSubcommand((s) => s.setName('rapor-kanali').setDescription('Raporların gideceği kanal')
      .addChannelOption((o) => textChannel(o, 'kanal', 'Rapor kanalı')))
    .addSubcommand((s) => s.setName('itiraz-kanali').setDescription('İtirazların gideceği kanal')
      .addChannelOption((o) => textChannel(o, 'kanal', 'İtiraz kanalı')))
    .addSubcommand((s) => s.setName('seviye-kanali').setDescription('Seviye atlama duyuru kanalı (boş = mesajın yazıldığı kanal)')
      .addChannelOption((o) => o.setName('kanal').setDescription('Kanal').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((s) => s.setName('yetkili-rol').setDescription('Rapor/itiraz geldiğinde etiketlenecek rol')
      .addRoleOption((o) => o.setName('rol').setDescription('Rol (boş = etiketleme yok)')))
    .addSubcommand((s) => s.setName('ceza-esigi').setDescription('Aktif uyarı eşiği ve otomatik susturma süresi')
      .addIntegerOption((o) => o.setName('uyari-sayisi').setDescription('0 = kapalı').setRequired(true).setMinValue(0).setMaxValue(20))
      .addIntegerOption((o) => o.setName('sure-dk').setDescription('Susturma süresi (dakika)').setMinValue(1).setMaxValue(40320)))
    .addSubcommand((s) => s.setName('goster').setDescription('Mevcut ayarları gösterir')),

  async execute(i) {
    const sub = i.options.getSubcommand();
    const set = (key, value) => db.setSetting(i.guildId, key, value);

    const channelMap = { 'mod-log': ['modlog_channel', 'Mod-log'], 'rapor-kanali': ['report_channel', 'Rapor'], 'itiraz-kanali': ['appeal_channel', 'İtiraz'] };
    if (channelMap[sub]) {
      const ch = i.options.getChannel('kanal', true);
      const me = ch.permissionsFor(i.guild.members.me);
      if (!me?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) return i.reply(fail(`${ch} kanalında mesaj/embed gönderme iznim yok.`));
      set(channelMap[sub][0], ch.id);
      return i.reply(ok(`${channelMap[sub][1]} kanalı ${ch} olarak ayarlandı.`));
    }

    if (sub === 'seviye-kanali') {
      const ch = i.options.getChannel('kanal');
      set('level_channel', ch?.id ?? null);
      return i.reply(ok(ch ? `Seviye duyuruları ${ch} kanalına gidecek.` : 'Seviye duyuruları mesajın yazıldığı kanalda yapılacak.'));
    }

    if (sub === 'yetkili-rol') {
      const role = i.options.getRole('rol');
      set('staff_role', role?.id ?? null);
      return i.reply(ok(role ? `Yetkili rolü ${role} olarak ayarlandı.` : 'Yetkili rolü kaldırıldı.'));
    }

    if (sub === 'ceza-esigi') {
      const n = i.options.getInteger('uyari-sayisi', true);
      const min = i.options.getInteger('sure-dk');
      set('warn_threshold', n);
      if (min) set('warn_timeout_min', min);
      const cur = db.getSettings(i.guildId);
      return i.reply(ok(n ? `**${n}** aktif uyarıda **${cur.warn_timeout_min} dk** otomatik susturma uygulanacak.` : 'Otomatik uyarı cezası kapatıldı.'));
    }

    // goster
    const s = db.getSettings(i.guildId);
    const ch = (id) => (id ? `<#${id}>` : '`ayarlanmamış`');
    const e = new EmbedBuilder().setColor(config.colors.main).setTitle('⚙️ Retronex Ayarları').addFields(
      { name: 'Mod-log', value: ch(s.modlog_channel), inline: true },
      { name: 'Rapor', value: ch(s.report_channel), inline: true },
      { name: 'İtiraz', value: ch(s.appeal_channel), inline: true },
      { name: 'Seviye duyuru', value: s.level_channel ? ch(s.level_channel) : '`mesaj kanalı`', inline: true },
      { name: 'Yetkili rolü', value: s.staff_role ? `<@&${s.staff_role}>` : '`yok`', inline: true },
      { name: 'Seviye sistemi', value: s.level_enabled ? 'açık' : 'kapalı', inline: true },
      { name: 'Ceza eşiği', value: s.warn_threshold ? `${s.warn_threshold} uyarı → ${s.warn_timeout_min} dk susturma` : 'kapalı', inline: true },
      { name: 'Özel ses hub', value: ch(s.voice_hub), inline: true },
    );
    return i.reply({ embeds: [e], flags: ephemeral, allowedMentions: { parse: [] } });
  },
};
