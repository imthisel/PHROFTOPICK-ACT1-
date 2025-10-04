const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.db');

db.serialize(() => {
  db.run("DROP TABLE IF EXISTS subjects");
  db.run("DROP TABLE IF EXISTS professors");
  db.run("DROP TABLE IF EXISTS comments");
  db.run("DROP TABLE IF EXISTS notes");

  db.run(`CREATE TABLE subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    difficulty_avg REAL DEFAULT NULL
  )`);

  db.run(`CREATE TABLE professors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    subject_id INTEGER,
    photo_path TEXT,
    rating_avg REAL DEFAULT NULL,
    rating_count INTEGER DEFAULT 0,
    workload TEXT,
    teaching_style TEXT,
    tips TEXT,
    plus_points TEXT,
    FOREIGN KEY(subject_id) REFERENCES subjects(id)
  )`);

  db.run(`CREATE TABLE comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prof_id INTEGER NOT NULL,
    display_name TEXT,
    anonymous INTEGER DEFAULT 0,
    stars INTEGER,
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(prof_id) REFERENCES professors(id)
  )`);

  db.run(`CREATE TABLE notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prof_id INTEGER,
    subject_id INTEGER,
    original_name TEXT,
    path TEXT,
    description TEXT,
    display_name TEXT,
    anonymous INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(prof_id) REFERENCES professors(id),
    FOREIGN KEY(subject_id) REFERENCES subjects(id)
  )`);

  // Sample subjects
  db.run("INSERT INTO subjects (code, name, difficulty_avg) VALUES ('CS101', 'Introduction to Computer Science', 3.2)");
  db.run("INSERT INTO subjects (code, name, difficulty_avg) VALUES ('MATH201', 'Calculus II', 3.8)");
  db.run("INSERT INTO subjects (code, name, difficulty_avg) VALUES ('ENG150', 'Academic Writing', 2.5)");

  // Sample professors
  db.run("INSERT INTO professors (name, subject_id, photo_path, rating_avg, rating_count, workload, teaching_style, tips, plus_points) VALUES ('Dr. Reyes', 1, '/images/reyes.jpg', 4.5, 12, 'Moderate', 'Clear explanations', 'Review weekly', 'Gives bonus points')");
  db.run("INSERT INTO professors (name, subject_id, photo_path, rating_avg, rating_count, workload, teaching_style, tips, plus_points) VALUES ('Prof. Santos', 2, '/images/santos.jpg', 3.8, 8, 'Heavy', 'Challenging but fair', 'Practice problem sets', 'Very approachable')");
  db.run("INSERT INTO professors (name, subject_id, photo_path, rating_avg, rating_count, workload, teaching_style, tips, plus_points) VALUES ('Ms. Cruz', 3, '/images/cruz.jpg', 4.2, 5, 'Light', 'Friendly & supportive', 'Participate actively', 'Good feedback')");
});

db.close();
