const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// SAFE SEED SCRIPT - Only creates sample data if tables are empty
// This will NOT delete existing data!

const schools = ['dlsu', 'ateneo', 'up', 'benilde'];

function resolveDbPath(school) {
  const dbPathRelative = {
    dlsu: path.join('databases', 'dlsu.db'),
    ateneo: path.join('databases', 'ateneo.db'),
    up: path.join('databases', 'up.db'),
    benilde: path.join('databases', 'benilde.db')
  }[school] || path.join('databases', 'dlsu.db');

  return path.resolve(__dirname, dbPathRelative);
}

function seedSchool(school) {
  const dbPath = resolveDbPath(school);
  
  if (!fs.existsSync(dbPath)) {
    console.log(`❌ Database for ${school} does not exist. Please start the server first.`);
    return;
  }

  const db = new sqlite3.Database(dbPath);
  
  console.log(`🌱 Seeding sample data for ${school}...`);
  
  // Check if subjects table is empty
  db.get("SELECT COUNT(*) as count FROM subjects", (err, row) => {
    if (err) {
      console.error(`❌ Error checking subjects for ${school}:`, err);
      db.close();
      return;
    }
    
    if (row.count > 0) {
      console.log(`ℹ️ ${school} already has ${row.count} subjects - skipping seed`);
      db.close();
      return;
    }
    
    // Insert sample subjects
    const subjects = [
      ['CS101', 'Introduction to Computer Science', 3.2],
      ['CS102', 'Data Structures and Algorithms', 4.1],
      ['MATH201', 'Calculus II', 3.8],
      ['ENG150', 'Academic Writing', 2.5],
      ['PHYS101', 'General Physics', 3.6]
    ];
    
    subjects.forEach(subject => {
      db.run("INSERT INTO subjects (code, name, difficulty_avg) VALUES (?, ?, ?)", subject);
    });
    
    console.log(`✅ Added ${subjects.length} subjects for ${school}`);
    
    // Insert sample professors
    const professors = [
      ['Dr. Reyes', 1, '/images/reyes.jpg', 4.5, 12, 'Moderate', 'Clear explanations', 'Review weekly', 'Gives bonus points'],
      ['Prof. Santos', 2, '/images/santos.jpg', 3.8, 8, 'Heavy', 'Challenging but fair', 'Practice problem sets', 'Very approachable'],
      ['Ms. Cruz', 3, '/images/cruz.jpg', 4.2, 5, 'Light', 'Friendly & supportive', 'Participate actively', 'Good feedback'],
      ['Dr. Lee', 4, '/images/lee.jpg', 3.9, 15, 'Moderate', 'Engaging lectures', 'Complete readings', 'Accessible outside class'],
      ['Prof. Garcia', 5, '/images/garcia.jpg', 4.1, 10, 'Heavy', 'Hands-on approach', 'Attend lab sessions', 'Patient with questions']
    ];
    
    professors.forEach(prof => {
      db.run(`INSERT INTO professors (name, subject_id, photo_path, rating_avg, rating_count, workload, teaching_style, tips, plus_points) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, prof);
    });
    
    console.log(`✅ Added ${professors.length} professors for ${school}`);
    db.close();
  });
}

// Seed all schools
schools.forEach(seedSchool);
console.log('🎉 Safe seeding completed!');
