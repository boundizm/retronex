const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, EmbedBuilder } = require('discord.js');
const config = require('../config');
const db = require('../database');
const { ok, fail, ephemeral } = require('../utils/helpers');
const { applyLevelRoles } = require('../features/levels');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('seviye-ayar')
    .setDescription('Seviye sistemi ayarları')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('rol-ekle').setDescription('Bir seviyeye ulaşınca verilecek rolü ayarlar')
      .addIntegerOption((o) => o.setName('seviye').setDescription('Seviye').setRequired(true).setMinValue(1).setMaxValue(500))
      .addRoleOption((o) => o.setName('rol').setDescription('Verilecek rol').setRequired(true)))
    .addSubcommand((s) => s.setName('rol-sil').setDescription('Seviye rolünü kaldırır')
      .addIntegerOption((o) => o.setName('seviye').setDescription('Seviye').setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName('roller').setDescription('Seviye rollerini listeler'))
    .addSubcommand((s) => s.setName('durum').setDescription('Seviye sistemini açar/kapatır')
      .addBooleanOption((o) => o.setName('acik').setDescription('Açık mı?').setRequired(true)))
    .addSubcommand((s) => s.setName('xp-ver').setDescription('Kullanıcıya XP ekler/çıkarır')
      .addUserOption((o) => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
      .addIntegerOption((o) => o.setName('miktar').setDescription('Eksi değer XP düşürür').setRequired(true).setMinValue(-100000).setMaxValue(100000)))
    .addSubcommand((s) => s.setName('sifirla').setDescription('Kullanıcının seviyesini sıfırlar')
      .addUserOption((o) => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))),

  async execute(i) {
    const sub = i.options.getSubcommand();

    if (sub === 'rol-ekle') {
      const level = i.options.getInteger('seviye', true);
      const role = i.options.getRole('rol', true);
      if (role.managed || role.id === i.guildId) return i.reply(fail('Bu rol verilemez (bot/entegrasyon rolü ya da @everyone).'));
      if (!role.editable) return i.reply(fail('Bu rol benim rolümden yüksek; rolümü yukarı taşı.'));
      db.setLevelRole(i.guildId, level, role.id);
      return i.reply(ok(`**Seviye ${level}** → ${role} olarak ayarlandı.`));
    }

    if (sub === 'rol-sil') {
      const level = i.options.getInteger('seviye', true);
      return i.reply(db.removeLevelRole(i.guildId, level) ? ok(`Seviye ${level} rolü kaldırıldı.`) : fail('Bu seviyede rol yok.'));
    }

    if (sub === 'roller') {
      const roles = db.getLevelRoles(i.guildId);
      const e = new EmbedBuilder().setColor(config.colors.main).setTitle('Seviye Rolleri')
        .setDescription(roles.length ? roles.map((r) => `**Seviye ${r.level}** → <@&${r.role_id}>`).join('\n') : 'Henüz seviye rolü yok.');
      return i.reply({ embeds: [e], flags: ephemeral, allowedMentions: { parse: [] } });
    }

    if (sub === 'durum') {
      const on = i.options.getBoolean('acik', true);
      db.setSetting(i.guildId, 'level_enabled', on ? 1 : 0);
      return i.reply(ok(`Seviye sistemi ${on ? 'açıldı' : 'kapatıldı'}.`));
    }

    const user = i.options.getUser('kullanici', true);
    if (user.bot) return i.reply(fail('Botlar için kullanılamaz.'));

    if (sub === 'xp-ver') {
      const res = db.addXp(i.guildId, user.id, i.options.getInteger('miktar', true));
      const member = await i.guild.members.fetch(user.id).catch(() => null);
      if (member) await applyLevelRoles(member, res.level);
      return i.reply(ok(`${user} artık **${res.xp} XP** ve **${res.level}. seviye**.`));
    }

    if (sub === 'sifirla') {
      db.resetLevel(i.guildId, user.id);
      const member = await i.guild.members.fetch(user.id).catch(() => null);
      if (member) await applyLevelRoles(member, 0);
      return i.reply(ok(`${user} kullanıcısının seviyesi sıfırlandı.`));
    }
  },
};
