// server.js
const express = require('express');
const cors = require('cors');
const bcrypt = require("bcrypt");
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_production';

// make uploads folder
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, safe);
  }
});
const upload = multer({ storage });

// static
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// middleware
app.use(cors());
app.use(express.json());

// SQLite DB
const DBFILE = path.join(__dirname, 'data.sqlite');
const db = new sqlite3.Database(DBFILE);

// init tables
db.serialize(() => {
  db.run(`PRAGMA foreign_keys = ON;`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id_or_email TEXT UNIQUE,
    password_hash TEXT,
    display_name TEXT,
    anonymous INTEGER DEFAULT 0,
    is_subscribed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT,
    name TEXT,
    difficulty_avg REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS professors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER,
    name TEXT,
    photo_path TEXT,
    teaching_style TEXT,
    tips TEXT,
    plus_points TEXT,
    workload TEXT,
    rating_avg REAL DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(subject_id) REFERENCES subjects(id) ON DELETE CASCADE
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS prof_ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prof_id INTEGER,
    user_id INTEGER,
    stars INTEGER,
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(prof_id) REFERENCES professors(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prof_id INTEGER,
    subject_id INTEGER,
    user_id INTEGER,
    original_name TEXT,
    path TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(prof_id) REFERENCES professors(id),
    FOREIGN KEY(subject_id) REFERENCES subjects(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );`);

  db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    method TEXT,
    plan TEXT,
    amount REAL,
    active INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );`);
});

// helper functions
function signToken(user) {
  return jwt.sign({ id: user.id, display_name: user.display_name, anonymous: user.anonymous }, JWT_SECRET, { expiresIn: '14d' });
}

function authenticateToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Missing authorization header' });
  const token = auth.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Bad authorization format' });
  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err) return res.status(401).json({ error: 'Invalid token' });
    req.user = payload;
    next();
  });
}

/* ========== AUTH ========== */

// signup
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { school_id_or_email, password, display_name, anonymous } = req.body;
    if (!school_id_or_email || !password) return res.status(400).json({ error: 'Provide school id/email and password' });
    const pwHash = await bcrypt.hash(password, 10);
    const stmt = db.prepare(`INSERT INTO users (school_id_or_email, password_hash, display_name, anonymous) VALUES (?, ?, ?, ?)`);
    stmt.run(school_id_or_email, pwHash, display_name || school_id_or_email, anonymous ? 1 : 0, function(err) {
      if (err) return res.status(400).json({ error: 'Account creation failed (maybe duplicate)' });
      const user = { id: this.lastID, display_name: display_name || school_id_or_email, anonymous: anonymous ? 1 : 0 };
      const token = signToken(user);
      res.json({ ok: true, token, user });
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error during signup' });
  }
});

// login
app.post('/api/auth/login', (req, res) => {
  const { school_id_or_email, password } = req.body;
  if (!school_id_or_email || !password) return res.status(400).json({ error: 'Provide school id/email and password' });
  db.get(`SELECT id, password_hash, display_name, anonymous FROM users WHERE school_id_or_email = ?`, [school_id_or_email], async (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row) return res.status(400).json({ error: 'User not found' });
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid password' });
    const user = { id: row.id, display_name: row.display_name, anonymous: row.anonymous };
    const token = signToken(user);
    res.json({ ok: true, token, user });
  });
});

/* ========== SUBJECTS & PROFESSORS ========== */

// Add example subject/prof (admin use) - for testing / prefill
app.post('/api/admin/prefill', (req, res) => {
  // no auth in this demo; in production protect this route
  const subjects = [
    { code: 'CS101', name: 'Intro to Programming' },
    { code: 'MATH101', name: 'Calculus I' },
    { code: 'ENG101', name: 'English Communication' }
  ];
  db.serialize(() => {
    const sstmt = db.prepare(`INSERT INTO subjects (code, name) VALUES (?, ?)`);
    subjects.forEach(s => sstmt.run(s.code, s.name));
    sstmt.finalize(() => {
      // add sample professors
      db.get(`SELECT id FROM subjects WHERE code = ?`, ['CS101'], (err, row) => {
        if (row) {
          const sid = row.id;
          const pstmt = db.prepare(`INSERT INTO professors (subject_id, name, photo_path, teaching_style, tips, plus_points, workload) VALUES (?, ?, ?, ?, ?, ?, ?)`);
          pstmt.run(sid, 'Dr. Maria Santos', '/uploads/sample_prof1.jpg', 'Lecture + Projects', 'Attend labs, study examples', 'Clear slides; helpful office hours', 'Medium-high');
          pstmt.run(sid, 'Prof. John Dela Cruz', '/uploads/sample_prof2.jpg', 'Discussion-based', 'Read before class', 'Strict on deadlines', 'High');
          pstmt.finalize(() => res.json({ ok: true, message: 'Prefill done' }));
        } else res.json({ ok: true, message: 'Subjects prefilling incomplete' });
      });
    });
  });
});

// search subjects (by code or name)
app.get('/api/subjects', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) {
    db.all(`SELECT * FROM subjects ORDER BY name LIMIT 50`, [], (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json({ subjects: rows });
    });
  } else {
    const like = `%${q}%`;
    db.all(`SELECT * FROM subjects WHERE code LIKE ? OR name LIKE ? ORDER BY name LIMIT 50`, [like, like], (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json({ subjects: rows });
    });
  }
});

// get professors for a subject
app.get('/api/subjects/:id/profs', (req, res) => {
  const sid = req.params.id;
  db.all(`SELECT id, name, photo_path, rating_avg, rating_count, workload FROM professors WHERE subject_id = ?`, [sid], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ professors: rows });
  });
});

