// routes/tasks.js — v4.1 fix DISTINCT ORDER BY
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const db = require('../db');
const { auth } = require('../middleware/auth');
const notify = require('../services/notify');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: 'taskflow',
    resource_type: 'auto',
    public_id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    use_filename: false,
  }),
});

const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB) || 20) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const blocked = ['.exe', '.bat', '.sh', '.cmd'];
    const ext = '.' + file.originalname.split('.').pop().toLowerCase();
    if (blocked.includes(ext)) return cb(new Error('ไม่อนุญาตไฟล์ประเภทนี้'));
    cb(null, true);
  }
});

router.get('/', auth, async (req, res) => {
  try {
    const { status, dept, priority, search } = req.query;
    let where = ['1=1'];
    let params = [];
    let i = 1;
    if (status) { where.push(`t.status = $${i++}`); params.push(status); }
    if (dept) { where.push(`t.dept = $${i++}`); params.push(dept); }
    if (priority) { where.push(`t.priority = $${i++}`); params.push(priority); }
    if (search) { where.push(`(t.title ILIKE $${i} OR t.assignee_name ILIKE $${i})`); params.push(`%${search}%`); i++; }
    const { rows } = await db.query(`
      SELECT t.*, EXISTS(SELECT 1 FROM task_files tf WHERE tf.task_id = t.id) as has_files
      FROM tasks t WHERE ${where.join(' AND ')}
      ORDER BY t.due_date ASC, t.created_at DESC
    `, params);
    res.json(rows);
  } catch (err) {
    console.error('GET /tasks error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const { rows: taskRows } = await db.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
    if (!taskRows.length) return res.status(404).json({ error: 'ไม่พบงาน' });
    const { rows: files } = await db.query(
      'SELECT * FROM task_files WHERE task_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    const { rows: timeline } = await db.query(
      'SELECT * FROM task_timeline WHERE task_id = $1 ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json({ task: taskRows[0], files, timeline });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, upload.array('files', 10), async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const title = req.body.title;
    const description = req.body.description || '';
    const assignee_id = req.body.assignee_id || null;
    const assignee_name = req.body.assignee_name || '';
    const assignee_email = req.body.assignee_email || '';
    const assignee_line_uid = req.body.assignee_line_uid || '';
    const dept = req.body.dept;
    const due_date = req.body.due_date;
    const priority = req.body.priority || 'mid';
    const tag = req.body.tag || '';
    const note = req.body.note || '';
    const channels = req.body.channels ? JSON.parse(req.body.channels) : ['app'];

    if (!title || !assignee_name || !dept || !due_date) {
      return res.status(400).json({ error: 'กรอกข้อมูลให้ครบ' });
    }

    let aEmail = assignee_email, aLineUid = assignee_line_uid, aName = assignee_name;
    if (assignee_id) {
      const { rows: uRows } = await client.query('SELECT * FROM users WHERE id = $1', [assignee_id]);
      if (uRows.length) {
        aEmail = aEmail || uRows[0].email || '';
        aLineUid = aLineUid || uRows[0].line_uid || '';
        aName = aName || uRows[0].name;
      }
    }

    const { rows } = await client.query(`
      INSERT INTO tasks (title, description, assignee_id, assignee_name, assignee_email,
        assignee_line_uid, dept, due_date, priority, tag, note,
        assigned_by_id, assigned_by_name, assigned_by_email)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *
    `, [title, description, assignee_id || null, aName, aEmail, aLineUid,
        dept, due_date, priority, tag, note,
        req.user.id, req.user.name, req.user.email]);
    const task = rows[0];

    if (req.files && req.files.length) {
      for (const file of req.files) {
        await client.query(
          `INSERT INTO task_files (task_id, filename, original_name, file_size, mime_type, file_type, uploaded_by, url)
           VALUES ($1,$2,$3,$4,$5,'attachment',$6,$7)`,
          [task.id, file.filename || file.public_id, file.originalname,
           file.size, file.mimetype, req.user.id, file.path || file.secure_url || '']
        );
      }
    }

    await client.query(
      `INSERT INTO task_timeline (task_id, event_text, event_type, created_by) VALUES ($1,$2,'done',$3)`,
      [task.id, `มอบหมายงานโดย ${req.user.name}`, req.user.id]
    );
    await client.query('COMMIT');
    await notify.notifyAssigned({ ...task, assignee_email: aEmail, assignee_line_uid: aLineUid }, channels);
    res.status(201).json({ ...task, message: `มอบหมายงาน "${title}" เรียบร้อย` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /tasks error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post('/:id/submit', auth, upload.array('files', 10), async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const progress = parseInt(req.body.progress) || 100;
    const note = req.body.note || '';
    const channels = req.body.channels ? JSON.parse(req.body.channels) : ['app'];
    const { rows: taskRows } = await client.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
    if (!taskRows.length) return res.status(404).json({ error: 'ไม่พบงาน' });
    const task = taskRows[0];
    if (!req.files || !req.files.length) {
      return res.status(400).json({ error: 'กรุณาแนบไฟล์ผลงานอย่างน้อย 1 ไฟล์' });
    }
    for (const file of req.files) {
      await client.query(
        `INSERT INTO task_files (task_id, filename, original_name, file_size, mime_type, file_type, uploaded_by, url)
         VALUES ($1,$2,$3,$4,$5,'submission',$6,$7)`,
        [task.id, file.filename || file.public_id, file.originalname,
         file.size, file.mimetype, req.user.id, file.path || file.secure_url || '']
      );
    }
    const newStatus = progress >= 100 ? 'done' : 'inprogress';
    await client.query('UPDATE tasks SET progress=$1, status=$2 WHERE id=$3', [progress, newStatus, task.id]);
    await client.query(
      `INSERT INTO task_timeline (task_id, event_text, event_type, created_by) VALUES ($1,$2,'done',$3)`,
      [task.id, `ส่งงาน ${progress}%${note ? ' — ' + note : ''} (${req.files.length} ไฟล์)`, req.user.id]
    );
    await client.query('COMMIT');
    const { rows: byUser } = await db.query('SELECT line_uid, email FROM users WHERE id = $1', [task.assigned_by_id]);
    const updatedTask = {
      ...task, progress, status: newStatus,
      assigned_by_email: task.assigned_by_email || (byUser[0]?.email || ''),
      assigned_by_line_uid: byUser[0]?.line_uid || ''
    };
    await notify.notifySubmitted(updatedTask, note, channels);
    res.json({ message: `ส่งงานเรียบร้อย (${progress}%)`, status: newStatus, progress });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /tasks/:id/submit error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post('/:id/remind', auth, async (req, res) => {
  try {
    const message = req.body.message || '';
    const channels = req.body.channels || ['app'];
    const { rows } = await db.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบงาน' });
    const task = rows[0];
    const { rows: aUser } = await db.query('SELECT line_uid FROM users WHERE id = $1', [task.assignee_id]);
    if (aUser.length && !task.assignee_line_uid) task.assignee_line_uid = aUser[0].line_uid;
    await notify.notifyReminder(task, message, channels);
    await db.query(`INSERT INTO task_timeline (task_id, event_text, event_type, created_by) VALUES ($1,$2,'warn',$3)`,
      [task.id, `ส่งแจ้งเตือนด้วยตนเอง (${channels.join(', ')})`, req.user.id]);
    await db.query('UPDATE tasks SET last_reminded_at = NOW() WHERE id = $1', [task.id]);
    res.json({ message: `ส่งแจ้งเตือนไปยัง ${task.assignee_name} เรียบร้อย` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', auth, async (req, res) => {
  try {
    const { status, progress, title, priority, due_date, note } = req.body;
    const fields = [], params = [];
    let i = 1;
    if (status !== undefined) { fields.push(`status=$${i++}`); params.push(status); }
    if (progress !== undefined) { fields.push(`progress=$${i++}`); params.push(progress); }
    if (title) { fields.push(`title=$${i++}`); params.push(title); }
    if (priority) { fields.push(`priority=$${i++}`); params.push(priority); }
    if (due_date) { fields.push(`due_date=$${i++}`); params.push(due_date); }
    if (note !== undefined) { fields.push(`note=$${i++}`); params.push(note); }
    if (!fields.length) return res.status(400).json({ error: 'ไม่มีข้อมูลให้อัปเดต' });
    params.push(req.params.id);
    const { rows } = await db.query(`UPDATE tasks SET ${fields.join(',')} WHERE id=$${i} RETURNING *`, params);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบงาน' });
    if (status === 'done') {
      await db.query(`INSERT INTO task_timeline (task_id, event_text, event_type, created_by) VALUES ($1,$2,'done',$3)`,
        [req.params.id, `ทำเครื่องหมายเสร็จสมบูรณ์โดย ${req.user.name}`, req.user.id]);
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM tasks WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบงาน' });
    if (rows[0].assigned_by_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์ลบงานนี้' });
    }
    await db.query('DELETE FROM tasks WHERE id=$1', [req.params.id]);
    res.json({ message: 'ลบงานเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
