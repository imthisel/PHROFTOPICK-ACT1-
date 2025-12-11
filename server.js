// =================== IMPORTS ===================
const express = require('express');
const sqlite3 = require('sqlite3');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
require('dotenv').config();

// Auto-backup databases on server start
console.log('🔄 Creating database backups before starting...');
try {
  require('./backup-databases.js');
} catch (e) {
  console.warn('⚠️ Backup failed:', e.message);
}


const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';
const ENV = process.env.NODE_ENV || 'development';
const DB_DIR = (() => {
  const renderDisk = process.env.RENDER_DISK_PATH || process.env.DATA_DIR;
  if (ENV === 'production') {
    return renderDisk || path.join('/var', 'data', 'databases');
  }
  const base = process.env.DB_DIR || path.join(__dirname, 'databases');
  try { return path.join(base, ENV); } catch (_) { return base; }
})();

// Admin roles and helpers
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin-secret';
const ADMIN_PASSWORD_VIEWER = process.env.ADMIN_PASSWORD_VIEWER || 'admin-view';
const ADMIN_PASSWORD_MOD = process.env.ADMIN_PASSWORD_MOD || 'admin-mod';
const ADMIN_PASSWORD_ADMIN = process.env.ADMIN_PASSWORD_ADMIN || ADMIN_PASSWORD;

function issueAdminToken(role) {
  return jwt.sign({ role, iat: Math.floor(Date.now()/1000) }, JWT_SECRET, { expiresIn: '2h' });
}

function authenticateAdmin(req, res, next) {
  const hdr = req.headers['authorization'] || req.headers['x-admin-token'] || req.query.token;
  if (!hdr) return res.status(401).json({ error: 'Missing admin token' });
  const token = String(hdr).startsWith('Bearer ') ? String(hdr).slice(7) : String(hdr);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.adminRole = payload.role || 'viewer';
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid admin token' });
  }
}


// 🧭 Debug Middleware — Log active school for every request
app.use((req, res, next) => {
  const school = req.query.school || 'dlsu';
  console.log('🟢 Active school DB:', school, '→', req.method, req.path);
  next();
});


// =================== MULTI-DATABASE HANDLER ===================
function resolveDbPath(school) {
  const fileName = {
    dlsu: 'dlsu.db',
    ateneo: 'ateneo.db',
    up: 'up.db',
    benilde: 'benilde.db'
  }[school] || 'dlsu.db';
  return path.resolve(DB_DIR, fileName);
}


function getDb(school) {
  const dbPath = resolveDbPath(school);
  console.log(`📂 Opening SQLite DB for school="${school}" -> ${dbPath}`);
  try {
    // Use OPEN_READWRITE | OPEN_CREATE to create if doesn't exist
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
    
    // Configure SQLite for better durability and performance
    db.serialize(() => {
      // Use WAL mode for better concurrent access and crash recovery
      db.run("PRAGMA journal_mode = WAL");
      // Autocheckpoint WAL to avoid losing recent writes if wal files are cleaned
      db.run("PRAGMA wal_autocheckpoint = 100");
      // Ensure data is written to disk immediately
      db.run("PRAGMA synchronous = FULL");
      // Enable foreign key constraints
      db.run("PRAGMA foreign_keys = ON");
      // Optimize for better performance
      db.run("PRAGMA cache_size = 10000");
      db.run("PRAGMA temp_store = MEMORY");
    });
    
    return db;
  } catch (e) {
    console.error(`❌ Failed to open DB at ${dbPath}:`, e.message);
    throw e;
  }
}

// =================== PERSISTENCE SAFETY CHECKS ===================
(function persistenceChecks(){
  try {
    const dirStat = fs.existsSync(DB_DIR) ? 'exists' : 'missing';
    console.log(`🗄️ DB_DIR: ${DB_DIR} (${dirStat}), ENV=${ENV}`);
    if (ENV === 'production') {
      const isRepoPath = DB_DIR.startsWith(__dirname);
      if (isRepoPath) {
        console.warn('⚠️ DB_DIR points inside repo in production. Configure persistent disk via RENDER_DISK_PATH or DATA_DIR.');
      }
    }
  } catch (e) {
    console.warn('Persistence checks failed:', e.message);
  }
})();


// =================== MIDDLEWARE ===================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((err, req, res, next) => {
  console.error('Request error:', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'Internal server error' });
});

process.on('uncaughtException', (e) => {
  console.error('Uncaught exception:', e && e.stack ? e.stack : e);
});
process.on('unhandledRejection', (e) => {
  console.error('Unhandled rejection:', e);
});

app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: DB_DIR }),
  secret: process.env.SESSION_SECRET || 'sessionsecret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false,
    maxAge: 30 * 24 * 60 * 60 * 1000
  },
  rolling: true
}));

app.use(passport.initialize());
app.use(passport.session());

// Serve landing page at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

// Protect index.html behind login
app.get('/index.html', (req, res, next) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.redirect('/home.html');
  }
  next();
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));
// Serve uploaded files even if UPLOADS_DIR is outside /public
// uploadsDir is initialized later; serving is configured after initialization


// =================== DATABASE INIT ===================
const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id_or_email TEXT UNIQUE,
  email TEXT,
  password_hash TEXT,
  display_name TEXT,
  anonymous INTEGER DEFAULT 0,
  oauth_provider TEXT,
  oauth_id TEXT,
  photo_path TEXT,
  college TEXT,
  course TEXT,
  batch TEXT,
  username TEXT,
  bio TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT,
  name TEXT,
  difficulty_avg REAL DEFAULT 0,
  user_generated INTEGER DEFAULT 0
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

CREATE TABLE IF NOT EXISTS prof_reviews (
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

CREATE TABLE IF NOT EXISTS prof_subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prof_id INTEGER NOT NULL,
  subject_id INTEGER NOT NULL,
  FOREIGN KEY (prof_id) REFERENCES professors(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id)
);

CREATE TABLE IF NOT EXISTS admin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT,
  details TEXT,
  admin_role TEXT,
  school TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;


const schools = ['dlsu', 'ateneo', 'up', 'benilde'];
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });


