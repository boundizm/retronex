const { EmbedBuilder, MessageFlags } = require('discord.js');
const config = require('../config');
const { t } = require('../texts');

const ephemeral = MessageFlags.Ephemeral;

const embed = (color, description, title) => {
  const e = new EmbedBuilder().setColor(config.colors[color] ?? color).setDescription(description);
  if (title) e.setTitle(title);
  return e;
};

const ok = (text) => ({ embeds: [embed('success', `${t('generic.ok_prefix')} ${text}`)], flags: ephemeral });
const fail = (text) => ({ embeds: [embed('danger', `${t('generic.fail_prefix')} ${text}`)], flags: ephemeral });

const ts = (unix, style = 'R') => `<t:${unix}:${style}>`;

const truncate = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);

// "10m", "2h", "3d", "1w" -> saniye. Geçersizse null.
function parseDuration(input) {
  const m = /^(\d+)\s*(s|sn|m|dk|h|sa|d|g|w|hf)$/i.exec(input.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult = { s: 1, sn: 1, m: 60, dk: 60, h: 3600, sa: 3600, d: 86400, g: 86400, w: 604800, hf: 604800 }[unit];
  return n * mult;
}

function formatDuration(sec) {
  const parts = [];
  for (const [label, size] of [[t('unit.day'), 86400], [t('unit.hour'), 3600], [t('unit.minute'), 60], [t('unit.second'), 1]]) {
    if (sec >= size) {
      parts.push(`${Math.floor(sec / size)} ${label}`);
      sec %= size;
    }
  }
  return parts.join(' ') || `0 ${t('unit.second')}`;
}

function progressBar(current, total, size = 12) {
  const filled = Math.round((current / total) * size);
  return '█'.repeat(filled) + '░'.repeat(size - filled);
}

module.exports = { ephemeral, embed, ok, fail, ts, truncate, parseDuration, formatDuration, progressBar };
