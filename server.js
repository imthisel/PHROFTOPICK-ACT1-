// =================== IMPORTS ===================
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = 3000;
const SECRET = 'supersecretkey'; // change this to your own secret key

// =================== DATABASE ===================
const db = new sqlite3.Database('./database.db');

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// =================== AUTH TABLE SETUP ===================
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id_or_email TEXT UNIQUE,
    password_hash TEXT,
    display_name TEXT,
    anonymous INTEGER DEFAULT 0
  )
`);

// =================== SUBJECT ROUTES ===================

// List all subjects or search
app.get('/api/subjects', (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();

  if (!q) {
    db.all("SELECT id, code, name, difficulty_avg FROM subjects ORDER BY code ASC", [], (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json({ subjects: rows });
    });
  } else {
    const like = `%${q}%`;
    db.all(
      "SELECT id, code, name, difficulty_avg FROM subjects WHERE LOWER(code) LIKE ? OR LOWER(name) LIKE ? ORDER BY code ASC",
      [like, like],
      (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        res.json({ subjects: rows });
      }
    );
  }
});

// Professors for a subject
app.get('/api/subjects/:id/profs', (req, res) => {
  const sid = req.params.id;
  db.all(
    "SELECT id, name, photo_path, rating_avg, rating_count, workload FROM professors WHERE subject_id = ?",
    [sid],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      const profs = rows.map(r => ({ ...r, photo: r.photo_path }));
      res.json({ professors: profs });
    }
  );
});

// =================== PROFESSOR ROUTES ===================

// Search professors globally
app.get('/api/profs/search', (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q) return res.json({ professors: [] });

  const like = `%${q}%`;
  db.all(
    `SELECT p.id, p.name, p.photo_path, s.code as subject_code, s.name as subject_name
     FROM professors p
     LEFT JOIN subjects s ON p.subject_id = s.id
     WHERE LOWER(p.name) LIKE ? OR LOWER(s.name) LIKE ? OR LOWER(s.code) LIKE ?
     LIMIT 50`,
    [like, like, like],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      const profs = rows.map(r => ({ ...r, photo: r.photo_path }));
      res.json({ professors: profs });
    }
  );
});

// Get professor details by ID
app.get('/api/profs/:id', (req, res) => {
  const profId = req.params.id;

  // ✅ Join with subjects to get subject info immediately
  const profQuery = `
    SELECT p.*, s.code AS subject_code, s.name AS subject_name
    FROM professors p
    LEFT JOIN subjects s ON p.subject_id = s.id
    WHERE p.id = ?
  `;

  db.get(profQuery, [profId], (err, prof) => {
    if (err) {
      console.error("Error loading professor:", err);
      return res.status(500).json({ error: "Database error while fetching professor" });
    }

    if (!prof) return res.status(404).json({ error: "Professor not found" });

    // ✅ Fetch comments even if empty
    db.all("SELECT * FROM comments WHERE prof_id = ? ORDER BY created_at DESC", [profId], (err2, comments = []) => {
      if (err2) comments = [];

      // ✅ Fetch notes even if empty
      db.all("SELECT * FROM notes WHERE prof_id = ? ORDER BY created_at DESC", [profId], (err3, notes = []) => {
        if (err3) notes = [];

        // ✅ Always return a full, safe JSON structure
        res.json({
          prof: {
            ...prof,
            rating_avg: prof.rating_avg || 0,
            rating_count: prof.rating_count || 0,
            subject_code: prof.subject_code || "N/A",
            subject_name: prof.subject_name || "N/A"
          },
          comments,
          notes
        });
      });
    });
  });
});


// Post comment (with optional auth)
// Add rating + comment
app.post('/api/profs/:id/rate', (req, res) => {
  const profId = req.params.id;
  const { stars = 0, comment = '', anonymous = false } = req.body || {};

  if (!stars || stars < 1 || stars > 5)
    return res.status(400).json({ error: "Stars must be between 1 and 5" });

  const userDisplay = anonymous ? 'Anonymous' : 'User';

  db.run(
    `INSERT INTO comments (prof_id, display_name, comment, stars, anonymous, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [profId, userDisplay, comment.trim(), stars, anonymous ? 1 : 0],
    function (err) {
      if (err) {
        console.error("SQL Error inserting comment:", err.message);
        return res.status(500).json({ error: 'Failed to save comment' });
      }

      // Update averages after insert
      db.get(
        "SELECT AVG(stars) AS avg, COUNT(*) AS count FROM comments WHERE prof_id = ?",
        [profId],
        (err2, row) => {
          if (err2) return res.status(500).json({ error: 'Failed to calculate averages' });

          const avg = row.avg ? parseFloat(row.avg.toFixed(2)) : 0;
          const count = row.count || 0;

          db.run(
            "UPDATE professors SET rating_avg = ?, rating_count = ? WHERE id = ?",
            [avg, count, profId],
            (err3) => {
              if (err3) return res.status(500).json({ error: 'Failed to update professor rating' });
              res.json({ ok: true, avg, count });
            }
          );
        }
      );
    }
  );
});


// Get subject details + its notes
app.get('/api/subjects/:id', (req, res) => {
  const id = req.params.id;
  db.get("SELECT * FROM subjects WHERE id = ?", [id], (err, subject) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!subject) return res.status(404).json({ error: 'Subject not found' });

    db.all("SELECT * FROM notes WHERE subject_id = ? ORDER BY created_at DESC", [id], (err2, notes) => {
      if (err2) return res.status(500).json({ error: 'DB error' });
      res.json({ subject, notes });
    });
  });
});

// =================== AUTH ROUTES ===================

// ---- SIGNUP ----
app.post('/api/auth/signup', async (req, res) => {
  const { school_id_or_email, password, display_name, anonymous } = req.body;
  if (!school_id_or_email || !password)
    return res.status(400).json({ error: 'Missing fields' });

  try {
    const hash = await bcrypt.hash(password, 10);
    db.run(
      `INSERT INTO users (school_id_or_email, password_hash, display_name, anonymous)
       VALUES (?, ?, ?, ?)`,
      [school_id_or_email, hash, display_name || null, anonymous ? 1 : 0],
      function (err) {
        if (err) return res.status(400).json({ error: 'User already exists' });
        const user = { id: this.lastID, school_id_or_email, display_name };
        const token = jwt.sign({ id: user.id, school_id_or_email }, SECRET);
        res.json({ token, user });
      }
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---- LOGIN ----
app.post('/api/auth/login', (req, res) => {
  const { school_id_or_email, password } = req.body;
  if (!school_id_or_email || !password)
    return res.status(400).json({ error: 'Missing credentials' });

  db.get(
    'SELECT * FROM users WHERE school_id_or_email = ?',
    [school_id_or_email],
    async (err, user) => {
      if (err || !user) return res.status(400).json({ error: 'User not found' });
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) return res.status(400).json({ error: 'Invalid password' });
      const token = jwt.sign({ id: user.id, school_id_or_email }, SECRET);
      res.json({ token, user });
    }
  );
});

// Debug route (for testing if backend is alive)
app.get('/api/debug', (req, res) => res.json({ ok: true }));

// =================== START SERVER ===================
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