// Create DB only if missing
for (const school of schools) {
  const dbPath = resolveDbPath(school);
  if (fs.existsSync(dbPath)) {
    console.log(`ℹ️ DB for ${school} already exists at ${dbPath} — skipping schema.`);
    continue;
  }
  console.log(`✨ Creating DB for ${school} at ${dbPath}`);
  const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
  db.exec(schema, err => {
    if (err) console.error(`❌ Error creating schema for ${school}:`, err);
    else console.log(`✅ Database ready for ${school}`);
    db.close();
  });
}

// Ensure subject_resources table exists for all schools
const subjectResourcesSQL = `
CREATE TABLE IF NOT EXISTS subject_resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  title TEXT,
  description TEXT,
  anonymous INTEGER DEFAULT 0,
  display_name TEXT,
  photo_path TEXT,
  college TEXT,
  batch TEXT,
  download_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
)`;
for (const school of schools) {
  const db = getDb(school);
  db.run(subjectResourcesSQL, err => {
    if (err) console.error(`subject_resources ensure failed for ${school}:`, err.message);
    db.close();
  });
}

// =================== PASSPORT ===================
passport.serializeUser((user, done) => done(null, { id: user.id, school: user.school }));
passport.deserializeUser((obj, done) => done(null, obj));


async function findOrCreateUserByOAuth(school, provider, oauthId, profile, done) {
  const db = getDb(school);
  const email = profile.emails?.[0]?.value;
  const display = profile.displayName || email || profile.username || 'User';
  let photo = profile.photos?.[0]?.value || null;
  if (!photo && provider === 'google' && profile.id)
    photo = `https://lh3.googleusercontent.com/a/default-user`;


  db.get('SELECT * FROM users WHERE oauth_provider = ? AND oauth_id = ?', [provider, oauthId], (err, user) => {
    if (err) { db.close(); return done(err); }


    if (user) {
      if (!user.photo_path && photo) {
        db.run('UPDATE users SET photo_path = ? WHERE id = ?', [photo, user.id], (uerr) => {
          db.close();
          if (uerr) console.error('Failed to update photo_path', uerr);
          return done(null, { id: user.id, display_name: user.display_name });
        });
        return;
      }
      db.close();
      return done(null, { id: user.id, display_name: user.display_name });
    }


    db.run(
      `INSERT INTO users (school_id_or_email, email, display_name, oauth_provider, oauth_id, photo_path)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [email, email, display, provider, oauthId, photo],
      function (err2) {
        db.close();
        if (err2) return done(err2);
        return done(null, { id: this.lastID, display_name: display });
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
  profileFields: ['id', 'displayName', 'email'],
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
    : `SELECT id, code, name, difficulty_avg FROM subjects WHERE user_generated = 0 ORDER BY code ASC`;
  const params = q ? [`%${q}%`, `%${q}%`] : [];


  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error('Subjects query error:', err && err.message ? err.message : err);
      db.close();
      return res.status(500).json({ error: 'DB error' });
    }
    try { console.log(`[subjects] school=${school} count=${rows.length}`); } catch (_) {}
    db.close();
    res.json({ subjects: rows });
  });
});

// =================== ADMIN AUTH ===================
app.post('/api/admin/login', (req, res) => {
  const password = (req.body && req.body.password) || req.query.password || '';
  let role = null;
  if (password === ADMIN_PASSWORD_ADMIN) role = 'admin';
  else if (password === ADMIN_PASSWORD_MOD) role = 'moderator';
  else if (password === ADMIN_PASSWORD_VIEWER) role = 'viewer';
  if (!role) return res.status(401).json({ error: 'Invalid password' });
  const token = issueAdminToken(role);
  res.json({ token, role });
});

function logAdminAction(adminRole, action, details, school) {
  try {
    const db = getDb(school || 'dlsu');
    db.run('INSERT INTO admin_logs (action, details, admin_role, school) VALUES (?,?,?,?)', [action, details, adminRole, school || 'dlsu'], () => db.close());
  } catch (_) {}
}

// Create user-generated subject
app.post('/api/subjects/create', (req, res) => {
  const school = req.query.school || 'dlsu';
  const db = getDb(school);
  const code = (req.body?.code || '').trim();
  const name = (req.body?.name || '').trim();
  const codeRe = /^[A-Z]{7}$/;
  const nameRe = /^[A-Z]{7}\s-\s.+$/;
  if (!codeRe.test(code)) { db.close(); return res.status(400).json({ error: 'Invalid course code' }); }
  if (!nameRe.test(name)) { db.close(); return res.status(400).json({ error: 'Invalid course name format' }); }

  db.get('SELECT id FROM subjects WHERE code = ?', [code], (err, row) => {
    if (err) { db.close(); return res.status(500).json({ error: 'DB error' }); }
    if (row) { db.close(); return res.status(409).json({ error: 'Course code already exists' }); }
    db.run('INSERT INTO subjects (code, name, user_generated) VALUES (?, ?, 1)', [code, name], function (err2) {
      db.close();
      if (err2) return res.status(500).json({ error: 'Insert failed' });
      res.json({ ok: true, id: this.lastID });
    });
  });
});


// =================== PROFESSOR ROUTES ===================
app.get('/api/subjects/:id/profs', (req, res) => {
  const school = req.query.school || 'dlsu';
  const db = getDb(school);
  db.all(
    "SELECT id, name, photo_path, rating_avg, rating_count, workload FROM professors WHERE subject_id = ?",
    [req.params.id],
    (err, rows) => {
      db.close();
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json({ professors: rows.map(r => ({ ...r, photo: r.photo_path })) });
    }
  );
});


// =================== PROFESSOR SEARCH ===================
app.get('/api/profs/search', (req, res) => {
  const school = req.query.school || 'dlsu';
  const db = getDb(school);
  const q = (req.query.q || '').trim();
  console.log(`🔎 Search prof — school=${school}, q="${q}"`);

  // If no query, return all professors
  if (!q) {
    const sql = `
      SELECT p.id, p.name, p.photo_path,
             s.id AS subject_id, s.code AS subject_code, s.name AS subject_name,
             p.rating_avg, p.rating_count, p.workload
      FROM professors p
      LEFT JOIN subjects s ON p.subject_id = s.id
      ORDER BY p.name ASC
    `;
    db.all(sql, [], (err, rows) => {
      db.close();
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json({ professors: rows });
    });
    return;
  }

  // If query exists, search (include user-generated subjects)
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

  db.all(sql, [like, like, like], (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ professors: rows });
  });
});


// Create professor for one or more existing courses
app.post('/api/professors', (req, res) => {
  const school = req.query.school || 'dlsu';
  const db = getDb(school);
  const name = (req.body?.name || '').trim();
  const courses = Array.isArray(req.body?.courses) ? req.body.courses : [];

  const nameRe = /^[A-Za-z'\-\s]+,\s[A-Za-z'\-\s]+$/;
  const codeRe = /^[A-Z]{7}$/;
  if (!nameRe.test(name)) { db.close(); return res.status(400).json({ error: 'Invalid name format' }); }
  if (!courses.length || !courses.every(c => codeRe.test(String(c)))) {
    db.close();
    return res.status(400).json({ error: 'Invalid course codes' });
  }

  db.serialize(() => {
    const placeholders = courses.map(() => '?').join(',');
    db.all(`SELECT id, code FROM subjects WHERE code IN (${placeholders})`, courses, (err, rows) => {
      if (err) { db.close(); return res.status(500).json({ error: 'DB error' }); }
      const foundCodes = new Set(rows.map(r => r.code));
      const missing = courses.filter(c => !foundCodes.has(c));
      if (missing.length) { db.close(); return res.status(400).json({ error: `Unknown course codes: ${missing.join(', ')}` }); }

      const created = [];
      const stmt = db.prepare(`INSERT INTO professors (subject_id, name) VALUES (?, ?)`);
      for (const row of rows) {
        stmt.run([row.id, name], function (e) {
          if (e) console.error('Insert prof failed', e);
          else created.push({ id: this.lastID, subject_id: row.id });
        });
      }
      stmt.finalize(err2 => {
        if (err2) { db.close(); return res.status(500).json({ error: 'Insert failed' }); }
        db.close();
        return res.json({ ok: true, created });
      });
    });
  });
});

// =================== PROFESSOR DETAILS ===================
app.get('/api/profs/:id', (req, res) => {
  const school = req.query.school || 'dlsu';
  const db = getDb(school);
  const id = req.params.id;


  db.get('SELECT * FROM professors WHERE id = ?', [id], (err, prof) => {
    if (err || !prof) {
      db.close();
      return res.status(404).json({ error: 'Professor not found' });
    }
    db.all('SELECT * FROM comments WHERE prof_id = ?', [id], (err2, comments) => {
      if (err2) { db.close(); return res.status(500).json({ error: 'DB error' }); }
      db.all('SELECT * FROM notes WHERE prof_id = ?', [id], (err3, notes) => {
        db.close();
        if (err3) return res.status(500).json({ error: 'DB error' });
        res.json({ prof, comments, notes });
      });
    });
  });
});


// =================== RATE PROFESSOR ===================
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
      if (err) { db.close(); return res.status(500).json({ error: 'Save failed' }); }


      db.get("SELECT AVG(stars) AS avg, COUNT(*) AS count FROM comments WHERE prof_id = ?", [profId], (err2, row) => {
        if (err2) { db.close(); return res.status(500).json({ error: 'Average error' }); }
        const avg = row?.avg ? parseFloat(row.avg.toFixed(2)) : 0;
        const count = row?.count || 0;
        db.run("UPDATE professors SET rating_avg = ?, rating_count = ? WHERE id = ?", [avg, count, profId], err3 => {
          db.close();
          if (err3) return res.status(500).json({ error: 'Update failed' });
          res.json({ ok: true, avg, count, newStars: s });
        });
      });
    }
  );
});
// =================== CREATE PROFESSOR REVIEW ===================
app.post('/api/profs/:id/review', (req, res) => {
  const school = req.query.school || 'dlsu';
  const db = getDb(school);
  const profId = req.params.id;
  
  console.log('📝 Review submission request received');
  console.log('🔍 Session authenticated:', !!req.user);
  console.log('🔍 Session user ID:', req.user?.id);
  
  // Check if user is authenticated via session (primary method)
  if (!req.user || !req.user.id) {
    console.error('❌ User not authenticated via session');
    return res.status(401).json({ error: 'Login required' });
  }
  
  const userId = req.user.id;
  console.log('✅ User authenticated via session, ID:', userId);

  const {
    course_code, would_take_again, attainable_4, deadline_leniency,
    workload_rating, tags, review_text, anonymous, rating
  } = req.body;

  // Fetch user profile data from database (same data used in settings.html)
  db.get('SELECT display_name, photo_path, college, batch FROM users WHERE id = ?', [userId], (err, userData) => {
    if (err) {
      console.error('Failed to fetch user data for review:', err);
      db.close();
      return res.status(500).json({ error: 'Failed to fetch user data' });
    }

    if (!userData) {
      console.warn('User not found in database:', userId);
      db.close();
      return res.status(404).json({ error: 'User not found' });
    }

    // Use profile data from database for review card
    const displayName = anonymous ? null : (userData.display_name || 'User');
    const photoPath = anonymous ? null : (userData.photo_path || null);
    const college = anonymous ? null : (userData.college || null);
    const batchId = anonymous ? null : (userData.batch || null);
    const ratingValue = parseInt(rating) || 0;

    console.log('📝 Creating review with user data:', {
      userId: userId,
      displayName: displayName || 'Anonymous',
      college: college || 'N/A',
      batch: batchId || 'N/A',
      anonymous
    });

    // Insert review directly (table already has all columns)
    db.run(`
      INSERT INTO prof_reviews (
        prof_id, user_id, display_name, anonymous,
        course_code, would_take_again, attainable_4,
        deadline_leniency, workload_rating, tags, review_text,
        rating, college, batch_id, photo_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      profId, userId, displayName, anonymous ? 1 : 0,
      course_code, would_take_again, attainable_4,
      deadline_leniency, workload_rating, tags, review_text,
      ratingValue, college, batchId, photoPath
    ],
    function(insertErr) {
      if (insertErr) {
        db.close();
        return res.status(500).json({ error: 'DB error: ' + insertErr.message });
      }

      const reviewId = this.lastID;

      // Update professor rating average and count based on review ratings
      if (ratingValue > 0) {
        db.get("SELECT AVG(rating) AS avg, COUNT(*) AS count FROM prof_reviews WHERE prof_id = ? AND rating > 0", [profId], (err2, row) => {
          if (!err2 && row) {
            const avg = row.avg ? parseFloat(row.avg.toFixed(2)) : 0;
            const count = row.count || 0;
            db.run("UPDATE professors SET rating_avg = ?, rating_count = ? WHERE id = ?", [avg, count, profId], (err3) => {
              db.close();
              if (err3) console.error('Failed to update professor rating:', err3);
              res.json({ ok: true, review_id: reviewId });
            });
          } else {
            db.close();
            res.json({ ok: true, review_id: reviewId });
          }
        });
      } else {
        db.close();
        res.json({ ok: true, review_id: reviewId });
      }
    });
  });
});

