const fs = require('fs');
const path = require('path');

// Backup databases to prevent data loss
const dbDir = path.join(__dirname, 'databases');
const backupDir = path.join(__dirname, 'backups');

// Create backup directory if it doesn't exist
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
  console.log('📁 Created backup directory:', backupDir);
}

// Backup function
function backupDatabase(dbName) {
  const sourcePath = path.join(dbDir, dbName);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `${dbName}-${timestamp}.backup`);
  
  if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, backupPath);
    console.log(`✅ Backed up ${dbName} to ${backupPath}`);
    
    // Keep only last 10 backups per database
    const backups = fs.readdirSync(backupDir)
      .filter(file => file.startsWith(dbName) && file.endsWith('.backup'))
      .sort()
      .reverse();
    
    if (backups.length > 10) {
      const toDelete = backups.slice(10);
      toDelete.forEach(file => {
        fs.unlinkSync(path.join(backupDir, file));
        console.log(`🗑️ Deleted old backup: ${file}`);
      });
    }
  }
}

// Backup all databases
const databases = ['dlsu.db', 'ateneo.db', 'up.db', 'benilde.db', 'sessions.sqlite'];
databases.forEach(backupDatabase);

// Also snapshot uploaded files
function backupUploads() {
  const uploadsDir = path.join(__dirname, 'public', 'uploads');
  if (!fs.existsSync(uploadsDir)) return;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destDir = path.join(backupDir, `uploads-${timestamp}`);
  fs.mkdirSync(destDir, { recursive: true });
  fs.cpSync(uploadsDir, destDir, { recursive: true });
  // Keep only last 5 upload snapshots
  const uploadBackups = fs.readdirSync(backupDir)
    .filter(f => f.startsWith('uploads-'))
    .sort()
    .reverse();
  if (uploadBackups.length > 5) {
    uploadBackups.slice(5).forEach(f => {
      fs.rmSync(path.join(backupDir, f), { recursive: true, force: true });
      console.log(`🗑️ Deleted old uploads backup: ${f}`);
    });
  }
}
backupUploads();

console.log('🔄 Backup completed (databases + uploads)');
