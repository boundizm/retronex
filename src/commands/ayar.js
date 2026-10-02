const {
  SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType, EmbedBuilder,
} = require('discord.js');
const config = require('../config');
const db = require('../database');
const { t } = require('../texts');
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

    const channelMap = { 'mod-log': ['modlog_channel', 'modlog'], 'rapor-kanali': ['report_channel', 'report'], 'itiraz-kanali': ['appeal_channel', 'appeal'] };
    if (channelMap[sub]) {
      const ch = i.options.getChannel('kanal', true);
      const me = ch.permissionsFor(i.guild.members.me);
      if (!me?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) return i.reply(fail(t('settings.channel_perm', { channel: `${ch}` })));
      set(channelMap[sub][0], ch.id);
      return i.reply(ok(t('settings.channel_set', { label: t(`settings.label.${channelMap[sub][1]}`), channel: `${ch}` })));
    }

    if (sub === 'seviye-kanali') {
      const ch = i.options.getChannel('kanal');
      set('level_channel', ch?.id ?? null);
      return i.reply(ok(ch ? t('settings.level_channel_set', { channel: `${ch}` }) : t('settings.level_channel_unset')));
    }

    if (sub === 'yetkili-rol') {
      const role = i.options.getRole('rol');
      set('staff_role', role?.id ?? null);
      return i.reply(ok(role ? t('settings.staff_set', { role: `${role}` }) : t('settings.staff_unset')));
    }

    if (sub === 'ceza-esigi') {
      const n = i.options.getInteger('uyari-sayisi', true);
      const min = i.options.getInteger('sure-dk');
      set('warn_threshold', n);
      if (min) set('warn_timeout_min', min);
      const cur = db.getSettings(i.guildId);
      return i.reply(ok(n ? t('settings.threshold_on', { count: n, minutes: cur.warn_timeout_min }) : t('settings.threshold_off')));
    }

    // goster
    const s = db.getSettings(i.guildId);
    const ch = (id) => (id ? `<#${id}>` : `\`${t('settings.unset')}\``);
    const e = new EmbedBuilder().setColor(config.colors.main).setTitle(t('settings.show.title')).addFields(
      { name: t('settings.show.f_modlog'), value: ch(s.modlog_channel), inline: true },
      { name: t('settings.show.f_report'), value: ch(s.report_channel), inline: true },
      { name: t('settings.show.f_appeal'), value: ch(s.appeal_channel), inline: true },
      { name: t('settings.show.f_level'), value: s.level_channel ? ch(s.level_channel) : `\`${t('settings.msgchannel')}\``, inline: true },
      { name: t('settings.show.f_staff'), value: s.staff_role ? `<@&${s.staff_role}>` : `\`${t('settings.none')}\``, inline: true },
      { name: t('settings.show.f_levelsys'), value: s.level_enabled ? t('settings.on') : t('settings.off'), inline: true },
      { name: t('settings.show.f_threshold'), value: s.warn_threshold ? t('automod.status.threshold', { count: s.warn_threshold, minutes: s.warn_timeout_min }) : t('settings.off'), inline: true },
      { name: t('settings.show.f_voice'), value: ch(config.voice.hubChannelId), inline: true },
      { name: t('settings.show.f_ticketcat'), value: `\`${config.tickets.categoryId}\``, inline: true },
    );
    return i.reply({ embeds: [e], flags: ephemeral, allowedMentions: { parse: [] } });
  },
};