// =================== GET PROFESSOR REVIEWS ===================
app.get('/api/profs/:id/reviews', (req, res) => {
  const school = req.query.school || 'dlsu';
  const db = getDb(school);

  db.all(
    "SELECT id, prof_id, user_id, display_name, anonymous, course_code, would_take_again, attainable_4, deadline_leniency, workload_rating, tags, review_text, rating, college, batch_id, photo_path, view_count, created_at FROM prof_reviews WHERE prof_id = ? ORDER BY created_at DESC",
    [req.params.id],
    (err, rows) => {
      db.close();
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json({ reviews: rows });
    }
  );
});

// =================== GET REVIEW SUMMARY ===================
app.get('/api/profs/:id/review-summary', (req, res) => {
  const school = req.query.school || 'dlsu';
  const db = getDb(school);
  const profId = req.params.id;

  db.all(
    "SELECT would_take_again, attainable_4, deadline_leniency, workload_rating, rating FROM prof_reviews WHERE prof_id = ?",
    [profId],
    (err, rows) => {
      if (err) {
        db.close();
        return res.status(500).json({ error: 'DB error' });
      }

      const total = rows.length;
      let wouldTakeAgainYes = 0;
      let wouldTakeAgainNo = 0;
      const attainabilityCounts = { Easy: 0, Fair: 0, Hard: 0 };
      let deadlineLenientYes = 0;
      let deadlineLenientNo = 0;
      const workloadCounts = { Low: 0, Medium: 0, High: 0 };
      let totalRating = 0;
      let ratingCount = 0;

      rows.forEach(r => {
        if (r.would_take_again === 'Yes') wouldTakeAgainYes++;
        if (r.would_take_again === 'No') wouldTakeAgainNo++;
        if (r.attainable_4 && attainabilityCounts.hasOwnProperty(r.attainable_4)) {
          attainabilityCounts[r.attainable_4] = (attainabilityCounts[r.attainable_4] || 0) + 1;
        }
        if (r.deadline_leniency === 'Yes') deadlineLenientYes++;
        if (r.deadline_leniency === 'No') deadlineLenientNo++;
        if (r.workload_rating) workloadCounts[r.workload_rating] = (workloadCounts[r.workload_rating] || 0) + 1;
        if (r.rating && r.rating > 0) {
          totalRating += r.rating;
          ratingCount++;
        }
      });

      db.close();
      res.json({
        total,
        would_take_again: {
          yes: wouldTakeAgainYes,
          no: wouldTakeAgainNo,
          yes_percent: total > 0 ? Math.round((wouldTakeAgainYes / total) * 100) : 0,
          no_percent: total > 0 ? Math.round((wouldTakeAgainNo / total) * 100) : 0
        },
        attainability: {
          Easy: attainabilityCounts.Easy,
          Fair: attainabilityCounts.Fair,
          Hard: attainabilityCounts.Hard,
          Easy_percent: total > 0 ? Math.round((attainabilityCounts.Easy / total) * 100) : 0,
          Fair_percent: total > 0 ? Math.round((attainabilityCounts.Fair / total) * 100) : 0,
          Hard_percent: total > 0 ? Math.round((attainabilityCounts.Hard / total) * 100) : 0
        },
        deadline_leniency: {
          yes: deadlineLenientYes,
          no: deadlineLenientNo,
          yes_percent: total > 0 ? Math.round((deadlineLenientYes / total) * 100) : 0,
          no_percent: total > 0 ? Math.round((deadlineLenientNo / total) * 100) : 0
        },
        workload: workloadCounts,
        average_rating: ratingCount > 0 ? parseFloat((totalRating / ratingCount).toFixed(2)) : 0,
        rating_count: ratingCount
      });
    }
  );
});

