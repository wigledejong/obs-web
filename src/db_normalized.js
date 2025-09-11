const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'config.sqlite');

function getDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      atem_server TEXT,
      connect_to_atem INTEGER,
      connect_to_lumens INTEGER
    );
    INSERT INTO settings(id) SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM settings WHERE id=1);

    CREATE TABLE IF NOT EXISTS camera (
      id INTEGER PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      naam TEXT,
      ip TEXT,
      user TEXT,
      password TEXT,
      atem_channel INTEGER,
      ptz INTEGER
    );

    CREATE TABLE IF NOT EXISTS preset (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      camera_key TEXT,
      preset_number INTEGER
    );

    CREATE TABLE IF NOT EXISTS uitzending_variant (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS variant_preset (
      variant_id INTEGER NOT NULL,
      preset_name TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      PRIMARY KEY (variant_id, order_index),
      FOREIGN KEY(variant_id) REFERENCES uitzending_variant(id)
    );

    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      gamma_index INTEGER,
      brightness_index INTEGER,
      hue_index INTEGER,
      saturation_index INTEGER,
      sharpness_index INTEGER
    );
  `);
}

function upsertSettings(db, cfg) {
  const s = db.prepare('UPDATE settings SET atem_server=?, connect_to_atem=?, connect_to_lumens=? WHERE id=1');
  s.run(cfg.atemServer || null, cfg.connectToAtem ? 1 : 0, cfg.connectToLumens ? 1 : 0);
}

function upsertCameras(db, camerasObj) {
  const del = db.prepare('DELETE FROM camera');
  del.run();
  const ins = db.prepare('INSERT INTO camera(key, naam, ip, user, password, atem_channel, ptz) VALUES (?,?,?,?,?,?,?)');
  for (const key of Object.keys(camerasObj || {})) {
    const c = camerasObj[key];
    ins.run(key, c.naam || null, c.ip || null, c.user || null, c.password || null, c.atemChannel ? parseInt(c.atemChannel) : null, c.ptz ? 1 : 0);
  }
}

function upsertPresets(db, presetsObj) {
  const del = db.prepare('DELETE FROM preset');
  del.run();
  const ins = db.prepare('INSERT INTO preset(name, camera_key, preset_number) VALUES (?,?,?)');
  for (const name of Object.keys(presetsObj || {})) {
    const p = presetsObj[name];
    ins.run(name, p.camera || null, p.preset ? parseInt(p.preset) : null);
  }
}

function upsertVariants(db, variantsArr) {
  const del = db.prepare('DELETE FROM uitzending_variant');
  del.run();
  const ins = db.prepare('INSERT INTO uitzending_variant(name) VALUES (?)');
  for (const v of variantsArr || []) ins.run(v);
}

function upsertVariantPresets(db, presetUitzending) {
  const del = db.prepare('DELETE FROM variant_preset');
  del.run();
  const variantByName = new Map(db.prepare('SELECT id, name FROM uitzending_variant').all().map(r => [r.name, r.id]));
  const ins = db.prepare('INSERT INTO variant_preset(variant_id, preset_name, order_index) VALUES (?,?,?)');
  for (const variantName of Object.keys(presetUitzending || {})) {
    const variantId = variantByName.get(variantName);
    if (!variantId) continue;
    const list = presetUitzending[variantName] || [];
    list.forEach((presetName, idx) => ins.run(variantId, presetName, idx));
  }
}

function upsertProfiles(db, cfg) {
  const del = db.prepare('DELETE FROM profile');
  del.run();
  const ins = db.prepare('INSERT INTO profile(name, gamma_index, brightness_index, hue_index, saturation_index, sharpness_index) VALUES (?,?,?,?,?,?)');
  function add(name, p) {
    if (!p) return;
    ins.run(name, parseInt(p.gammanameindex)||null, parseInt(p.brightnessnameindex)||null, parseInt(p.huenameindex)||null, parseInt(p.saturationnameindex)||null, parseInt(p.sharpnessnameindex)||null);
  }
  add('avondProfiel', cfg.avondProfiel);
  add('ochtendProfiel', cfg.ochtendProfiel);
}

function migrateJsonToNormalized(db, cfg) {
  const tx = db.transaction(() => {
    initSchema(db);
    // Ensure no FK violations: clear variant_preset before modifying variants
    db.prepare('DELETE FROM variant_preset').run();
    upsertSettings(db, cfg);
    upsertCameras(db, cfg.cameras);
    upsertPresets(db, cfg.presets);
    upsertVariants(db, cfg.uitzendingVariant);
    upsertProfiles(db, cfg);
    upsertVariantPresets(db, cfg.presetUitzending);
  });
  tx();
}

function isDatabaseEmpty(db) {
  try {
    // Check if any normalized tables have meaningful data
    const camerasCount = db.prepare('SELECT COUNT(*) as count FROM camera').get().count;
    const presetsCount = db.prepare('SELECT COUNT(*) as count FROM preset').get().count;
    const variantsCount = db.prepare('SELECT COUNT(*) as count FROM uitzending_variant').get().count;
    
    // Check if settings table has meaningful data (not just the default empty record)
    const settingsRecord = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    const hasSettingsData = settingsRecord && (settingsRecord.atem_server || settingsRecord.connect_to_atem || settingsRecord.connect_to_lumens);
    
    // Also check if the old config table has meaningful data (not just empty JSON)
    let hasLegacyData = false;
    try {
      const legacyConfig = db.prepare('SELECT json FROM config WHERE id = 1').get();
      if (legacyConfig && legacyConfig.json) {
        const parsed = JSON.parse(legacyConfig.json);
        hasLegacyData = Object.keys(parsed).length > 0;
      }
    } catch (e) {
      // Old config table doesn't exist, that's fine
    }
    
    const isEmpty = camerasCount === 0 && presetsCount === 0 && variantsCount === 0 && !hasSettingsData && !hasLegacyData;
    
    // Database is considered empty if all normalized tables are empty AND no meaningful legacy data
    return isEmpty;
  } catch (error) {
    // If there's an error (tables don't exist), consider it empty
    return true;
  }
}

function buildJsonFromNormalized(db) {
  const settings = db.prepare('SELECT * FROM settings WHERE id=1').get();
  const cameras = db.prepare('SELECT * FROM camera').all();
  const presets = db.prepare('SELECT * FROM preset').all();
  const variants = db.prepare('SELECT * FROM uitzending_variant').all();
  const variantPresets = db.prepare('SELECT v.name as variant, vp.preset_name, vp.order_index FROM variant_preset vp JOIN uitzending_variant v ON v.id = vp.variant_id ORDER BY v.name, vp.order_index').all();
  const profiles = db.prepare('SELECT * FROM profile').all();

  const cfg = {};
  cfg.atemServer = settings?.atem_server || '';
  cfg.connectToAtem = !!settings?.connect_to_atem;
  cfg.connectToLumens = !!settings?.connect_to_lumens;

  cfg.cameras = {};
  for (const c of cameras) {
    cfg.cameras[c.key] = {
      ip: c.ip || undefined,
      naam: c.naam || undefined,
      user: c.user || undefined,
      password: c.password || undefined,
      atemChannel: c.atem_channel != null ? String(c.atem_channel) : undefined,
      ptz: !!c.ptz,
    };
  }

  cfg.presets = {};
  for (const p of presets) {
    const obj = { camera: p.camera_key || undefined };
    if (p.preset_number != null) obj.preset = String(p.preset_number);
    cfg.presets[p.name] = obj;
  }

  cfg.uitzendingVariant = variants.map(v => v.name);
  cfg.presetUitzending = {};
  for (const v of cfg.uitzendingVariant) cfg.presetUitzending[v] = [];
  for (const row of variantPresets) {
    cfg.presetUitzending[row.variant].push(row.preset_name);
  }

  for (const p of profiles) {
    const obj = {
      gammanameindex: String(p.gamma_index),
      brightnessnameindex: String(p.brightness_index),
      huenameindex: String(p.hue_index),
      saturationnameindex: String(p.saturation_index),
      sharpnessnameindex: String(p.sharpness_index),
    };
    if (p.name === 'avondProfiel') cfg.avondProfiel = obj;
    if (p.name === 'ochtendProfiel') cfg.ochtendProfiel = obj;
  }

  return cfg;
}

module.exports = {
  getDb,
  initSchema,
  migrateJsonToNormalized,
  buildJsonFromNormalized,
  isDatabaseEmpty,
};


