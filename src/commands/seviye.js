const { SlashCommandBuilder, EmbedBuilder, InteractionContextType } = require('discord.js');
const config = require('../config');
const db = require('../database');
const { t } = require('../texts');
const { progressBar, ephemeral } = require('../utils/helpers');

const seviye = {
  data: new SlashCommandBuilder()
    .setName('seviye')
    .setDescription('Seviye ve XP durumunu gösterir')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) => o.setName('kullanici').setDescription('Başka bir kullanıcı')),
  async execute(i) {
    const user = i.options.getUser('kullanici') ?? i.user;
    if (user.bot) return i.reply({ content: t('level.bot'), flags: ephemeral });
    const row = db.getLevel(i.guildId, user.id);
    if (!row) return i.reply({ content: t('level.noxp', { user: user.username }), flags: ephemeral });

    const { level, current, needed } = db.levelFromXp(row.xp);
    const e = new EmbedBuilder()
      .setColor(config.colors.main)
      .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: t('level.field.level'), value: `**${level}**`, inline: true },
        { name: t('level.field.rank'), value: `**#${db.getRank(i.guildId, row.xp)}**`, inline: true },
        { name: t('level.field.messages'), value: `${row.messages}`, inline: true },
        { name: t('level.field.next', { current, needed }), value: `\`${progressBar(current, needed)}\` %${Math.floor((current / needed) * 100)}` },
      )
      .setFooter({ text: t('level.footer', { xp: row.xp }) });
    return i.reply({ embeds: [e] });
  },
};

const PAGE = 10;
const siralama = {
  data: new SlashCommandBuilder()
    .setName('siralama')
    .setDescription('Sunucu seviye sıralaması')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((o) => o.setName('sayfa').setDescription('Sayfa numarası').setMinValue(1)),
  async execute(i) {
    const total = db.countLevelUsers(i.guildId);
    const pages = Math.max(1, Math.ceil(total / PAGE));
    const page = Math.min(i.options.getInteger('sayfa') ?? 1, pages);
    const rows = db.getLeaderboard(i.guildId, PAGE, (page - 1) * PAGE);
    if (!rows.length) return i.reply({ content: t('level.board.empty'), flags: ephemeral });
    const medals = ['🥇', '🥈', '🥉'];
    const lines = rows.map((r, idx) => {
      const pos = (page - 1) * PAGE + idx;
      return t('level.board.line', { pos: medals[pos] ?? `**${pos + 1}.**`, id: r.user_id, level: r.level, xp: r.xp });
    });
    const e = new EmbedBuilder().setColor(config.colors.main)
      .setTitle(t('level.board.title', { guild: i.guild.name }))
      .setDescription(lines.join('\n'))
      .setFooter({ text: t('level.board.footer', { page, pages }) });
    return i.reply({ embeds: [e], allowedMentions: { parse: [] } });
  },
};

module.exports = [seviye, siralama];