// =================== INCREMENT REVIEW VIEW COUNT ===================
app.post('/api/reviews/:id/view', (req, res) => {
  const school = req.query.school || 'dlsu';
  const db = getDb(school);
  const reviewId = req.params.id;

  db.run(
    "UPDATE prof_reviews SET view_count = COALESCE(view_count, 0) + 1 WHERE id = ?",
    [reviewId],
    function(err) {
      db.close();
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json({ ok: true });
    }
  );
});


// =================== AUTH ===================
app.all('/api/auth/signup', (req, res) => {
  res.status(410).json({ error: 'Signups disabled. Use Google/Facebook OAuth.' });
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
    const token = jwt.sign({ id: user.id, school_id_or_email, school }, JWT_SECRET);
    res.json({ token, user });
  });
});


// OAuth Start
app.get('/auth/google', (req, res, next) => {
  const school = req.query.school || 'dlsu';
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: true,
    state: school
  })(req, res, next);
});


app.get('/auth/facebook', passport.authenticate('facebook', { scope: ['email'], session: true }));


// OAuth Callbacks
app.get('/auth/google/callback', (req, res, next) => {
  const school = req.query.state || 'dlsu';
  passport.authenticate('google', {
    failureRedirect: '/auth/failure',
    session: true
  })(req, res, next);
}, (req, res) => {
  const school = req.query.state || 'dlsu';
  const db = getDb(school);
  
  // ✅ Fetch fresh user data to include photo
  db.get('SELECT id, display_name, photo_path FROM users WHERE id = ?', [req.user.id], (err, user) => {
    db.close();
    
    if (err || !user) {
      return res.redirect('/auth/failure');
    }
    
    // after user created / found in DB
const token = jwt.sign({ id: user.id, school }, JWT_SECRET);
const photoParam = user.photo_path ? `&photo=${encodeURIComponent(user.photo_path)}` : '';
res.redirect(`/oauth-success.html?token=${token}&display=${encodeURIComponent(user.display_name || 'You')}&school=${school}${photoParam}`);

  });
});


