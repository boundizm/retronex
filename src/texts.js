// Düzenlenebilir metin motoru: varsayılanlar catalog.js'te, panelden yapılan değişiklikler DB'de.
const catalog = require('./catalog');
const db = require('./database');

const defs = new Map(catalog.map((d) => [d.key, d]));
const overrides = new Map(db.allTexts().filter((r) => defs.has(r.key)).map((r) => [r.key, r.value]));

const MAX_LENGTH = { text: 2000, title: 256, button: 80, short: 100, label45: 45, color: 7 };
const PLACEHOLDER = /\{(\w+)\}/g;

// Önizleme için örnek değerler
const SAMPLES = {
  user: 'Ahmet', username: 'ahmet', tag: 'ahmet', guild: 'RetroNEX', case: '42', id: '42', error: 'Missing Permissions',
  count: '3', duration: '2 saat', channel: '#genel', seconds: '10', level: '5', xp: '1250', current: '120', needed: '350',
  page: '1', pages: '3', pos: '🥇', role: '@Aktif', mod: '@Moderatör', target: '@Üye', date: '2.10.2026', reason: 'Spam',
  emoji: '🔨', type: 'Yasaklama', icon: '🟡', active: '1', total: '4', max: '5', result: 'kabul edildi', status: 'çözüldü',
  name: 'Habbo Sohbet', limit: '5', owner: '123456789', category: '📩 Genel Destek & Öneri', rule: 'Küfür ve Hakaret',
  keyword: ' (“örnek”)', words: 'kelime1, kelime2', minutes: '60', label: 'Mod-log',
};

function t(key, vars = {}) {
  const def = defs.get(key);
  if (!def) throw new Error(`Bilinmeyen metin anahtarı: ${key}`);
  const raw = overrides.get(key) ?? def.value;
  return raw.replace(PLACEHOLDER, (m, name) => (name in vars ? String(vars[name]) : m));
}

// 'main' -> 0x5865F2 (override varsa onu)
function color(name) {
  const hex = overrides.get(`color.${name}`) ?? defs.get(`color.${name}`).value;
  return parseInt(hex.slice(1), 16);
}

function validate(key, value) {
  const def = defs.get(key);
  if (!def) return 'Bilinmeyen anahtar.';
  if (typeof value !== 'string' || !value.trim()) return 'Boş olamaz (varsayılana dönmek için "Sıfırla" kullan).';
  if (def.kind === 'color') return /^#[0-9a-fA-F]{6}$/.test(value) ? null : 'Renk #RRGGBB biçiminde olmalı.';
  const max = MAX_LENGTH[def.kind];
  if (value.length > max) return `En fazla ${max} karakter olabilir (şu an ${value.length}).`;
  const unknown = [...value.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((n) => !def.vars.includes(n));
  if (unknown.length) {
    return `Bu metinde kullanılamayan değişken: ${[...new Set(unknown)].map((n) => `{${n}}`).join(', ')}. ` +
      `İzin verilenler: ${def.vars.length ? def.vars.map((n) => `{${n}}`).join(', ') : 'yok'}.`;
  }
  return null;
}

function setText(key, value) {
  const err = validate(key, value);
  if (err) throw new Error(err);
  if (value === defs.get(key).value) return resetText(key);
  db.setText(key, value);
  overrides.set(key, value);
}

function resetText(key) {
  if (!defs.has(key)) throw new Error('Bilinmeyen anahtar.');
  db.deleteText(key);
  overrides.delete(key);
}

// Panel için: gruplanmış liste
function list() {
  const groups = new Map();
  for (const d of catalog) {
    if (!groups.has(d.group)) groups.set(d.group, []);
    groups.get(d.group).push({
      key: d.key, label: d.label, kind: d.kind, vars: d.vars, max: MAX_LENGTH[d.kind],
      default: d.value, value: overrides.get(d.key) ?? d.value, custom: overrides.has(d.key),
    });
  }
  return [...groups].map(([name, items]) => ({ name, items }));
}

module.exports = { t, color, validate, setText, resetText, list, SAMPLES, defs };
