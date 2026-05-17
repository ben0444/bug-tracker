const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 4000;

// On Railway: mount a volume at /data and set DATA_DIR=/data
const DATA_DIR = process.env.DATA_DIR || __dirname;
const uploadsDir = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|mp4|mov|avi|webm|mkv|pdf|txt|doc|docx|zip/;
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    allowed.test(ext) ? cb(null, true) : cb(new Error('סוג קובץ לא נתמך'));
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: __dirname }),
  secret: 'bug-tracker-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

const requireAuth = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'נדרשת התחברות' });
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.userId || req.session.role !== 'admin') return res.status(403).json({ error: 'אין הרשאה' });
  next();
};

// Auth routes
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'נדרש שם משתמש וסיסמה' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;
  res.json({ id: user.id, username: user.username, role: user.role });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'לא מחובר' });
  res.json({ id: req.session.userId, username: req.session.username, role: req.session.role });
});

// User management (admin only)
app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC').all();
  res.json(users);
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password, role = 'user' } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'נדרש שם משתמש וסיסמה' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, role);
    res.json({ id: result.lastInsertRowid, username, role });
  } catch {
    res.status(400).json({ error: 'שם המשתמש כבר קיים' });
  }
});

app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.session.userId) return res.status(400).json({ error: 'לא ניתן למחוק את עצמך' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Bugs routes
app.get('/api/bugs', requireAuth, (req, res) => {
  const { status, priority, device_type, assignee, search } = req.query;
  let sql = 'SELECT * FROM bugs WHERE 1=1';
  const params = [];

  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (priority) { sql += ' AND priority = ?'; params.push(priority); }
  if (device_type) { sql += ' AND device_type = ?'; params.push(device_type); }
  if (assignee) { sql += ' AND assignee = ?'; params.push(assignee); }
  if (search) { sql += ' AND (title LIKE ? OR description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  sql += ' ORDER BY created_at DESC';
  const bugs = db.prepare(sql).all(...params);

  bugs.forEach(bug => {
    bug.comment_count = db.prepare('SELECT COUNT(*) as c FROM comments WHERE bug_id = ?').get(bug.id).c;
    bug.attachment_count = db.prepare('SELECT COUNT(*) as c FROM attachments WHERE bug_id = ?').get(bug.id).c;
  });

  res.json(bugs);
});

app.get('/api/bugs/:id', requireAuth, (req, res) => {
  const bug = db.prepare('SELECT * FROM bugs WHERE id = ?').get(req.params.id);
  if (!bug) return res.status(404).json({ error: 'באג לא נמצא' });

  bug.comments = db.prepare('SELECT * FROM comments WHERE bug_id = ? ORDER BY created_at ASC').all(bug.id);
  bug.attachments = db.prepare('SELECT * FROM attachments WHERE bug_id = ? ORDER BY created_at DESC').all(bug.id);

  bug.comments.forEach(c => {
    c.attachments = db.prepare('SELECT * FROM attachments WHERE comment_id = ?').all(c.id);
  });

  res.json(bug);
});

app.post('/api/bugs', requireAuth, upload.array('attachments', 10), (req, res) => {
  const { title, description, status = 'פתוח', priority = 'בינוני', device_type, assignee } = req.body;
  if (!title) return res.status(400).json({ error: 'כותרת נדרשת' });

  const result = db.prepare(
    'INSERT INTO bugs (title, description, status, priority, device_type, assignee, reporter_id, reporter_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(title, description, status, priority, device_type, assignee, req.session.userId, req.session.username);

  const bugId = result.lastInsertRowid;

  if (req.files && req.files.length > 0) {
    const insertAtt = db.prepare('INSERT INTO attachments (bug_id, user_id, filename, original_name, file_type, file_size) VALUES (?, ?, ?, ?, ?, ?)');
    req.files.forEach(f => {
      const fileType = f.mimetype.startsWith('image/') ? 'image' : f.mimetype.startsWith('video/') ? 'video' : 'file';
      insertAtt.run(bugId, req.session.userId, f.filename, f.originalname, fileType, f.size);
    });
  }

  res.json({ id: bugId });
});

app.put('/api/bugs/:id', requireAuth, (req, res) => {
  const { title, description, status, priority, device_type, assignee } = req.body;
  db.prepare(
    'UPDATE bugs SET title=?, description=?, status=?, priority=?, device_type=?, assignee=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).run(title, description, status, priority, device_type, assignee, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/bugs/:id', requireAuth, requireAdmin, (req, res) => {
  const atts = db.prepare('SELECT filename FROM attachments WHERE bug_id = ?').all(req.params.id);
  atts.forEach(a => {
    try { fs.unlinkSync(path.join(uploadsDir, a.filename)); } catch {}
  });
  db.prepare('DELETE FROM bugs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Comments
app.post('/api/bugs/:id/comments', requireAuth, upload.array('attachments', 10), (req, res) => {
  const { content } = req.body;
  if (!content && (!req.files || req.files.length === 0)) return res.status(400).json({ error: 'תוכן נדרש' });

  const commentContent = content || '';
  const result = db.prepare(
    'INSERT INTO comments (bug_id, user_id, username, content) VALUES (?, ?, ?, ?)'
  ).run(req.params.id, req.session.userId, req.session.username, commentContent);

  const commentId = result.lastInsertRowid;

  if (req.files && req.files.length > 0) {
    const insertAtt = db.prepare('INSERT INTO attachments (bug_id, comment_id, user_id, filename, original_name, file_type, file_size) VALUES (?, ?, ?, ?, ?, ?, ?)');
    req.files.forEach(f => {
      const fileType = f.mimetype.startsWith('image/') ? 'image' : f.mimetype.startsWith('video/') ? 'video' : 'file';
      insertAtt.run(req.params.id, commentId, req.session.userId, f.filename, f.originalname, fileType, f.size);
    });
  }

  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId);
  comment.attachments = db.prepare('SELECT * FROM attachments WHERE comment_id = ?').all(commentId);
  res.json(comment);
});

app.delete('/api/comments/:id', requireAuth, (req, res) => {
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!comment) return res.status(404).json({ error: 'תגובה לא נמצאה' });
  if (comment.user_id !== req.session.userId && req.session.role !== 'admin')
    return res.status(403).json({ error: 'אין הרשאה' });

  const atts = db.prepare('SELECT filename FROM attachments WHERE comment_id = ?').all(req.params.id);
  atts.forEach(a => { try { fs.unlinkSync(path.join(uploadsDir, a.filename)); } catch {} });

  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Stats
app.get('/api/stats', requireAuth, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as c FROM bugs').get().c;
  const byStatus = db.prepare("SELECT status, COUNT(*) as c FROM bugs GROUP BY status").all();
  const byPriority = db.prepare("SELECT priority, COUNT(*) as c FROM bugs GROUP BY priority").all();
  res.json({ total, byStatus, byPriority });
});

// Global error handler — catches multer errors and any other unhandled errors
app.use((err, req, res, next) => {
  console.error('Server error:', err?.code, err?.message);

  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'הקובץ גדול מדי — מקסימום 100MB' });
  }

  const msg = typeof err?.message === 'string' ? err.message
    : typeof err === 'string' ? err
    : 'שגיאת שרת פנימית';

  if (msg === 'סוג קובץ לא נתמך') {
    return res.status(400).json({ error: msg });
  }

  res.status(err?.status || 500).json({ error: msg });
});

app.listen(PORT, () => console.log(`Bug Tracker running at http://localhost:${PORT}`));
