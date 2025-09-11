const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'config.sqlite');

function getDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  return db;
}

function initDb() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      json TEXT NOT NULL
    );
    INSERT INTO config(id, json)
    SELECT 1, '{}' WHERE NOT EXISTS(SELECT 1 FROM config WHERE id = 1);
  `);
  return db;
}

function readConfig(db) {
  const row = db.prepare('SELECT json FROM config WHERE id = 1').get();
  try {
    return JSON.parse(row.json || '{}');
  } catch(e) {
    return {};
  }
}

function writeConfig(db, obj) {
  const json = JSON.stringify(obj);
  db.prepare('UPDATE config SET json = ? WHERE id = 1').run(json);
}

function migrateFromFileIfEmpty(db, logger) {
  const current = readConfig(db);
  if (Object.keys(current).length > 0) return;
  const filePath = path.join(__dirname, 'config.json');
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    writeConfig(db, parsed);
    if (logger) logger.info('Migrated config.json into SQLite');
  } catch (e) {
    if (logger) logger.warn('No config.json to migrate or failed to parse');
  }
}

module.exports = {
  getDb,
  initDb,
  readConfig,
  writeConfig,
  migrateFromFileIfEmpty,
};


