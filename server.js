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


const app = express();
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey'; // unified secret


// 🧭 Debug Middleware — Log active school for every request
app.use((req, res, next) => {
  const school = req.query.school || 'dlsu';
  console.log('🟢 Active school DB:', school, '→', req.method, req.path);
  next();
});


// =================== MULTI-DATABASE HANDLER ===================
function resolveDbPath(school) {
  const dbPathRelative = {
    dlsu: path.join('databases', 'dlsu.db'),
    ateneo: path.join('databases', 'ateneo.db'),
    up: path.join('databases', 'up.db'),
    benilde: path.join('databases', 'benilde.db')
  }[school] || path.join('databases', 'dlsu.db');


  return path.resolve(__dirname, dbPathRelative);
}


function getDb(school) {
  const dbPath = resolveDbPath(school);
  console.log(`📂 Opening SQLite DB for school="${school}" -> ${dbPath}`);
  try {
    // Use OPEN_READWRITE | OPEN_CREATE to create if doesn't exist
    return new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
  } catch (e) {
    console.error(`❌ Failed to open DB at ${dbPath}:`, e.message);
    throw e;
  }
}


// =================== MIDDLEWARE ===================
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));


app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: './databases' }),
  secret: process.env.SESSION_SECRET || 'sessionsecret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Set true if you later use HTTPS
}));




app.use(passport.initialize());
app.use(passport.session());


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
`;


const schools = ['dlsu', 'ateneo', 'up', 'benilde'];
const dbDir = path.join(__dirname, 'databases');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);


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
    : `SELECT id, code, name, difficulty_avg FROM subjects ORDER BY code ASC`;
  const params = q ? [`%${q}%`, `%${q}%`] : [];


  db.all(sql, params, (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: 'DB error' });
res.json({ subjects: rows }); // ✅ Match frontend expectation
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

  // If query exists, search
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
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) return res.status(401).json({ error: 'Login required' });

  let user;
  try { user = jwt.verify(token, JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Invalid token' }); }

  const {
    course_code, would_take_again, attainable_4, deadline_leniency,
    workload_rating, tags, review_text, anonymous, rating
  } = req.body;

  // Fetch user profile data
  db.get('SELECT display_name, photo_path, college, batch FROM users WHERE id = ?', [user.id], (err, userData) => {
    if (err) {
      db.close();
      return res.status(500).json({ error: 'Failed to fetch user data' });
    }

    const displayName = anonymous ? null : (userData?.display_name || user.display_name || 'User');
    const photoPath = anonymous ? null : (userData?.photo_path || null);
    const college = anonymous ? null : (userData?.college || null);
    const batchId = anonymous ? null : (userData?.batch || null);
    const ratingValue = parseInt(rating) || 0;

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
      profId, user.id, displayName, anonymous ? 1 : 0,
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
      let attainable4Yes = 0;
      let attainable4No = 0;
      let deadlineLenientYes = 0;
      let deadlineLenientNo = 0;
      const workloadCounts = { Low: 0, Medium: 0, High: 0 };
      let totalRating = 0;
      let ratingCount = 0;

      rows.forEach(r => {
        if (r.would_take_again === 'Yes') wouldTakeAgainYes++;
        if (r.would_take_again === 'No') wouldTakeAgainNo++;
        if (r.attainable_4 === 'Yes') attainable4Yes++;
        if (r.attainable_4 === 'No') attainable4No++;
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
        attainable_4: {
          yes: attainable4Yes,
          no: attainable4No,
          yes_percent: total > 0 ? Math.round((attainable4Yes / total) * 100) : 0,
          no_percent: total > 0 ? Math.round((attainable4No / total) * 100) : 0
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
// Simple password-based admin authentication
// Set ADMIN_PASSWORD environment variable or change the default below
// To change password: Update the value after || or set ADMIN_PASSWORD in .env file
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'niggerstoplooking'; // ⚠️ CHANGE THIS PASSWORD!

app.get('/api/admin/users', (req, res) => {
  const password = req.query.password || req.headers['x-admin-password'] || '';
  
  // Simple password check (you can make this more secure)
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized. Invalid admin password.' });
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
