const fs = require('fs');
const path = require('path');

// Backup databases to prevent data loss
const ENV = process.env.NODE_ENV || 'development';
const DB_DIR = (() => {
  const isWritable = (dir) => {
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); return true; } catch (_) { return false; }
  };
  const withDbSubdir = (p) => (typeof p === 'string' ? path.join(p, 'databases') : p);
  if (ENV === 'production') {
    const candidatesRaw = [];
    if (process.env.DB_DIR) candidatesRaw.push(process.env.DB_DIR);
    if (process.env.RENDER_DISK_PATH) candidatesRaw.push(process.env.RENDER_DISK_PATH);
    if (process.env.DATA_DIR) candidatesRaw.push(process.env.DATA_DIR);
    candidatesRaw.push(path.join('/var','data'));
    const candidates = candidatesRaw.map(withDbSubdir);
    for (const c of candidates) { if (isWritable(c)) return c; }
    return path.join(__dirname, 'databases');
  }
  const base = process.env.DB_DIR || path.join(__dirname, 'databases');
  try { return path.join(base, ENV); } catch (_) { return base; }
})();
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DB_DIR, 'backups');

// Create backup directory if it doesn't exist
try {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    console.log('📁 Created backup directory:', BACKUP_DIR);
  }
} catch (e) {
  console.warn('⚠️ Backup directory ensure failed:', e.message);
}

// Backup function
function backupDatabase(dbName) {
  const sourcePath = path.join(DB_DIR, dbName);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `${dbName}-${timestamp}.backup`);
  
  if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, backupPath);
    console.log(`✅ Backed up ${dbName} to ${backupPath}`);
    
    // Keep only last 10 backups per database
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(file => file.startsWith(dbName) && file.endsWith('.backup'))
      .sort()
      .reverse();
    
    if (backups.length > 10) {
      const toDelete = backups.slice(10);
      toDelete.forEach(file => {
        fs.unlinkSync(path.join(BACKUP_DIR, file));
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
  const uploadsDir = process.env.UPLOADS_DIR || (ENV === 'production' ? path.join('/var','data','uploads') : path.join(__dirname, 'public', 'uploads'));
  if (!fs.existsSync(uploadsDir)) return;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destDir = path.join(BACKUP_DIR, `uploads-${timestamp}`);
  fs.mkdirSync(destDir, { recursive: true });
  fs.cpSync(uploadsDir, destDir, { recursive: true });
  // Keep only last 5 upload snapshots
  const uploadBackups = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('uploads-'))
    .sort()
    .reverse();
  if (uploadBackups.length > 5) {
    uploadBackups.slice(5).forEach(f => {
      fs.rmSync(path.join(BACKUP_DIR, f), { recursive: true, force: true });
      console.log(`🗑️ Deleted old uploads backup: ${f}`);
    });
  }
}
backupUploads();

console.log('🔄 Backup completed (databases + uploads)');
