const {
  SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, EmbedBuilder,
  AutoModerationRuleEventType, AutoModerationRuleTriggerType, AutoModerationActionType,
  AutoModerationRuleKeywordPresetType, GuildVerificationLevel, GuildExplicitContentFilter,
} = require('discord.js');
const config = require('../config');
const db = require('../database');
const { t } = require('../texts');
const { ok, fail, ephemeral } = require('../utils/helpers');

const PREFIX = 'Retronex: ';
const WORDS_RULE = `${PREFIX}Yasaklı Kelimeler`;

const VERIFICATION_KEYS = {
  [GuildVerificationLevel.None]: 'automod.verif.0',
  [GuildVerificationLevel.Low]: 'automod.verif.1',
  [GuildVerificationLevel.Medium]: 'automod.verif.2',
  [GuildVerificationLevel.High]: 'automod.verif.3',
  [GuildVerificationLevel.VeryHigh]: 'automod.verif.4',
};
const FILTER_KEYS = {
  [GuildExplicitContentFilter.Disabled]: 'automod.filter.0',
  [GuildExplicitContentFilter.MembersWithoutRoles]: 'automod.filter.1',
  [GuildExplicitContentFilter.AllMembers]: 'automod.filter.2',
};

// Her kural için temel eylemler: mesajı engelle + (varsa) mod-log'a uyarı gönder
function baseActions(settings) {
  const actions = [{ type: AutoModerationActionType.BlockMessage, metadata: { customMessage: t('automod.block_message') } }];
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
      return i.reply(fail(t('automod.noperm')));
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
          errors.push(t('automod.setup.error', { name: def.name, error: e.message }));
        }
      }
      const lines = [
        ...created.map((name) => t('automod.setup.created', { name })),
        ...skipped.map((name) => t('automod.setup.skipped', { name })),
        ...errors,
      ];
      if (!settings.modlog_channel) lines.push(`\n${t('automod.setup.nolog')}`);
      return i.editReply({ embeds: [new EmbedBuilder().setColor(errors.length ? config.colors.warn : config.colors.success).setTitle(t('automod.setup.title')).setDescription(lines.join('\n'))] });
    }

    if (sub === 'durum') {
      const rules = await guild.autoModerationRules.fetch();
      const list = rules.map((r) => `${r.enabled ? '🟢' : '🔴'} ${r.name}`);
      const e = new EmbedBuilder().setColor(config.colors.main).setTitle(t('automod.status.title')).addFields(
        { name: t('automod.status.f_rules'), value: list.length ? list.join('\n').slice(0, 1000) : t('automod.status.norules') },
        { name: t('automod.status.f_verification'), value: VERIFICATION_KEYS[guild.verificationLevel] ? t(VERIFICATION_KEYS[guild.verificationLevel]) : String(guild.verificationLevel), inline: true },
        { name: t('automod.status.f_filter'), value: FILTER_KEYS[guild.explicitContentFilter] ? t(FILTER_KEYS[guild.explicitContentFilter]) : String(guild.explicitContentFilter), inline: true },
        { name: t('automod.status.f_threshold'), value: settings.warn_threshold ? t('automod.status.threshold', { count: settings.warn_threshold, minutes: settings.warn_timeout_min }) : t('automod.status.threshold_off'), inline: true },
      ).setFooter({ text: t('automod.status.footer') });
      return i.editReply({ embeds: [e] });
    }

    if (sub === 'kapat') {
      const rules = (await guild.autoModerationRules.fetch()).filter((r) => r.name.startsWith(PREFIX));
      for (const r of rules.values()) await r.delete(`/otomod kapat (${i.user.tag})`).catch(() => {});
      return i.editReply(ok(t('automod.disabled', { count: rules.size })));
    }

    // Kelime yönetimi
    const parse = () => [...new Set(i.options.getString('kelimeler', true).split(',').map((w) => w.trim().toLowerCase()).filter(Boolean))];
    const rule = await getWordsRule(guild);

    if (sub === 'kelime-liste') {
      const words = rule?.triggerMetadata.keywordFilter ?? [];
      return i.editReply(words.length ? t('automod.words.list', { count: words.length, words: words.join(', ').slice(0, 1800) }) : t('automod.words.empty'));
    }

    if (sub === 'kelime-ekle') {
      const add = parse();
      if (add.some((w) => w.length > 60)) return i.editReply(fail(t('automod.words.toolong')));
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
        } catch (e) { return i.editReply(fail(t('automod.words.createfail', { error: e.message }))); }
        return i.editReply(ok(t('automod.words.created', { count: add.length })));
      }
      const merged = [...new Set([...(rule.triggerMetadata.keywordFilter ?? []), ...add])];
      if (merged.length > 1000) return i.editReply(fail(t('automod.words.max')));
      await rule.setKeywordFilter(merged).catch((e) => i.editReply(fail(e.message)));
      return i.editReply(ok(t('automod.words.updated', { count: merged.length })));
    }

    if (sub === 'kelime-sil') {
      if (!rule) return i.editReply(fail(t('automod.words.norule')));
      const remove = new Set(parse());
      const left = (rule.triggerMetadata.keywordFilter ?? []).filter((w) => !remove.has(w));
      if (!left.length) { await rule.delete(); return i.editReply(ok(t('automod.words.cleared'))); }
      await rule.setKeywordFilter(left);
      return i.editReply(ok(t('automod.words.left', { count: left.length })));
    }
  },
};
