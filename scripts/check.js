// Token olmadan: tüm komutları yükler, builder'ları JSON'a çevirir, DB'yi test eder.
process.env.DISCORD_TOKEN ??= 'x';
const assert = require('node:assert');
const { loadCommands } = require('../src/loader');
const db = require('../src/database');
const { parseDuration, formatDuration } = require('../src/utils/helpers');

const cmds = loadCommands();
const json = cmds.map((c) => c.data.toJSON());
const names = json.map((j) => j.name);
assert.strictEqual(new Set(names).size, names.length, 'Yinelenen komut adı');
console.log(`${cmds.length} komut: ${names.join(', ')}`);

assert.strictEqual(parseDuration('10m'), 600);
assert.strictEqual(parseDuration('2sa'), 7200);
assert.strictEqual(parseDuration('xyz'), null);
assert.strictEqual(formatDuration(3661), '1 saat 1 dk 1 sn');

const g = 'test-guild', u = 'test-user';
db.db.exec(`DELETE FROM levels WHERE guild_id='${g}'; DELETE FROM cases WHERE guild_id='${g}'`);
assert.strictEqual(db.levelFromXp(0).level, 0);
assert.strictEqual(db.levelFromXp(100).level, 1);
const r = db.addXp(g, u, 120);
assert.ok(r.leveledUp && r.level === 1);
assert.strictEqual(db.getRank(g, 120), 1);
const c = db.addCase({ guildId: g, userId: u, modId: 'm', type: 'uyari', reason: 'x' });
assert.strictEqual(db.countActiveWarns(g, u), 1);
db.deactivateCase(c.id);
assert.strictEqual(db.countActiveWarns(g, u), 0);
db.db.exec(`DELETE FROM levels WHERE guild_id='${g}'; DELETE FROM cases WHERE guild_id='${g}'`);
console.log('✅ Tüm kontroller geçti');
