const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3');

const ENV = process.env.NODE_ENV || 'development';
const DB_DIR = (() => {
  const renderDisk = process.env.RENDER_DISK_PATH || process.env.DATA_DIR;
  if (ENV === 'production') {
    return renderDisk || path.join('/var', 'data', 'databases');
  }
  const base = process.env.DB_DIR || path.join(__dirname, '..', 'databases');
  try { return path.join(base, ENV); } catch (_) { return base; }
})();

function resolveDbPath(school) {
  const fileName = { dlsu: 'dlsu.db', ateneo: 'ateneo.db', up: 'up.db', benilde: 'benilde.db' }[school] || 'dlsu.db';
  return path.resolve(DB_DIR, fileName);
}

async function run() {
  const dbPath = resolveDbPath('dlsu');
  console.log('🔎 Using DB at', dbPath);
  if (!fs.existsSync(path.dirname(dbPath))) {
    console.warn('⚠️ DB directory missing, creating:', path.dirname(dbPath));
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  let db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
  await new Promise(r => db.serialize(r));
  let hasTable = await new Promise((resolve, reject) => db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='prof_reviews'", [], (e, row) => {
    if (e) return reject(e);
    resolve(!!row);
  }));
  if (!hasTable) {
    const fallback = path.resolve(path.join(__dirname, '..', 'databases', 'dlsu.db'));
    if (fs.existsSync(fallback)) {
      console.warn('⚠️ Falling back to base DB:', fallback);
      db.close();
      const db2 = new sqlite3.Database(fallback, sqlite3.OPEN_READWRITE);
      await new Promise((resolve, reject) => db2.get("SELECT name FROM sqlite_master WHERE type='table' AND name='prof_reviews'", [], (e, row) => {
        if (e) return reject(e);
        hasTable = !!row;
        resolve();
      }));
      if (!hasTable) {
        console.error('❌ prof_reviews missing in fallback DB');
        process.exit(1);
      }
      // Replace db with fallback
      db = db2;
    } else {
      console.warn('⚠️ Creating minimal prof_reviews table for test');
      await new Promise((resolve, reject) => db.run(`CREATE TABLE IF NOT EXISTS prof_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prof_id INTEGER,
        user_id INTEGER,
        display_name TEXT,
        anonymous INTEGER DEFAULT 0,
        title TEXT,
        course_code TEXT,
        would_take_again TEXT,
        attainable_4 TEXT,
        deadline_leniency TEXT,
        workload_rating TEXT,
        tags TEXT,
        review_text TEXT,
        rating INTEGER DEFAULT 0,
        college TEXT,
        batch_id TEXT,
        photo_path TEXT,
        view_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (e) => { if (e) return reject(e); resolve(); }));
    }
  }

  const marker = 'PERSIST_' + Date.now();
  const insertId = await new Promise((resolve, reject) => db.run(
    `INSERT INTO prof_reviews (prof_id, user_id, display_name, anonymous, course_code, would_take_again, attainable_4, deadline_leniency, workload_rating, tags, review_text, rating, college, batch_id, photo_path)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [0, 0, 'Test Runner', 1, 'TEST123', 'Yes', 'Easy', 'Yes', 'Low', 'test', marker, 0, 'TEST', '0000', null],
    function (err) { if (err) return reject(err); resolve(this.lastID); }
  ));

  const row = await new Promise((resolve, reject) => db.get('SELECT id, review_text FROM prof_reviews WHERE id = ?', [insertId], (e, r) => {
    if (e) return reject(e);
    resolve(r);
  }));
  if (!row || row.review_text !== marker) {
    console.error('❌ Persistence check failed: inserted review not found');
    process.exit(1);
  }

  await new Promise((resolve) => db.run('DELETE FROM prof_reviews WHERE id = ?', [insertId], () => resolve()));
  db.close();
  console.log('✅ Persistence test passed');
}

run().catch(err => { console.error('❌ Test error:', err.message); process.exit(1); });