app.get('/auth/facebook/callback', passport.authenticate('facebook', { failureRedirect: '/auth/failure', session: true }), (req, res) => {
  const school = req.query.school || 'dlsu';
  const token = jwt.sign({ id: req.user.id, school }, JWT_SECRET);
  res.redirect(`/oauth-success.html?token=${token}&display=${encodeURIComponent(req.user.display_name)}&school=${school}`);
});


app.get('/auth/failure', (req, res) => {
  res.status(401).send('Authentication failed');
});


// JWT middleware
function authenticateJWT(req, res, next) {
  const auth = req.headers.authorization || '';
  const match = auth.match(/^Bearer (.+)$/);
  if (!match) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(match[1], JWT_SECRET);
    req.userId = payload.id;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}


// Profile routes
app.get('/api/me', authenticateJWT, (req, res) => {
  const school = req.query.school || 'dlsu';
  const db = getDb(school);
  db.get('SELECT id, email, display_name, photo_path, college, course, batch, username, bio FROM users WHERE id = ?', [req.userId], (err, row) => {
    db.close();
if (err || !row) return res.status(401).json({ error: 'User not found' });
    res.json({ user: row });
  });
});


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
    err => {
      db.close();
      if (err) return res.status(500).json({ error: 'Update failed' });
      res.json({ ok: true });
    }
  );
});


// =================== ADMIN ROUTES ===================
// Backward-compatible users endpoint (supports token or password)