// get professor details + comments + notes
app.get('/api/profs/:id', (req, res) => {
  const pid = req.params.id;
  db.get(`SELECT p.*, s.code as subject_code, s.name as subject_name FROM professors p LEFT JOIN subjects s ON p.subject_id = s.id WHERE p.id = ?`, [pid], (err, prof) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!prof) return res.status(404).json({ error: 'Professor not found' });
    db.all(`SELECT pr.stars, pr.comment, pr.created_at, u.display_name, u.anonymous FROM prof_ratings pr LEFT JOIN users u ON pr.user_id = u.id WHERE pr.prof_id = ? ORDER BY pr.created_at DESC LIMIT 200`, [pid], (err2, comments) => {
      if (err2) return res.status(500).json({ error: 'DB error' });
      db.all(`SELECT n.id, n.original_name, n.path, n.description, n.created_at, u.display_name, u.anonymous FROM notes n LEFT JOIN users u ON n.user_id = u.id WHERE n.prof_id = ? ORDER BY n.created_at DESC LIMIT 200`, [pid], (err3, notes) => {
        if (err3) return res.status(500).json({ error: 'DB error' });
        res.json({ prof: prof, comments: comments, notes: notes });
      });
    });
  });
});

/* ========== RATING, COMMENT, subject difficulty ========== */

// rate professor (stars 1-5) + optional comment
app.post('/api/profs/:id/rate', authenticateToken, (req, res) => {
  const pid = req.params.id;
  const uid = req.user.id;
  const { stars, comment } = req.body;
  if (!stars || stars < 1 || stars > 5) return res.status(400).json({ error: 'stars 1-5 required' });

  db.serialize(() => {
    const stmt = db.prepare(`INSERT INTO prof_ratings (prof_id, user_id, stars, comment) VALUES (?, ?, ?, ?)`);
    stmt.run(pid, uid, stars, comment || null, function(err) {
      if (err) return res.status(500).json({ error: 'DB error when inserting rating' });
      // update professor average & count
      db.get(`SELECT AVG(stars) as avg, COUNT(*) as cnt FROM prof_ratings WHERE prof_id = ?`, [pid], (err2, row) => {
        if (err2) return res.status(500).json({ error: 'DB error when calculating avg' });
        const avg = row.avg || 0;
        const cnt = row.cnt || 0;
        db.run(`UPDATE professors SET rating_avg = ?, rating_count = ? WHERE id = ?`, [avg, cnt, pid], (err3) => {
          if (err3) return res.status(500).json({ error: 'DB error when updating prof' });
          res.json({ ok: true, avg, cnt });
        });
      });
    });
  });
});

// rate subject difficulty
app.post('/api/subjects/:id/difficulty', authenticateToken, (req, res) => {
  const sid = req.params.id;
  const { difficulty } = req.body; // expected 1-5
  if (!difficulty || difficulty < 1 || difficulty > 5) return res.status(400).json({ error: 'difficulty 1-5 required' });
  // naive: store per-subject average by taking average of all professor rating_avg for that subject
  db.get(`SELECT AVG(rating_avg) as avg FROM professors WHERE subject_id = ?`, [sid], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    const subjectAvg = row.avg || difficulty;
    // we combine with new difficulty (simple moving average formula)
    const newAvg = (subjectAvg + difficulty) / 2;
    db.run(`UPDATE subjects SET difficulty_avg = ? WHERE id = ?`, [newAvg, sid], (err2) => {
      if (err2) return res.status(500).json({ error: 'DB error' });
      res.json({ ok: true, difficulty: newAvg });
    });
  });
});

/* ========== NOTES UPLOAD ========== */

// upload notes (requires auth)
app.post('/api/upload', authenticateToken, upload.single('note'), (req, res) => {
  const file = req.file;
  const { prof_id, subject_id, description } = req.body;
  const uid = req.user.id;
  if (!file) return res.status(400).json({ error: 'File is required' });
  const original = file.originalname;
  const pathRel = '/uploads/' + path.basename(file.path);
  db.run(`INSERT INTO notes (prof_id, subject_id, user_id, original_name, path, description) VALUES (?, ?, ?, ?, ?, ?)`,
    [prof_id || null, subject_id || null, uid, original, pathRel, description || null],
    function(err) {
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json({ ok: true, noteId: this.lastID, path: pathRel });
    });
});

/* ========== SUBSCRIPTIONS (SIMULATED) ========== */

app.post('/api/subscribe', authenticateToken, (req, res) => {
  // in production you'd integrate GCash or payment gateway; here we simulate
  const uid = req.user.id;
  const { method, plan } = req.body; // method: gcash/card, plan: monthly/yearly/term
  if (!method || !plan) return res.status(400).json({ error: 'method & plan required' });
  const amount = plan === 'monthly' ? 30 : plan === 'yearly' ? 300 : 100;
  db.run(`INSERT INTO subscriptions (user_id, method, plan, amount, active) VALUES (?, ?, ?, ?, ?)`, [uid, method, plan, amount, 1], function(err) {
    if (err) return res.status(500).json({ error: 'DB error' });
    db.run(`UPDATE users SET is_subscribed = 1 WHERE id = ?`, [uid]);
    res.json({ ok: true, message: 'Subscription simulated (active)', amount });
  });
});

/* ========== SEARCH PROFESSORS BY NAME (global) ========== */
app.get('/api/profs/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ professors: [] });
  const like = `%${q}%`;
  db.all(`SELECT p.id, p.name, p.photo_path, s.code as subject_code, s.name as subject_name FROM professors p LEFT JOIN subjects s ON p.subject_id = s.id WHERE p.name LIKE ? OR s.name LIKE ? LIMIT 50`, [like, like], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ professors: rows });
  });
});

/* ========== START ========== */

// fallback route: serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
