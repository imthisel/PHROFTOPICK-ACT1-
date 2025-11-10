const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const schools = ['dlsu', 'ateneo', 'up', 'benilde'];

const createTableSQL = `
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

console.log('🔧 Starting subject_resources table migration...\n');

schools.forEach(school => {
  const dbPath = path.join(__dirname, 'databases', `${school}.db`);
  const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error(`❌ Failed to open ${school}.db:`, err.message);
      return;
    }

    console.log(`📂 Processing ${school}.db...`);

    db.run(createTableSQL, (err) => {
      if (err) {
        console.error(`❌ Failed to create table in ${school}.db:`, err.message);
      } else {
        console.log(`✅ subject_resources table created/verified in ${school}.db`);
      }

      // Verify table exists
      db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='subject_resources'", (err, row) => {
        if (row) {
          db.all("PRAGMA table_info(subject_resources)", (err, columns) => {
            if (err) {
              console.error(`❌ Failed to get column info for ${school}.db:`, err.message);
            } else {
              console.log(`   📋 Columns in ${school}.db:`, columns.map(c => c.name).join(', '));
            }
            db.close();
          });
        } else {
          console.error(`❌ Table not found in ${school}.db after creation attempt`);
          db.close();
        }
      });
    });
  });
});

console.log('\n🏁 Migration script executed for all schools!');
