// Token olmadan: komutları yükler, metin kataloğunu doğrular, DB'yi ve web panelini test eder.
process.env.DISCORD_TOKEN ??= 'x';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadCommands } = require('../src/loader');
const db = require('../src/database');
const texts = require('../src/texts');
const catalog = require('../src/catalog');
const { parseDuration, formatDuration } = require('../src/utils/helpers');

// --- komutlar
const cmds = loadCommands();
const names = cmds.map((c) => c.data.toJSON().name);
assert.strictEqual(new Set(names).size, names.length, 'Yinelenen komut adı');
console.log(`${cmds.length} komut yüklendi`);

// --- metin kataloğu
for (const d of catalog) {
  assert.strictEqual(texts.validate(d.key, d.value), null, `Varsayılan metin geçersiz: ${d.key}`);
  for (const v of d.vars) assert.ok(v in texts.SAMPLES, `Örnek değer eksik: {${v}} (${d.key})`);
}
const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.isDirectory()) walk(path.join(dir, f.name));
    else if (f.name.endsWith('.js') && !['catalog.js', 'texts.js'].includes(f.name)) files.push(path.join(dir, f.name));
  }
})(path.join(__dirname, '..', 'src'));
const used = new Set();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([\w.]+)'/g)) used.add(m[1]);
  for (const d of catalog) if (src.includes(`'${d.key}'`)) used.add(d.key); // t(cond ? 'a' : 'b') biçimleri
}
// dinamik anahtarlar
for (const c of ['genel', 'sikayet', 'isbirligi']) for (const s of ['label', 'desc']) used.add(`ticket.cat.${c}.${s}`);
for (const b of ['lock', 'unlock', 'hide', 'show', 'name', 'limit', 'claim', 'info', 'delete']) used.add(`voice.btn.${b}`);
for (const l of ['modlog', 'report', 'appeal']) used.add(`settings.label.${l}`);
for (const ty of ['ban', 'unban', 'kick', 'sustur', 'susturma_kaldir', 'uyari', 'otomod']) used.add(`case.type.${ty}`);
for (let i = 0; i < 5; i++) used.add(`automod.verif.${i}`);
for (let i = 0; i < 3; i++) used.add(`automod.filter.${i}`);
for (const k of ['resolved', 'rejected', 'pending', 'handled']) used.add(`report.status.${k}`);
for (const k of ['accepted', 'rejected', 'pending', 'handled']) used.add(`appeal.status.${k}`);
for (const c of ['main', 'success', 'warn', 'danger', 'info', 'ticket']) used.add(`color.${c}`);
const missing = [...used].filter((k) => !texts.defs.has(k));
assert.deepStrictEqual(missing, [], `Katalogda olmayan anahtarlar: ${missing}`);
const unused = catalog.map((d) => d.key).filter((k) => !used.has(k));
assert.deepStrictEqual(unused, [], `Kodda kullanılmayan metinler: ${unused}`);
console.log(`${catalog.length} düzenlenebilir metin doğrulandı`);

// --- metin motoru
assert.strictEqual(texts.t('mod.ban.success', { user: 'x', case: 7 }), '**x** yasaklandı. (Ceza #7)');
assert.match(texts.validate('mod.ban.success', '{nope}'), /kullanılamayan değişken/);
assert.ok(texts.validate('color.main', 'kırmızı'));
texts.setText('mod.ban.self', 'TEST');
assert.strictEqual(texts.t('mod.ban.self'), 'TEST');
texts.resetText('mod.ban.self');
assert.strictEqual(texts.t('mod.ban.self'), 'Kendini yasaklayamazsın.');
texts.setText('color.main', '#112233');
assert.strictEqual(require('../src/config').colors.main, 0x112233);
texts.resetText('color.main');

// --- yardımcılar ve DB
assert.strictEqual(parseDuration('10m'), 600);
assert.strictEqual(parseDuration('xyz'), null);
assert.strictEqual(formatDuration(3661), '1 saat 1 dk 1 sn');
const g = 'test-guild', u = 'test-user';
const clean = () => db.db.exec(`DELETE FROM levels WHERE guild_id='${g}'; DELETE FROM cases WHERE guild_id='${g}'`);
clean();
assert.strictEqual(db.levelFromXp(100).level, 1);
assert.ok(db.addXp(g, u, 120).leveledUp);
const c = db.addCase({ guildId: g, userId: u, modId: 'm', type: 'uyari', reason: 'x' });
assert.strictEqual(db.countActiveWarns(g, u), 1);
db.deactivateCase(c.id);
assert.strictEqual(db.countActiveWarns(g, u), 0);
clean();
console.log('✅ Tüm kontroller geçti');
