const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits,
} = require('discord.js');
const config = require('../config');
const db = require('../database');
const { ok, fail, truncate } = require('../utils/helpers');
const { sendLog, typeInfo } = require('../utils/modlog');

const APPEALABLE = new Set(['ban', 'sustur', 'kick', 'uyari']);

function appealEmbed(a, c, status = null) {
  const t = typeInfo(c.type);
  return new EmbedBuilder()
    .setColor(status === 'kabul' ? config.colors.success : status === 'red' ? config.colors.danger : config.colors.info)
    .setTitle(`⚖️ İtiraz #${a.id} — Ceza #${c.id} (${t.label})`)
    .addFields(
      { name: 'İtiraz eden', value: `<@${a.user_id}> (\`${a.user_id}\`)`, inline: true },
      { name: 'Cezayı veren', value: c.mod_id === 'otomod' ? '🤖 Otomatik' : `<@${c.mod_id}>`, inline: true },
      { name: 'Durum', value: status ? `${status === 'kabul' ? 'kabul edildi' : 'reddedildi'} (<@${a.handled_by}>)` : 'bekliyor', inline: true },
      { name: 'Ceza sebebi', value: truncate(c.reason, 500) },
      { name: 'İtiraz metni', value: truncate(a.text, 1000) },
    )
    .setTimestamp(a.created_at * 1000);
}

const buttons = (id, disabled = false) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`itiraz:kabul:${id}`).setLabel('Kabul et').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(disabled),
  new ButtonBuilder().setCustomId(`itiraz:red:${id}`).setLabel('Reddet').setEmoji('🚫').setStyle(ButtonStyle.Danger).setDisabled(disabled),
);

// Modal gönderildiğinde çağrılır (sunucudan ya da DM'den olabilir).
async function submitAppeal(i, caseId, text) {
  const c = db.getCase(caseId);
  if (!c || c.user_id !== i.user.id) return i.reply(fail('Bu numarada sana ait bir ceza bulunamadı.'));
  if (!APPEALABLE.has(c.type)) return i.reply(fail('Bu kayıt türüne itiraz edilemez.'));
  if (!c.active) return i.reply(fail('Bu ceza zaten geçersiz ya da kaldırılmış.'));
  if (db.hasPendingAppeal(c.id)) return i.reply(fail('Bu ceza için zaten bekleyen bir itirazın var.'));

  const s = db.getSettings(c.guild_id);
  const guild = i.client.guilds.cache.get(c.guild_id);
  const channel = guild && s.appeal_channel ? await guild.channels.fetch(s.appeal_channel).catch(() => null) : null;
  if (!channel) return i.reply(fail('Bu sunucuda itiraz kanalı ayarlanmamış; bir yetkiliyle iletişime geç.'));

  const a = db.addAppeal({ guildId: c.guild_id, caseId: c.id, userId: i.user.id, text });
  await channel.send({
    content: s.staff_role ? `<@&${s.staff_role}>` : undefined,
    embeds: [appealEmbed(a, c)],
    components: [buttons(a.id)],
    allowedMentions: { roles: s.staff_role ? [s.staff_role] : [] },
  });
  return i.reply(ok(`İtirazın yetkililere iletildi. (İtiraz #${a.id}) Sonucu sana DM ile bildirilecek; DM'lerini açık tut.`));
}

async function revertCase(guild, c, reason) {
  if (c.type === 'ban') await guild.members.unban(c.user_id, reason).catch(() => {});
  else if (c.type === 'sustur') {
    const m = await guild.members.fetch(c.user_id).catch(() => null);
    await m?.timeout(null, reason).catch(() => {});
  }
  db.deactivateCase(c.id);
}

async function handleButton(i) {
  const [, action, idStr] = i.customId.split(':');
  const a = db.getAppeal(Number(idStr));
  if (!a || a.status !== 'bekliyor') return i.reply(fail('Bu itiraz zaten sonuçlandırılmış.'));
  const c = db.getCase(a.case_id);

  const needed = c.type === 'ban' ? PermissionFlagsBits.BanMembers : PermissionFlagsBits.ModerateMembers;
  if (!i.memberPermissions?.has(needed)) return i.reply(fail('Bu itirazı sonuçlandırmak için yetkin yok.'));
  if (c.mod_id === i.user.id && !i.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return i.reply(fail('Kendi verdiğin cezaya yapılan itirazı sonuçlandıramazsın; başka bir yetkili baksın.'));
  }

  await i.deferUpdate();
  const accepted = action === 'kabul';
  db.resolveAppeal(a.id, accepted ? 'kabul' : 'red', i.user.id);
  if (accepted) await revertCase(i.guild, c, `İtiraz #${a.id} kabul edildi (${i.user.tag})`);

  const updated = db.getAppeal(a.id);
  await i.editReply({ embeds: [appealEmbed(updated, c, accepted ? 'kabul' : 'red')], components: [buttons(a.id, true)] });
  await sendLog(i.guild, {
    content: `⚖️ **İtiraz #${a.id}** (Ceza #${c.id}, <@${a.user_id}>) <@${i.user.id}> tarafından **${accepted ? 'kabul edildi' : 'reddedildi'}**.`,
    allowedMentions: { parse: [] },
  });

  const user = await i.client.users.fetch(a.user_id).catch(() => null);
  await user?.send(accepted
    ? `✅ **${i.guild.name}** sunucusundaki **#${c.id}** numaralı ceza için itirazın **kabul edildi**; ceza kaldırıldı.`
    : `🚫 **${i.guild.name}** sunucusundaki **#${c.id}** numaralı ceza için itirazın **reddedildi**.`).catch(() => {});
}

module.exports = { submitAppeal, handleButton };
