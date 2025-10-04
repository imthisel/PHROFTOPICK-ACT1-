const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const app = express();
const PORT = 3000;

const db = new sqlite3.Database('./database.db');

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------- SUBJECT ROUTES ----------------

// List all subjects OR search by query
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

// ---------------- PROFESSOR ROUTES ----------------

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

// Get a professor by ID (for prof.html)
app.get('/api/profs/:id', (req, res) => {
  const id = req.params.id;

  db.get(
    `SELECT p.*, s.code as subject_code, s.name as subject_name
     FROM professors p
     LEFT JOIN subjects s ON p.subject_id = s.id
     WHERE p.id = ?`,
    [id],
    (err, prof) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      if (!prof) return res.status(404).json({ error: 'Professor not found' });

      db.all("SELECT * FROM comments WHERE prof_id = ? ORDER BY created_at DESC", [id], (err2, comments) => {
        if (err2) return res.status(500).json({ error: 'DB error' });

        db.all("SELECT * FROM notes WHERE prof_id = ? ORDER BY created_at DESC", [id], (err3, notes) => {
          if (err3) return res.status(500).json({ error: 'DB error' });
          res.json({ prof, comments, notes });
        });
      });
    }
  );
});

// ---------------- START SERVER ----------------
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
