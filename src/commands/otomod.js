const {
  SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, EmbedBuilder,
  AutoModerationRuleEventType, AutoModerationRuleTriggerType, AutoModerationActionType,
  AutoModerationRuleKeywordPresetType, GuildVerificationLevel, GuildExplicitContentFilter,
} = require('discord.js');
const config = require('../config');
const db = require('../database');
const { ok, fail, ephemeral } = require('../utils/helpers');

const PREFIX = 'Retronex: ';
const WORDS_RULE = `${PREFIX}Yasaklı Kelimeler`;
const BLOCK_MSG = 'Mesajın sunucu kurallarına aykırı olduğu için otomatik olarak engellendi.';

const VERIFICATION = {
  [GuildVerificationLevel.None]: 'Yok',
  [GuildVerificationLevel.Low]: 'Düşük (doğrulanmış e-posta)',
  [GuildVerificationLevel.Medium]: 'Orta (5 dk+ hesap)',
  [GuildVerificationLevel.High]: 'Yüksek (10 dk+ üye)',
  [GuildVerificationLevel.VeryHigh]: 'Çok yüksek (doğrulanmış telefon)',
};
const CONTENT_FILTER = {
  [GuildExplicitContentFilter.Disabled]: 'Kapalı',
  [GuildExplicitContentFilter.MembersWithoutRoles]: 'Rolü olmayan üyeler',
  [GuildExplicitContentFilter.AllMembers]: 'Tüm üyeler',
};

// Her kural için temel eylemler: mesajı engelle + (varsa) mod-log'a uyarı gönder
function baseActions(settings) {
  const actions = [{ type: AutoModerationActionType.BlockMessage, metadata: { customMessage: BLOCK_MSG } }];
  if (settings.modlog_channel) {
    actions.push({ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: settings.modlog_channel } });
  }
  return actions;
}

function ruleDefinitions(settings) {
  const actions = baseActions(settings);
  return [
    {
      name: `${PREFIX}Küfür ve Hakaret`,
      triggerType: AutoModerationRuleTriggerType.KeywordPreset,
      triggerMetadata: {
        presets: [
          AutoModerationRuleKeywordPresetType.Profanity,
          AutoModerationRuleKeywordPresetType.SexualContent,
          AutoModerationRuleKeywordPresetType.Slurs,
        ],
      },
      actions,
    },
    { name: `${PREFIX}Spam`, triggerType: AutoModerationRuleTriggerType.Spam, actions },
    {
      name: `${PREFIX}Toplu Etiket`,
      triggerType: AutoModerationRuleTriggerType.MentionSpam,
      triggerMetadata: { mentionTotalLimit: 5 },
      actions: [...actions, { type: AutoModerationActionType.Timeout, metadata: { durationSeconds: 300 } }],
    },
    {
      name: `${PREFIX}Davet Linki`,
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: { regexPatterns: ['discord(?:app)?\\.com/invite/\\S+', 'discord\\.gg/\\S+'] },
      actions,
    },
  ];
}

