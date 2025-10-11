// =================== IMPORTS ===================
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const SECRET = 'supersecretkey';

// 🧭 Debug Middleware — Log active school for every request
app.use((req, res, next) => {
  const school = req.query.school || 'dlsu';
  console.log('🟢 Active school DB:', school, '→', req.method, req.path);
  next();
});


// =================== MULTI-DATABASE HANDLER ===================
function getDb(school) {
  const dbPath = {
    dlsu: path.join(__dirname, 'databases', 'dlsu.db'),
    ateneo: path.join(__dirname, 'databases', 'ateneo.db'),
    up: path.join(__dirname, 'databases', 'up.db'),
    benilde: path.join(__dirname, 'databases', 'benilde.db')
  }[school] || path.join(__dirname, 'databases', 'dlsu.db');
  return new sqlite3.Database(dbPath);
}

// =================== MIDDLEWARE ===================
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// =================== DATABASE INIT ===================
const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id_or_email TEXT UNIQUE,
  password_hash TEXT,
  display_name TEXT,
  anonymous INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT,
  name TEXT,
  difficulty_avg REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS professors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER,
  name TEXT,
  photo_path TEXT,
  workload TEXT,
  teaching_style TEXT,
  tips TEXT,
  plus_points TEXT,
  rating_avg REAL DEFAULT 0,
  rating_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prof_id INTEGER,
  display_name TEXT,
  comment TEXT,
  stars INTEGER,
  anonymous INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prof_id INTEGER,
  subject_id INTEGER,
  original_name TEXT,
  path TEXT,
  description TEXT,
  anonymous INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

const schools = ['dlsu', 'ateneo', 'up', 'benilde'];

// Ensure ./databases folder exists
const dbDir = path.join(__dirname, 'databases');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);

// Initialize schema for all schools
for (const school of schools) {
  const db = getDb(school);
  db.exec(schema, err => {
    if (err) console.error(`❌ Error creating schema for ${school}:`, err);
    else console.log(`✅ Database ready for ${school}`);
    db.close();
  });
}

// =================== SUBJECT ROUTES ===================
app.get('/api/subjects', (req, res) => {
  const school = req.query.school || 'dlsu';
  const db = getDb(school);
  const q = (req.query.q || '').trim().toLowerCase();

  const sql = q
    ? `SELECT id, code, name, difficulty_avg FROM subjects WHERE LOWER(code) LIKE ? OR LOWER(name) LIKE ? ORDER BY code ASC`
    : `SELECT id, code, name, difficulty_avg FROM subjects ORDER BY code ASC`;
  const params = q ? [`%${q}%`, `%${q}%`] : [];

  db.all(sql, params, (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ subjects: rows });
  });
});

// =================== PROFESSOR ROUTES ===================
app.get('/api/subjects/:id/profs', (req, res) => {
  const school = req.query.school || 'dlsu';
  const db = getDb(school);
  const sid = req.params.id;

  db.all(
    "SELECT id, name, photo_path, rating_avg, rating_count, workload FROM professors WHERE subject_id = ?",
    [sid],
    (err, rows) => {
      db.close();
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json({ professors: rows.map(r => ({ ...r, photo: r.photo_path })) });
    }
  );
});
// =================== PROFESSOR DETAILS ROUTE ===================
app.get('/api/profs/:id', (req, res) => {
  const school = req.query.school || 'dlsu';
  const db = getDb(school);
  const profId = req.params.id;

  db.get('SELECT * FROM professors WHERE id = ?', [profId], (err, prof) => {
    if (err) {
      db.close();
      return res.status(500).json({ error: 'DB error' });
    }

    if (!prof) {
      db.close();
      return res.status(404).json({ error: 'Professor not found' });
    }

    db.all('SELECT * FROM comments WHERE prof_id = ?', [profId], (err2, comments) => {
      if (err2) {
        db.close();
        return res.status(500).json({ error: 'DB error' });
      }

      db.all('SELECT * FROM notes WHERE prof_id = ?', [profId], (err3, notes) => {
        db.close();
        if (err3) return res.status(500).json({ error: 'DB error' });
        res.json({ prof, comments, notes });
      });
    });
  });
});

// =================== POST RATING + COMMENT ROUTE ===================
app.post('/api/profs/:id/rate', (req, res) => {
  const school = req.query.school || 'dlsu';
  const db = getDb(school);
  const profId = req.params.id;
  const { stars = 0, comment = '', anonymous = false } = req.body || {};

  const s = parseInt(stars, 10);
  if (!s || s < 1 || s > 5) {
    db.close();
    return res.status(400).json({ error: 'Stars must be between 1 and 5' });
  }

  const userDisplay = anonymous ? 'Anonymous' : (req.headers['x-user-display'] || 'User');

  db.run(
    `INSERT INTO comments (prof_id, display_name, comment, stars, anonymous, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [profId, userDisplay, comment.trim(), s, anonymous ? 1 : 0],
    function (err) {
      if (err) {
        db.close();
        console.error("❌ SQL Error inserting comment:", err.message);
        return res.status(500).json({ error: 'Failed to save comment' });
      }

      db.get(
        "SELECT AVG(stars) AS avg, COUNT(*) AS count FROM comments WHERE prof_id = ?",
        [profId],
        (err2, row) => {
          if (err2) {
            db.close();
            console.error("❌ SQL Error calculating avg:", err2.message);
            return res.status(500).json({ error: 'Failed to calculate averages' });
          }

          const avg = row && row.avg ? parseFloat(row.avg.toFixed(2)) : 0;
          const count = row ? (row.count || 0) : 0;

          db.run(
            "UPDATE professors SET rating_avg = ?, rating_count = ? WHERE id = ?",
            [avg, count, profId],
            (err3) => {
              db.close();
              if (err3) {
                console.error("❌ SQL Error updating professor:", err3.message);
                return res.status(500).json({ error: 'Failed to update professor rating' });
              }

              res.json({ ok: true, avg, count, newStars: s });
            }
          );
        }
      );
    }
  );
});

// =================== AUTH ===================
app.post('/api/auth/signup', async (req, res) => {
  const school = req.query.school || 'dlsu';
  const db = getDb(school);
  const { school_id_or_email, password, display_name, anonymous } = req.body;

  if (!school_id_or_email || !password) {
    db.close();
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    db.run(
      `INSERT INTO users (school_id_or_email, password_hash, display_name, anonymous)
       VALUES (?, ?, ?, ?)`,
      [school_id_or_email, hash, display_name || null, anonymous ? 1 : 0],
      function (err) {
        db.close();
        if (err) return res.status(400).json({ error: 'User already exists' });
        const user = { id: this.lastID, school_id_or_email, display_name };
        const token = jwt.sign({ id: user.id, school_id_or_email }, SECRET);
        res.json({ token, user });
      }
    );
  } catch (e) {
    db.close();
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const school = req.query.school || 'dlsu';
  const db = getDb(school);
  const { school_id_or_email, password } = req.body;

  if (!school_id_or_email || !password) {
    db.close();
    return res.status(400).json({ error: 'Missing credentials' });
  }

  db.get('SELECT * FROM users WHERE school_id_or_email = ?', [school_id_or_email], async (err, user) => {
    if (err || !user) {
      db.close();
      return res.status(400).json({ error: 'User not found' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    db.close();

    if (!match) return res.status(400).json({ error: 'Invalid password' });

    const token = jwt.sign({ id: user.id, school_id_or_email }, SECRET);
    res.json({ token, user });
  });
});

// =================== START SERVER ===================
app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
