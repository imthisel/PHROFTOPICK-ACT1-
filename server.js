// =================== IMPORTS ===================
const express = require('express');
const sqlite3 = require('sqlite3');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken'); // ✅ keep only here
const fs = require('fs');
const multer = require('multer');
const path = require('path');

// near other imports
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
require('dotenv').config();


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

app.use(session({
  secret: process.env.SESSION_SECRET || 'sessionsecret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // set secure:true when using HTTPS
}));

app.use(passport.initialize());
app.use(passport.session());


// =================== DATABASE INIT ===================
const schema = `
/* in server.js - inside your schema string (replace users table definition) */
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id_or_email TEXT UNIQUE,
  email TEXT,
  password_hash TEXT,
  display_name TEXT,
  anonymous INTEGER DEFAULT 0,
  oauth_provider TEXT,
  oauth_id TEXT,
  photo_path TEXT,         -- <- OAuth/profile photo URL
  college TEXT,
  course TEXT,
  batch TEXT,
  username TEXT,
  bio TEXT
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
passport.serializeUser((user, done) => done(null, { id: user.id, school: user.school }));
passport.deserializeUser((obj, done) => done(null, obj));

// Helper to find or create user using SQLite DB for the school
async function findOrCreateUserByOAuth(school, provider, oauthId, profile, done) {
  const db = getDb(school);
  const email = profile.emails && profile.emails[0] && profile.emails[0].value;
  const display = profile.displayName || email || profile.username || 'User';

  // try to extract photo (works for Google and many providers)
  let photo = null;
if (profile.photos && profile.photos.length) photo = profile.photos[0].value;

// fallback avatar (Google accounts almost always have one)
if (!photo && provider === 'google' && profile.id) {
  photo = `https://lh3.googleusercontent.com/a/default-user`;
}


  db.get('SELECT * FROM users WHERE oauth_provider = ? AND oauth_id = ?', [provider, oauthId], (err, user) => {
    if (err) { db.close(); return done(err); }

    if (user) {
      // If user exists but photo is missing and we have one, update
      if (!user.photo_path && photo) {
        db.run('UPDATE users SET photo_path = ? WHERE id = ?', [photo, user.id], (uerr) => {
          db.close();
          if (uerr) console.error('Failed to update photo_path', uerr);
          return done(null, { id: user.id, display_name: user.display_name || user.email || user.school_id_or_email });
        });
        return;
      }
      db.close();
      return done(null, { id: user.id, display_name: user.display_name || user.email || user.school_id_or_email });
    }

    // create user (store photo if any)
    db.run(
      `INSERT INTO users (school_id_or_email, email, display_name, oauth_provider, oauth_id, photo_path)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [email || null, email || null, display, provider, oauthId, photo || null],
      function(err2) {
        db.close();
        if (err2) return done(err2);
        const created = { id: this.lastID, display_name: display, email, photo_path: photo || null };
        return done(null, created);
      }
    );
  });
}


// Google strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: `${process.env.BASE_URL || 'http://localhost:3000'}/auth/google/callback`,
  passReqToCallback: true
}, (req, accessToken, refreshToken, profile, done) => {
  const school = req.query.school || 'dlsu';
  findOrCreateUserByOAuth(school, 'google', profile.id, profile, done);
}));

// Facebook strategy
passport.use(new FacebookStrategy({
  clientID: process.env.FACEBOOK_CLIENT_ID,
  clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
  callbackURL: `${process.env.BASE_URL || 'http://localhost:3000'}/auth/facebook/callback`,
  profileFields: ['id','displayName','email'],
  passReqToCallback: true
}, (req, accessToken, refreshToken, profile, done) => {
  const school = req.query.school || 'dlsu';
  findOrCreateUserByOAuth(school, 'facebook', profile.id, profile, done);
}));

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

// =================== PROFESSOR SEARCH ROUTE (improved + debug) ===================
app.get('/api/profs/search', (req, res) => {
  const school = req.query.school || 'dlsu';
  const db = getDb(school);
  const qRaw = req.query.q || '';
  const q = qRaw.trim();

  console.log(`🔎 /api/profs/search called — school=${school} q="${qRaw}"`);

  if (!q) {
    db.close();
    console.log('  -> empty query, returning []');
    return res.json({ professors: [] });
  }

  // Use COLLATE NOCASE to avoid case sensitivity issues in sqlite
  const sql = `
    SELECT p.id, p.name, p.photo_path,
           s.id AS subject_id, s.code AS subject_code, s.name AS subject_name,
           p.rating_avg, p.rating_count, p.workload
    FROM professors p
    LEFT JOIN subjects s ON p.subject_id = s.id
    WHERE p.name LIKE ? COLLATE NOCASE
       OR s.name LIKE ? COLLATE NOCASE
       OR s.code LIKE ? COLLATE NOCASE
    ORDER BY p.name ASC
  `;
  const like = `%${q}%`;
  const params = [like, like, like];

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('❌ DB error on /api/profs/search:', err);
      db.close();
      return res.status(500).json({ error: 'DB error' });
    }

    console.log(`  -> found ${rows.length} professor(s)`);
    // Normalize fields so front-end sees predictable keys
    const profs = rows.map(r => ({
      id: r.id,
      name: r.name,
      photo_path: r.photo_path,
      subject_id: r.subject_id,
      subject_code: r.subject_code,
      subject_name: r.subject_name,
      rating_avg: r.rating_avg,
      rating_count: r.rating_count,
      workload: r.workload
    }));

    db.close();
    return res.json({ professors: profs });
  });
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
// --- Signup route removed (strict) ---
// The original password signup route has been removed to enforce OAuth-only signups.
// If you need to restore it later, find the commented block below and re-enable it.

/*
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
*/

// New explicit route: respond with 410 Gone to indicate signups are disabled
app.all('/api/auth/signup', (req, res) => {
  // 410 Gone signals this endpoint is intentionally removed
  res.status(410).json({ error: 'Signups disabled. Use Google/Facebook OAuth to create an account.' });
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

// Start OAuth flow
app.get('/auth/google', (req, res, next) => {
  const school = req.query.school || 'dlsu';
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: true,
    state: school // 🔸 store school in OAuth flow
  })(req, res, next);
});
app.get('/auth/facebook', passport.authenticate('facebook', { scope: ['email'], session: true }));

// Callbacks
app.get('/auth/google/callback', (req, res, next) => {
  const school = req.query.state || 'dlsu';
  passport.authenticate('google', {
    failureRedirect: '/auth/failure',
    session: true
  })(req, res, next);
}, (req, res) => {
  const token = jwt.sign({ id: req.user.id }, JWT_SECRET);
  const school = req.query.state || 'dlsu';
  res.redirect(`/oauth-success.html?token=${token}&display=${encodeURIComponent(req.user.display_name)}&school=${school}`);
});


app.get('/auth/facebook/callback', passport.authenticate('facebook', { failureRedirect: '/auth/failure', session: true }), (req, res) => {
  const token = jwt.sign({ id: req.user.id }, JWT_SECRET);
  const school = req.query.school || 'dlsu';
  res.redirect(`/oauth-success.html?token=${token}&display=${encodeURIComponent(req.user.display_name)}&school=${school}`);
});

app.get('/auth/failure', (req, res) => {
  res.status(401).send('Authentication failed');
});

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey'; // use env in production

// middleware: get current user id from Authorization header
function authenticateJWT(req, res, next) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer (.+)$/);
  if (!m) return res.status(401).json({ error: 'Missing token' });
  const token = m[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.id;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// get current user's profile
app.get('/api/me', authenticateJWT, (req, res) => {
  const school = req.query.school || 'dlsu';
  const db = getDb(school);
  db.get('SELECT id, email, display_name, photo_path, college, course, batch, username, bio FROM users WHERE id = ?', [req.userId], (err, row) => {
    db.close();
    if (err || !row) return res.status(500).json({ error: 'User not found' });
    res.json({ user: row });
  });
});

// update current user's profile (partial update)
app.post('/api/me', authenticateJWT, (req, res) => {
  const school = req.query.school || 'dlsu';
  const { display_name, college, course, batch, username, bio, photo_path } = req.body;
  const db = getDb(school);
  db.run(
    `UPDATE users SET display_name = COALESCE(?, display_name),
                       college = COALESCE(?, college),
                       course = COALESCE(?, course),
                       batch = COALESCE(?, batch),
                       username = COALESCE(?, username),
                       bio = COALESCE(?, bio),
                       photo_path = COALESCE(?, photo_path)
     WHERE id = ?`,
    [display_name, college, course, batch, username, bio, photo_path, req.userId],
    function(err) {
      db.close();
      if (err) return res.status(500).json({ error: 'Update failed' });
      res.json({ ok: true });
    }
  );
});


// =================== START SERVER ===================
app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