const getWordsRule = async (guild) => {
  const rules = await guild.autoModerationRules.fetch();
  return rules.find((r) => r.name === WORDS_RULE) ?? null;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('otomod')
    .setDescription('Discord\'un yerleşik AutoMod sistemini yönet')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('kur').setDescription('Hazır AutoMod kurallarını oluşturur (küfür, spam, toplu etiket, davet linki)'))
    .addSubcommand((s) => s.setName('durum').setDescription('AutoMod ve sunucu güvenlik ayarlarını gösterir'))
    .addSubcommand((s) => s.setName('kelime-ekle').setDescription('Yasaklı kelime ekler')
      .addStringOption((o) => o.setName('kelimeler').setDescription('Virgülle ayır. Joker: *kelime* (içinde geçen), kelime* (ile başlayan)').setRequired(true)))
    .addSubcommand((s) => s.setName('kelime-sil').setDescription('Yasaklı kelime siler')
      .addStringOption((o) => o.setName('kelimeler').setDescription('Virgülle ayır').setRequired(true)))
    .addSubcommand((s) => s.setName('kelime-liste').setDescription('Yasaklı kelimeleri listeler'))
    .addSubcommand((s) => s.setName('kapat').setDescription('Retronex tarafından oluşturulan tüm AutoMod kurallarını siler')),

  async execute(i) {
    const sub = i.options.getSubcommand();
    const guild = i.guild;
    if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return i.reply(fail('AutoMod kurallarını yönetmek için bana **Sunucuyu Yönet** yetkisi vermelisin.'));
    }
    await i.deferReply({ flags: ephemeral });
    const settings = db.getSettings(i.guildId);

    if (sub === 'kur') {
      const existing = await guild.autoModerationRules.fetch();
      const exempt = settings.staff_role ? [settings.staff_role] : [];
      const created = [];
      const skipped = [];
      const errors = [];
      for (const def of ruleDefinitions(settings)) {
        if (existing.some((r) => r.name === def.name)) { skipped.push(def.name); continue; }
        try {
          await guild.autoModerationRules.create({
            ...def,
            eventType: AutoModerationRuleEventType.MessageSend,
            enabled: true,
            exemptRoles: exempt,
            reason: `/otomod kur (${i.user.tag})`,
          });
          created.push(def.name);
        } catch (e) {
          errors.push(`${def.name}: ${e.message}`);
        }
      }
      const lines = [
        ...created.map((n) => `✅ ${n}`),
        ...skipped.map((n) => `⏭️ ${n} (zaten var)`),
        ...errors.map((n) => `❌ ${n}`),
      ];
      if (!settings.modlog_channel) lines.push('\nℹ️ `/ayar mod-log` ayarlanmadığı için uyarı bildirimi gönderilmeyecek; ayarladıktan sonra `/otomod kapat` + `/otomod kur` yap.');
      return i.editReply({ embeds: [new EmbedBuilder().setColor(errors.length ? config.colors.warn : config.colors.success).setTitle('🤖 AutoMod Kurulumu').setDescription(lines.join('\n'))] });
    }

    if (sub === 'durum') {
      const rules = await guild.autoModerationRules.fetch();
      const list = rules.map((r) => `${r.enabled ? '🟢' : '🔴'} ${r.name}`);
      const e = new EmbedBuilder().setColor(config.colors.main).setTitle('🛡️ Moderasyon Durumu').addFields(
        { name: 'AutoMod kuralları', value: list.length ? list.join('\n').slice(0, 1000) : 'Hiç kural yok. `/otomod kur` ile oluştur.' },
        { name: 'Doğrulama seviyesi', value: VERIFICATION[guild.verificationLevel] ?? String(guild.verificationLevel), inline: true },
        { name: 'Müstehcen içerik taraması', value: CONTENT_FILTER[guild.explicitContentFilter] ?? String(guild.explicitContentFilter), inline: true },
        { name: 'Uyarı eşiği', value: settings.warn_threshold ? `${settings.warn_threshold} uyarı → ${settings.warn_timeout_min} dk susturma` : 'kapalı', inline: true },
      ).setFooter({ text: 'AutoMod ihlalleri otomatik uyarı olarak kaydedilir.' });
      return i.editReply({ embeds: [e] });
    }

    if (sub === 'kapat') {
      const rules = (await guild.autoModerationRules.fetch()).filter((r) => r.name.startsWith(PREFIX));
      for (const r of rules.values()) await r.delete(`/otomod kapat (${i.user.tag})`).catch(() => {});
      return i.editReply(ok(`${rules.size} kural silindi.`));
    }

    // Kelime yönetimi
    const parse = () => [...new Set(i.options.getString('kelimeler', true).split(',').map((w) => w.trim().toLowerCase()).filter(Boolean))];
    const rule = await getWordsRule(guild);

    if (sub === 'kelime-liste') {
      const words = rule?.triggerMetadata.keywordFilter ?? [];
      return i.editReply(words.length ? `**Yasaklı kelimeler (${words.length}):**\n||${words.join(', ').slice(0, 1800)}||` : 'Yasaklı kelime listesi boş.');
    }

    if (sub === 'kelime-ekle') {
      const add = parse();
      if (add.some((w) => w.length > 60)) return i.editReply(fail('Kelimeler en fazla 60 karakter olabilir.'));
      if (!rule) {
        try {
          await guild.autoModerationRules.create({
            name: WORDS_RULE,
            eventType: AutoModerationRuleEventType.MessageSend,
            triggerType: AutoModerationRuleTriggerType.Keyword,
            triggerMetadata: { keywordFilter: add.slice(0, 1000) },
            actions: baseActions(settings),
            exemptRoles: settings.staff_role ? [settings.staff_role] : [],
            enabled: true,
          });
        } catch (e) { return i.editReply(fail(`Kural oluşturulamadı: ${e.message}`)); }
        return i.editReply(ok(`${add.length} kelime eklendi ve kural oluşturuldu.`));
      }
      const merged = [...new Set([...(rule.triggerMetadata.keywordFilter ?? []), ...add])];
      if (merged.length > 1000) return i.editReply(fail('Discord en fazla 1000 kelimeye izin verir.'));
      await rule.setKeywordFilter(merged).catch((e) => i.editReply(fail(e.message)));
      return i.editReply(ok(`Kelime listesi güncellendi (toplam ${merged.length}).`));
    }

    if (sub === 'kelime-sil') {
      if (!rule) return i.editReply(fail('Yasaklı kelime kuralı yok.'));
      const remove = new Set(parse());
      const left = (rule.triggerMetadata.keywordFilter ?? []).filter((w) => !remove.has(w));
      if (!left.length) { await rule.delete(); return i.editReply(ok('Tüm kelimeler silindi, kural kaldırıldı.')); }
      await rule.setKeywordFilter(left);
      return i.editReply(ok(`Kelime listesi güncellendi (kalan ${left.length}).`));
    }
  },
};
