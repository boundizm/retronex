const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const dir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(path.join(dir, 'retronex.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  modlog_channel TEXT,
  report_channel TEXT,
  appeal_channel TEXT,
  level_channel TEXT,
  voice_hub TEXT,
  staff_role TEXT,
  level_enabled INTEGER NOT NULL DEFAULT 1,
  warn_threshold INTEGER NOT NULL DEFAULT ${config.defaults.warnThreshold},
  warn_timeout_min INTEGER NOT NULL DEFAULT ${config.defaults.warnTimeoutMin}
);

CREATE TABLE IF NOT EXISTS levels (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS level_roles (
  guild_id TEXT NOT NULL,
  level INTEGER NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, level)
);

CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  mod_id TEXT NOT NULL,
  type TEXT NOT NULL,
  reason TEXT,
  duration_sec INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cases_user ON cases (guild_id, user_id);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  target_id TEXT,
  reason TEXT NOT NULL,
  evidence TEXT,
  status TEXT NOT NULL DEFAULT 'bekliyor',
  handled_by TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS appeals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  case_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'bekliyor',
  handled_by TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  channel_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS voice_channels (
  channel_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  owner_id TEXT NOT NULL
);
`);

const now = () => Math.floor(Date.now() / 1000);

// ---------- Sunucu ayarları ----------
const SETTING_KEYS = new Set([
  'modlog_channel', 'report_channel', 'appeal_channel', 'level_channel',
  'voice_hub', 'staff_role', 'level_enabled', 'warn_threshold', 'warn_timeout_min',
]);

function getSettings(guildId) {
  db.prepare('INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)').run(guildId);
  return db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
}

function setSetting(guildId, key, value) {
  if (!SETTING_KEYS.has(key)) throw new Error(`Geçersiz ayar anahtarı: ${key}`);
  getSettings(guildId);
  db.prepare(`UPDATE guild_settings SET ${key} = ? WHERE guild_id = ?`).run(value, guildId);
}

// ---------- Seviye ----------
const xpForLevel = (n) => 5 * n * n + 50 * n + 100;

function levelFromXp(xp) {
  let level = 0;
  let rem = xp;
  while (rem >= xpForLevel(level)) {
    rem -= xpForLevel(level);
    level++;
  }
  return { level, current: rem, needed: xpForLevel(level) };
}

function addXp(guildId, userId, amount) {
  const row = db.prepare('SELECT xp, level FROM levels WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  const oldLevel = row ? row.level : 0;
  const xp = Math.max(0, (row ? row.xp : 0) + amount);
  const { level } = levelFromXp(xp);
  db.prepare(`
    INSERT INTO levels (guild_id, user_id, xp, level, messages) VALUES (?, ?, ?, ?, ${amount > 0 ? 1 : 0})
    ON CONFLICT (guild_id, user_id) DO UPDATE SET xp = excluded.xp, level = excluded.level,
      messages = messages + ${amount > 0 ? 1 : 0}
  `).run(guildId, userId, xp, level);
  return { xp, level, oldLevel, leveledUp: level > oldLevel };
}

const getLevel = (guildId, userId) =>
  db.prepare('SELECT * FROM levels WHERE guild_id = ? AND user_id = ?').get(guildId, userId);

const getRank = (guildId, xp) =>
  db.prepare('SELECT COUNT(*) + 1 AS rank FROM levels WHERE guild_id = ? AND xp > ?').get(guildId, xp).rank;

const getLeaderboard = (guildId, limit = 10, offset = 0) =>
  db.prepare('SELECT * FROM levels WHERE guild_id = ? ORDER BY xp DESC LIMIT ? OFFSET ?').all(guildId, limit, offset);

const countLevelUsers = (guildId) =>
  db.prepare('SELECT COUNT(*) AS n FROM levels WHERE guild_id = ?').get(guildId).n;

const resetLevel = (guildId, userId) =>
  db.prepare('DELETE FROM levels WHERE guild_id = ? AND user_id = ?').run(guildId, userId);

const getLevelRoles = (guildId) =>
  db.prepare('SELECT * FROM level_roles WHERE guild_id = ? ORDER BY level ASC').all(guildId);

const setLevelRole = (guildId, level, roleId) =>
  db.prepare(`INSERT INTO level_roles (guild_id, level, role_id) VALUES (?, ?, ?)
              ON CONFLICT (guild_id, level) DO UPDATE SET role_id = excluded.role_id`).run(guildId, level, roleId);

const removeLevelRole = (guildId, level) =>
  db.prepare('DELETE FROM level_roles WHERE guild_id = ? AND level = ?').run(guildId, level).changes > 0;

// ---------- Ceza kayıtları ----------
function addCase({ guildId, userId, modId, type, reason, durationSec = null }) {
  const r = db.prepare(`INSERT INTO cases (guild_id, user_id, mod_id, type, reason, duration_sec, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(guildId, userId, modId, type, reason || 'Sebep belirtilmedi', durationSec, now());
  return getCase(Number(r.lastInsertRowid));
}

const getCase = (id) => db.prepare('SELECT * FROM cases WHERE id = ?').get(id);
const deleteCase = (id) => db.prepare('DELETE FROM cases WHERE id = ?').run(id);
const deactivateCase = (id) => db.prepare('UPDATE cases SET active = 0 WHERE id = ?').run(id);

const getUserCases = (guildId, userId, type = null) =>
  type
    ? db.prepare('SELECT * FROM cases WHERE guild_id = ? AND user_id = ? AND type = ? ORDER BY id DESC').all(guildId, userId, type)
    : db.prepare('SELECT * FROM cases WHERE guild_id = ? AND user_id = ? ORDER BY id DESC').all(guildId, userId);

const countActiveWarns = (guildId, userId) =>
  db.prepare("SELECT COUNT(*) AS n FROM cases WHERE guild_id = ? AND user_id = ? AND type = 'uyari' AND active = 1")
    .get(guildId, userId).n;

// ---------- Raporlar ----------
function addReport({ guildId, reporterId, targetId, reason, evidence }) {
  const r = db.prepare(`INSERT INTO reports (guild_id, reporter_id, target_id, reason, evidence, created_at)
                        VALUES (?, ?, ?, ?, ?, ?)`).run(guildId, reporterId, targetId || null, reason, evidence || null, now());
  return getReport(Number(r.lastInsertRowid));
}
const getReport = (id) => db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
const countPendingReports = (guildId, reporterId) =>
  db.prepare("SELECT COUNT(*) AS n FROM reports WHERE guild_id = ? AND reporter_id = ? AND status = 'bekliyor'")
    .get(guildId, reporterId).n;
const resolveReport = (id, status, modId) =>
  db.prepare('UPDATE reports SET status = ?, handled_by = ? WHERE id = ?').run(status, modId, id);

// ---------- İtirazlar ----------
function addAppeal({ guildId, caseId, userId, text }) {
  const r = db.prepare('INSERT INTO appeals (guild_id, case_id, user_id, text, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(guildId, caseId, userId, text, now());
  return getAppeal(Number(r.lastInsertRowid));
}
const getAppeal = (id) => db.prepare('SELECT * FROM appeals WHERE id = ?').get(id);
const hasPendingAppeal = (caseId) =>
  !!db.prepare("SELECT 1 FROM appeals WHERE case_id = ? AND status = 'bekliyor'").get(caseId);
const resolveAppeal = (id, status, modId) =>
  db.prepare('UPDATE appeals SET status = ?, handled_by = ? WHERE id = ?').run(status, modId, id);

// ---------- Özel ses kanalları ----------
const addVoiceChannel = (channelId, guildId, ownerId) =>
  db.prepare('INSERT OR REPLACE INTO voice_channels (channel_id, guild_id, owner_id) VALUES (?, ?, ?)')
    .run(channelId, guildId, ownerId);
const getVoiceChannel = (channelId) =>
  db.prepare('SELECT * FROM voice_channels WHERE channel_id = ?').get(channelId);
const setVoiceOwner = (channelId, ownerId) =>
  db.prepare('UPDATE voice_channels SET owner_id = ? WHERE channel_id = ?').run(ownerId, channelId);
const removeVoiceChannel = (channelId) =>
  db.prepare('DELETE FROM voice_channels WHERE channel_id = ?').run(channelId);
const allVoiceChannels = () => db.prepare('SELECT * FROM voice_channels').all();
const getOwnedVoiceChannel = (guildId, ownerId) =>
  db.prepare('SELECT * FROM voice_channels WHERE guild_id = ? AND owner_id = ?').get(guildId, ownerId);

// ---------- Biletler ----------
const addTicket = (channelId, guildId, userId, category) =>
  db.prepare('INSERT INTO tickets (channel_id, guild_id, user_id, category, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(channelId, guildId, userId, category, now());
const getTicket = (channelId) => db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channelId);
const getUserTickets = (guildId, userId) =>
  db.prepare('SELECT * FROM tickets WHERE guild_id = ? AND user_id = ?').all(guildId, userId);
const removeTicket = (channelId) => db.prepare('DELETE FROM tickets WHERE channel_id = ?').run(channelId);

module.exports = {
  addTicket, getTicket, getUserTickets, removeTicket,
  db, getSettings, setSetting,
  xpForLevel, levelFromXp, addXp, getLevel, getRank, getLeaderboard, countLevelUsers, resetLevel,
  getLevelRoles, setLevelRole, removeLevelRole,
  addCase, getCase, deleteCase, deactivateCase, getUserCases, countActiveWarns,
  addReport, getReport, countPendingReports, resolveReport,
  addAppeal, getAppeal, hasPendingAppeal, resolveAppeal,
  addVoiceChannel, getVoiceChannel, setVoiceOwner, removeVoiceChannel, allVoiceChannels, getOwnedVoiceChannel,
};
