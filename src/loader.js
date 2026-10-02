const fs = require('node:fs');
const path = require('node:path');

// src/commands/*.js: bir komut ya da komut dizisi export edebilir.
function loadCommands() {
  const dir = path.join(__dirname, 'commands');
  const list = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const exported = require(path.join(dir, file));
    for (const cmd of [exported].flat()) {
      if (!cmd?.data || !cmd?.execute) throw new Error(`Geçersiz komut dosyası: ${file}`);
      list.push(cmd);
    }
  }
  return list;
}

function loadEvents(client) {
  const dir = path.join(__dirname, 'events');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const ev = require(path.join(dir, file));
    client[ev.once ? 'once' : 'on'](ev.name, (...args) => ev.execute(...args));
  }
}

module.exports = { loadCommands, loadEvents };
