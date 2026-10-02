const { SlashCommandBuilder, InteractionContextType, ChannelType, PermissionFlagsBits } = require('discord.js');
const db = require('../database');
const voice = require('../features/voice');
const { ok, fail } = require('../utils/helpers');

const userOpt = (o) => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ses')
    .setDescription('Özel ses kanalını yönet')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('kur').setDescription('[Yönetici] "Oda Oluştur" hub kanalını kurar'))
    .addSubcommand((s) => s.setName('panel').setDescription('[Yönetici] Kontrol panelini bu kanala gönderir'))
    .addSubcommand((s) => s.setName('kilitle').setDescription('Kanalı kilitler'))
    .addSubcommand((s) => s.setName('ac').setDescription('Kanal kilidini açar'))
    .addSubcommand((s) => s.setName('gizle').setDescription('Kanalı herkesten gizler'))
    .addSubcommand((s) => s.setName('goster').setDescription('Kanalı herkese gösterir'))
    .addSubcommand((s) => s.setName('isim').setDescription('Kanal adını değiştirir')
      .addStringOption((o) => o.setName('ad').setDescription('Yeni ad').setRequired(true).setMaxLength(100)))
    .addSubcommand((s) => s.setName('limit').setDescription('Kullanıcı limitini ayarlar')
      .addIntegerOption((o) => o.setName('sayi').setDescription('0 = sınırsız').setRequired(true).setMinValue(0).setMaxValue(99)))
    .addSubcommand((s) => s.setName('izin').setDescription('Kullanıcıya giriş izni verir').addUserOption(userOpt))
    .addSubcommand((s) => s.setName('yasakla').setDescription('Kullanıcıyı kanaldan yasaklar').addUserOption(userOpt))
    .addSubcommand((s) => s.setName('at').setDescription('Kullanıcıyı kanaldan atar').addUserOption(userOpt))
    .addSubcommand((s) => s.setName('devret').setDescription('Kanal sahipliğini devreder').addUserOption(userOpt))
    .addSubcommand((s) => s.setName('devral').setDescription('Sahibi ayrılmış kanalı devralır'))
    .addSubcommand((s) => s.setName('bilgi').setDescription('Kanal bilgisi'))
    .addSubcommand((s) => s.setName('sil').setDescription('Kanalı siler')),

  async execute(i) {
    const sub = i.options.getSubcommand();

    if (sub === 'kur' || sub === 'panel') {
      if (!i.memberPermissions.has(PermissionFlagsBits.ManageChannels)) return i.reply(fail('Bunun için **Kanalları Yönet** yetkisi gerekir.'));
      if (sub === 'panel') return i.reply(voice.panelMessage());

      const me = i.guild.members.me;
      if (!me.permissions.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers])) {
        return i.reply(fail('Bana **Kanalları Yönet** ve **Üyeleri Taşı** yetkilerini ver.'));
      }
      await i.deferReply({ flags: 64 });
      const category = await i.guild.channels.create({ name: '🎙️ Özel Odalar', type: ChannelType.GuildCategory });
      const hub = await i.guild.channels.create({ name: '➕ Oda Oluştur', type: ChannelType.GuildVoice, parent: category.id });
      db.setSetting(i.guildId, 'voice_hub', hub.id);
      return i.editReply(ok(`Hub kanalı ${hub} oluşturuldu. Üyeler girince kendi özel odaları açılır. Kontrol paneli için bir metin kanalında \`/ses panel\` kullan.`));
    }

    const user = i.options.getUser('kullanici');
    const arg = { isim: i.options.getString('ad'), limit: i.options.getInteger('sayi') }[sub] ?? user;
    return i.reply(await voice.run(i, sub, arg));
  },
};