app.get('/api/admin/users', (req, res) => {
  const hdr = req.headers['authorization'] || req.headers['x-admin-token'];
  let authorized = false;
  if (hdr) {
    try { jwt.verify(hdr.startsWith('Bearer ') ? hdr.slice(7) : hdr, JWT_SECRET); authorized = true; } catch (_) {}
  }
  if (!authorized) {
    const password = req.query.password || req.headers['x-admin-password'] || '';
    const ok = [ADMIN_PASSWORD_ADMIN, ADMIN_PASSWORD_MOD, ADMIN_PASSWORD_VIEWER].includes(password);
    if (!ok) return res.status(401).json({ error: 'Unauthorized.' });
  }

  const school = req.query.school || 'dlsu';
  
  // If 'all', query all schools
  if (school === 'all') {
    const allUsers = [];
    const schools = ['dlsu', 'ateneo', 'up', 'benilde'];
    
    Promise.all(schools.map(s => {
      return new Promise((resolve, reject) => {
        try {
          const db = getDb(s);
          
          // First ensure table and columns exist
          db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              school_id_or_email TEXT UNIQUE,
              email TEXT,
              password_hash TEXT,
              display_name TEXT,
              anonymous INTEGER DEFAULT 0,
              oauth_provider TEXT,
              oauth_id TEXT,
              photo_path TEXT,
              college TEXT,
              course TEXT,
              batch TEXT,
              username TEXT,
              bio TEXT
            )`, () => {
              // Add missing columns
              const cols = ['college', 'course', 'batch', 'username', 'bio'];
              let colIndex = 0;
              const addNextCol = () => {
                if (colIndex >= cols.length) {
                  // All columns added, now query
                  db.all('SELECT id, email, display_name, school_id_or_email, oauth_provider, college, course, batch, username FROM users ORDER BY id DESC', [], (err, rows) => {
                    db.close();
                    if (err) {
                      console.error(`Error querying ${s} database:`, err);
                      resolve();
                      return;
                    }
                    if (rows) {
                      rows.forEach(row => {
                        row.school = s.toUpperCase();
                        allUsers.push(row);
                      });
                    }
                    resolve();
                  });
                } else {
                  db.run(`ALTER TABLE users ADD COLUMN ${cols[colIndex]} TEXT`, () => {
                    colIndex++;
                    addNextCol();
                  });
                }
              };
              addNextCol();
            });
          });
        } catch (error) {
          console.error(`Error opening ${s} database:`, error);
          resolve();
        }
      });
    })).then(() => {
      res.json({ users: allUsers });
    }).catch((error) => {
      console.error('Error in Promise.all:', error);
      res.status(500).json({ error: 'Database error: ' + error.message });
    });
    return;
  }

  // Query single school
  try {
    const db = getDb(school);
    
    // First, ensure the users table exists and has all columns
    db.serialize(() => {
      // Create table if it doesn't exist
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        school_id_or_email TEXT UNIQUE,
        email TEXT,
        password_hash TEXT,
        display_name TEXT,
        anonymous INTEGER DEFAULT 0,
        oauth_provider TEXT,
        oauth_id TEXT,
        photo_path TEXT,
        college TEXT,
        course TEXT,
        batch TEXT,
        username TEXT,
        bio TEXT
      )`, (err) => {
        if (err) {
          db.close();
          console.error(`Error creating users table for ${school}:`, err);
          return res.status(500).json({ error: 'Database error: ' + err.message });
        }
        
        // Add missing columns if they don't exist (for existing databases)
        // SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we try and ignore errors
        const columnsToAdd = [
          { name: 'college', type: 'TEXT' },
          { name: 'course', type: 'TEXT' },
          { name: 'batch', type: 'TEXT' },
          { name: 'username', type: 'TEXT' },
          { name: 'bio', type: 'TEXT' }
        ];
        
        let pendingOps = columnsToAdd.length;
        const tryAddColumn = (index) => {
          if (index >= columnsToAdd.length) {
            // All columns processed, now query
            queryUsers();
            return;
          }
          
          const col = columnsToAdd[index];
          db.run(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`, (err) => {
            // Ignore error if column already exists (SQLite error code 1)
            if (err && !err.message.includes('duplicate column name') && !err.message.includes('duplicate')) {
              console.warn(`Could not add column ${col.name} for ${school}:`, err.message);
            }
            // Continue to next column
            tryAddColumn(index + 1);
          });
        };
        
        const queryUsers = () => {
          db.all(
            'SELECT id, email, display_name, school_id_or_email, oauth_provider, college, course, batch, username FROM users ORDER BY id DESC',
            [],
            (err, rows) => {
              db.close();
              if (err) {
                console.error(`Database error for ${school}:`, err);
                return res.status(500).json({ error: 'Database error: ' + err.message });
              }
              res.json({ users: rows || [] });
            }
          );
        };
        
        // Start adding columns
        tryAddColumn(0);
      });
    });
  } catch (error) {
    console.error(`Error opening database for ${school}:`, error);
    res.status(500).json({ error: 'Failed to open database: ' + error.message });
  }
});

// Admin: extended users with activity counts
app.get('/api/admin/users-extended', authenticateAdmin, (req, res) => {

  const school = req.query.school || 'dlsu';

  const buildUsersForSchool = (s) => new Promise((resolve) => {
    const db = getDb(s);
    const sql = `
      SELECT u.id, u.email, u.display_name, u.school_id_or_email, u.oauth_provider,
             u.college, u.course, u.batch, u.username,
             (SELECT COUNT(1) FROM comments c WHERE c.display_name = u.display_name) AS comments_count,
             (SELECT COUNT(1) FROM prof_reviews r WHERE r.user_id = u.id) AS reviews_count,
             (SELECT COUNT(1) FROM subject_resources sr WHERE sr.user_id = u.id) AS notes_count
      FROM users u
      ORDER BY u.id DESC`;
    db.all(sql, [], (err, rows) => {
      db.close();
      if (err) return resolve({ school: s, users: [], error: err.message });
      resolve({ school: s, users: rows });
    });
  });

  if (school === 'all') {
    const schools = ['dlsu', 'ateneo', 'up', 'benilde'];
    Promise.all(schools.map(buildUsersForSchool)).then(results => {
      const merged = [];
      results.forEach(r => {
        (r.users || []).forEach(u => merged.push({ ...u, school: r.school.toUpperCase() }));
      });
      res.json({ users: merged });
    }).catch(e => res.status(500).json({ error: e.message }));
    return;
  }

  buildUsersForSchool(school).then(r => res.json({ users: r.users || [] }))
    .catch(e => res.status(500).json({ error: e.message }));
});

// Admin: summary stats
app.get('/api/admin/summary', authenticateAdmin, (req, res) => {
  const school = req.query.school || 'dlsu';

  const summaryForSchool = (s) => new Promise((resolve) => {
    const db = getDb(s);
    const result = { school: s };
    db.serialize(() => {
      db.get('SELECT COUNT(1) AS c FROM users', [], (e1, r1) => {
        result.users = r1?.c || 0;
        db.get('SELECT COUNT(1) AS c FROM subjects', [], (e2, r2) => {
          result.subjects = r2?.c || 0;
          db.get('SELECT COUNT(1) AS c FROM professors', [], (e3, r3) => {
            result.professors = r3?.c || 0;
            db.get('SELECT COUNT(1) AS c FROM comments', [], (e4, r4) => {
              result.comments = r4?.c || 0;
              db.get('SELECT COUNT(1) AS c FROM prof_reviews', [], (e5, r5) => {
                result.reviews = r5?.c || 0;
                db.get('SELECT COUNT(1) AS c FROM subject_resources', [], (e6, r6) => {
                  result.resources = r6?.c || 0;
                  db.close();
                  resolve(result);
                });
              });
            });
          });
        });
      });
    });
  });

  if (school === 'all') {
    const schools = ['dlsu', 'ateneo', 'up', 'benilde'];
    Promise.all(schools.map(summaryForSchool)).then(list => {
      const total = list.reduce((acc, s) => ({
        users: acc.users + s.users,
        subjects: acc.subjects + s.subjects,
        professors: acc.professors + s.professors,
        comments: acc.comments + s.comments,
        reviews: acc.reviews + s.reviews,
        resources: acc.resources + s.resources
      }), { users:0, subjects:0, professors:0, comments:0, reviews:0, resources:0 });
      res.json({ totals: total, per_school: list });
    }).catch(e => res.status(500).json({ error: e.message }));
    return;
  }

  summaryForSchool(school).then(s => res.json(s)).catch(e => res.status(500).json({ error: e.message }));
});

// Admin: recent activity
app.get('/api/admin/activity', authenticateAdmin, (req, res) => {
  const school = req.query.school || 'dlsu';
  const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 100);

  const activityForSchool = (s) => new Promise((resolve) => {
    const db = getDb(s);
    const out = { school: s, comments: [], reviews: [], resources: [] };
    db.all('SELECT * FROM comments ORDER BY created_at DESC LIMIT ?', [limit], (e1, c) => {
      out.comments = c || [];
      db.all('SELECT * FROM prof_reviews ORDER BY created_at DESC LIMIT ?', [limit], (e2, r) => {
        out.reviews = r || [];
        db.all('SELECT * FROM subject_resources ORDER BY created_at DESC LIMIT ?', [limit], (e3, n) => {
          out.resources = n || [];
          db.close();
          resolve(out);
        });
      });
    });
  });

  if (school === 'all') {
    const schools = ['dlsu', 'ateneo', 'up', 'benilde'];
    Promise.all(schools.map(activityForSchool)).then(results => res.json({ activity: results }))
      .catch(e => res.status(500).json({ error: e.message }));
    return;
  }
  activityForSchool(school).then(a => res.json(a)).catch(e => res.status(500).json({ error: e.message }));
});

// Admin moderation endpoints
app.post('/api/admin/comments/:id/flag', authenticateAdmin, (req, res) => {
  if (!['moderator','admin'].includes(req.adminRole)) return res.status(403).json({ error: 'Forbidden' });
  const school = req.query.school || 'dlsu';
  const id = req.params.id;
  const db = getDb(school);
  db.run('UPDATE comments SET comment = comment || "\n[FLAGGED]" WHERE id = ?', [id], function (err) {
    db.close();
    if (err) return res.status(500).json({ error: 'DB error' });
    logAdminAction(req.adminRole, 'flag_comment', `id=${id}`, school);
    res.json({ ok: true });
  });
});

app.post('/api/admin/comments/:id/edit', authenticateAdmin, (req, res) => {
  if (!['moderator','admin'].includes(req.adminRole)) return res.status(403).json({ error: 'Forbidden' });
  const school = req.query.school || 'dlsu';
  const id = req.params.id;
  const text = (req.body && req.body.comment) || '';
  if (!text.trim()) return res.status(400).json({ error: 'Comment text required' });
  const db = getDb(school);
  db.run('UPDATE comments SET comment = ? WHERE id = ?', [text, id], function (err) {
    db.close();
    if (err) return res.status(500).json({ error: 'DB error' });
    logAdminAction(req.adminRole, 'edit_comment', `id=${id}`, school);
    res.json({ ok: true });
  });
});

app.delete('/api/admin/comments/:id', authenticateAdmin, (req, res) => {
  if (req.adminRole !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const school = req.query.school || 'dlsu';
  const id = req.params.id;
  const db = getDb(school);
  console.warn(`🗑️ Admin delete comment id=${id} by role=${req.adminRole} school=${school}`);
  db.run('DELETE FROM comments WHERE id = ?', [id], function (err) {
    db.close();
    if (err) return res.status(500).json({ error: 'DB error' });
    logAdminAction(req.adminRole, 'delete_comment', `id=${id}`, school);
    res.json({ ok: true });
  });
});

// Comment trends
app.get('/api/admin/comment-trends', authenticateAdmin, (req, res) => {
  const school = req.query.school || 'dlsu';
  const days = Math.min(parseInt(req.query.days || '14', 10) || 14, 60);
  const db = getDb(school);
  const sql = `
    SELECT DATE(created_at) AS day, COUNT(1) AS count
    FROM comments
    WHERE created_at >= DATE('now', ?)
    GROUP BY DATE(created_at)
    ORDER BY DATE(created_at) ASC
  `;
  db.all(sql, [`-${days} days`], (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ days, series: rows });
  });
});

// Activity SSE
app.get('/api/admin/activity/stream', authenticateAdmin, (req, res) => {
  const school = req.query.school || 'dlsu';
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  let timer = setInterval(async () => {
    try {
      const db = getDb(school);
      const out = { comments: [], reviews: [], resources: [] };
      await new Promise(r => db.all('SELECT * FROM comments ORDER BY created_at DESC LIMIT 5', [], (e, rows)=>{ out.comments = rows||[]; r(); }));
      await new Promise(r => db.all('SELECT * FROM prof_reviews ORDER BY created_at DESC LIMIT 5', [], (e, rows)=>{ out.reviews = rows||[]; r(); }));
      await new Promise(r => db.all('SELECT * FROM subject_resources ORDER BY created_at DESC LIMIT 5', [], (e, rows)=>{ out.resources = rows||[]; r(); }));
      db.close();
      res.write(`data: ${JSON.stringify(out)}\n\n`);
    } catch (_) {}
  }, 5000);
  req.on('close', () => { clearInterval(timer); });
});

// =================== FILE UPLOAD CONFIGURATION ===================
// Ensure uploads directory exists (configurable for persistent disks)
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 Created uploads directory:', uploadsDir);
}

// Serve uploaded files even if UPLOADS_DIR is outside /public
app.use('/uploads', express.static(uploadsDir));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, name + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    // Allow all file types for study materials
    cb(null, true);
  }
});

// =================== SUBJECT RESOURCES API ===================
// Get subject details with resource count
app.get('/api/subjects/:id', (req, res) => {
  const school = req.query.school || 'dlsu';
  const db = getDb(school);
  const subjectId = req.params.id;

  db.get('SELECT * FROM subjects WHERE id = ?', [subjectId], (err, subject) => {
    if (err) {
      db.close();
      return res.status(500).json({ error: 'Database error' });
    }
    if (!subject) {
      db.close();
      return res.status(404).json({ error: 'Subject not found' });
    }

    // Get resource and contributor counts
    db.get(`
      SELECT 
        COUNT(*) as resourceCount,
        COUNT(DISTINCT user_id) as contributorCount
      FROM subject_resources 
      WHERE subject_id = ?
    `, [subjectId], (err2, stats) => {
      db.close();
      if (err2) return res.json({ subject, resourceCount: 0, contributorCount: 0 });
      res.json({
        subject,
        resourceCount: stats?.resourceCount || 0,
        contributorCount: stats?.contributorCount || 0
      });
    });
  });
});

// Get all resources for a subject
app.get('/api/subjects/:id/resources', (req, res) => {
  const school = req.query.school || 'dlsu';
  const db = getDb(school);
  const subjectId = req.params.id;

  db.all(`
    SELECT 
      sr.*,
      u.display_name,
      u.photo_path,
      u.college,
      u.batch
    FROM subject_resources sr
    LEFT JOIN users u ON sr.user_id = u.id
    WHERE sr.subject_id = ?
    ORDER BY sr.created_at DESC
  `, [subjectId], (err, resources) => {
    db.close();
    if (err) {
      console.error('Failed to fetch resources:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ resources: resources || [] });
  });
});

app.get('/api/resources/recent', (req, res) => {
  const school = req.query.school || 'dlsu';
  const db = getDb(school);
  const limit = Math.min(parseInt(req.query.limit || '5', 10) || 5, 10);
  const sql = `
    SELECT sr.id, sr.subject_id, sr.file_name, sr.file_path, sr.file_size, sr.title, sr.description, sr.anonymous,
           sr.display_name, sr.photo_path, sr.college, sr.batch, sr.created_at,
           s.code AS subject_code, s.name AS subject_name
    FROM subject_resources sr
    LEFT JOIN subjects s ON sr.subject_id = s.id
    ORDER BY sr.created_at DESC
    LIMIT ?`;
  db.all(sql, [limit], (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ resources: rows || [] });
  });
});

app.get('/api/reviews/recent', (req, res) => {
  const school = req.query.school || 'dlsu';
  const db = getDb(school);
  const limit = Math.min(parseInt(req.query.limit || '5', 10) || 5, 10);
  const sql = `
    SELECT pr.id, pr.prof_id, pr.user_id, pr.display_name, pr.anonymous, pr.course_code, pr.review_text, pr.rating, pr.created_at,
           p.name AS professor_name,
           s.code AS subject_code, s.name AS subject_name
    FROM prof_reviews pr
    LEFT JOIN professors p ON pr.prof_id = p.id
    LEFT JOIN subjects s ON p.subject_id = s.id
    ORDER BY pr.created_at DESC
    LIMIT ?`;
  db.all(sql, [limit], (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json({ reviews: rows || [] });
  });
});

// Upload a resource
app.post('/api/subjects/:id/upload', upload.single('file'), (req, res) => {
  const school = req.query.school || 'dlsu';
  const db = getDb(school);
  const subjectId = req.params.id;

  console.log('📤 File upload request received');
  console.log('🔍 Session user:', req.user);
  console.log('🔍 File:', req.file);

  // Check authentication
  if (!req.user || !req.user.id) {
    if (req.file) fs.unlinkSync(req.file.path); // Clean up uploaded file
    db.close();
    return res.status(401).json({ error: 'Login required' });
  }

  if (!req.file) {
    db.close();
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const userId = req.user.id;
  const { title, description, anonymous } = req.body;
  const isAnonymous = anonymous === '1';

  // Get user data
  db.get('SELECT display_name, photo_path, college, batch FROM users WHERE id = ?', [userId], (err, userData) => {
    if (err || !userData) {
      console.error('Failed to fetch user data:', err);
      if (req.file) fs.unlinkSync(req.file.path);
      db.close();
      return res.status(500).json({ error: 'Failed to fetch user data' });
    }

    const filePath = '/uploads/' + req.file.filename;
    
    db.run(`
      INSERT INTO subject_resources (
        subject_id, user_id, file_name, file_path, file_size, title,
        description, anonymous, display_name, photo_path, college, batch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      subjectId,
      userId,
      req.file.originalname,
      filePath,
      req.file.size,
      title || req.file.originalname,
      description || null,
      isAnonymous ? 1 : 0,
      isAnonymous ? null : userData.display_name,
      isAnonymous ? null : userData.photo_path,
      isAnonymous ? null : userData.college,
      isAnonymous ? null : userData.batch
    ], function(insertErr) {
      db.close();
      if (insertErr) {
        console.error('Failed to insert resource:', insertErr);
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(500).json({ error: 'Failed to save resource' });
      }

      console.log('✅ Resource uploaded successfully, ID:', this.lastID);
      res.json({
        success: true,
        resourceId: this.lastID,
        filePath: filePath
      });
    });
  });
});

// Upload user profile photo
app.post('/api/me/photo', authenticateJWT, upload.single('photo'), (req, res) => {
  const school = req.query.school || 'dlsu';
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const db = getDb(school);
  const filePath = '/uploads/' + req.file.filename;
  db.run('UPDATE users SET photo_path = ? WHERE id = ?', [filePath, req.userId], err => {
    db.close();
    if (err) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(500).json({ error: 'Update failed' });
    }
    res.json({ ok: true, photo_path: filePath });
  });
});

// Track download count
app.post('/api/resources/:id/download', (req, res) => {
  const school = req.query.school || 'dlsu';
  const db = getDb(school);
  const resourceId = req.params.id;

  db.run('UPDATE subject_resources SET download_count = download_count + 1 WHERE id = ?', [resourceId], (err) => {
    db.close();
    if (err) {
      console.error('Failed to update download count:', err);
      return res.status(500).json({ error: 'Failed to track download' });
    }
    res.json({ success: true });
  });
});

// =================== DEBUG ROUTE ===================
app.get('/api/debug/dbinfo', (req, res) => {
  const school = req.query.school || 'dlsu';
  const dbPath = resolveDbPath(school);
  if (!fs.existsSync(dbPath)) return res.json({ exists: false, dbPath });
  const stats = fs.statSync(dbPath);
  res.json({ school, dbPath, exists: true, size: stats.size, mtime: stats.mtime });
});


// =================== START SERVER ===================
app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
// Performance: safe migrations + indexes
for (const s of ['dlsu','ateneo','up','benilde']) {
  try {
    const db = getDb(s);
    db.serialize(() => {
      const addColumnIfMissing = (table, column, decl) => {
        db.all(`PRAGMA table_info(${table})`, [], (e, rows) => {
          if (e) { console.warn(`[${s}] pragma ${table} failed:`, e.message); return; }
          const has = (rows || []).some(r => String(r.name).toLowerCase() === column.toLowerCase());
          if (!has) {
            db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`, (err) => {
              if (err) console.warn(`[${s}] add ${table}.${column} failed:`, err.message);
            });
          }
        });
      };

      addColumnIfMissing('comments','created_at','TEXT');
      addColumnIfMissing('prof_reviews','created_at','TEXT');
      addColumnIfMissing('users','created_at','TEXT');
      addColumnIfMissing('subject_resources','created_at','TEXT');
      addColumnIfMissing('subjects','user_generated','INTEGER DEFAULT 0');

      // Create indexes guarded with callbacks (avoid crashing on missing columns)
      db.run('CREATE INDEX IF NOT EXISTS idx_comments_prof ON comments(prof_id)', (e)=>{ if(e) console.warn(`[${s}] idx_comments_prof`, e.message); });
      db.run('CREATE INDEX IF NOT EXISTS idx_comments_created ON comments(created_at)', (e)=>{ if(e) console.warn(`[${s}] idx_comments_created`, e.message); });
      db.run('CREATE INDEX IF NOT EXISTS idx_reviews_user ON prof_reviews(user_id)', (e)=>{ if(e) console.warn(`[${s}] idx_reviews_user`, e.message); });
      db.run('CREATE INDEX IF NOT EXISTS idx_reviews_created ON prof_reviews(created_at)', (e)=>{ if(e) console.warn(`[${s}] idx_reviews_created`, e.message); });
      db.run('CREATE INDEX IF NOT EXISTS idx_resources_user ON subject_resources(user_id)', (e)=>{ if(e) console.warn(`[${s}] idx_resources_user`, e.message); });
      db.run('CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at)', (e)=>{ if(e) console.warn(`[${s}] idx_users_created`, e.message); });
    });
  } catch (e) {
    console.warn(`[${s}] index/migration failed`, e.message);
  }
}
