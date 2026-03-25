// routes/tasks.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { auth } = require('../middleware/auth');
const notify = require('../services/notify');

// ===== FILE UPLOAD CONFIG =====
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB) || 10) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // block executable files
    const blocked = ['.exe', '.bat', '.sh', '.cmd'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (blocked.includes(ext)) return cb(new Error('ไม่อนุญาตไฟล์ประเภทนี้'));
    cb(null, true);
  }
});

// ===== GET /api/tasks — ดูงานทั้งหมด =====
router.get('/', auth, async (req, res) => {
  try {
    const { status, dept, priority, assigneeId, assignedById, search } = req.query;
    let where = ['1=1'];
    let params = [];
    let i = 1;

    if (status) { where.push(`t.status = $${i++}`); params.push(status); }
    if (dept) { where.push(`t.dept = $${i++}`); params.push(dept); }
    if (priority) { where.push(`t.priority = $${i++}`); params.push(priority); }
    if (assigneeId) { where.push(`t.assignee_id = $${i++}`); params.push(assigneeId); }
    if (assignedById) { where.push(`t.assigned_by_id = $${i++}`); params.push(assignedById); }
    if (search) { where.push(`(t.title ILIKE $${i} OR t.assignee_name ILIKE $${i})`); params.push(`%${search}%`); i++; }

    const { rows } = await db.query(`
      SELECT t.*,
        COALESCE(json_agg(tf.*) FILTER (WHERE tf.id IS NOT NULL AND tf.file_type='attachment'), '[]') as files,
        COALESCE(json_agg(sf.*) FILTER (WHERE sf.id IS NOT NULL AND sf.file_type='submission'), '[]') as submitted_files,
        COALESCE(json_agg(tl.* ORDER BY tl.created_at) FILTER (WHERE tl.id IS NOT NULL), '[]') as timeline
      FROM tasks t
      LEFT JOIN task_files tf ON tf.task_id = t.id AND tf.file_type = 'attachment'
      LEFT JOIN task_files sf ON sf.task_id = t.id AND sf.file_type = 'submission'
      LEFT JOIN task_timeline tl ON tl.task_id = t.id
      WHERE ${where.join(' AND ')}
      GROUP BY t.id
      ORDER BY t.due_date ASC, t.created_at DESC
    `, params);

    res.json(rows);
  } catch (err) {
    console.error('GET /tasks error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===== GET /api/tasks/:id =====
router.get('/:id', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT t.*,
        COALESCE(json_agg(DISTINCT tf.*) FILTER (WHERE tf.id IS NOT NULL AND tf.file_type='attachment'), '[]') as files,
        COALESCE(json_agg(DISTINCT sf.*) FILTER (WHERE sf.id IS NOT NULL AND sf.file_type='submission'), '[]') as submitted_files,
        COALESCE(json_agg(DISTINCT tl.* ORDER BY tl.created_at) FILTER (WHERE tl.id IS NOT NULL), '[]') as timeline
      FROM tasks t
      LEFT JOIN task_files tf ON tf.task_id = t.id
      LEFT JOIN task_files sf ON sf.task_id = t.id
      LEFT JOIN task_timeline tl ON tl.task_id = t.id
      WHERE t.id = $1 GROUP BY t.id
    `, [req.params.id]);

    if (!rows.length) return res.status(404).json({ error: 'ไม่พบงาน' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== POST /api/tasks — สร้างงานใหม่ =====
router.post('/', auth, upload.array('files', 10), async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { title, description, assigneeId, assigneeName, assigneeEmail, assigneeLineUid,
            dept, dueDate, priority, tag, note, channels } = req.body;

    if (!title || !assigneeName || !dept || !dueDate) {
      return res.status(400).json({ error: 'กรอกข้อมูลให้ครบ: ชื่องาน, ผู้รับผิดชอบ, แผนก, กำหนดส่ง' });
    }

    // ดึงข้อมูล assignee จาก DB ถ้ามี assigneeId
    let aEmail = assigneeEmail, aLineUid = assigneeLineUid, aName = assigneeName;
    if (assigneeId) {
      const { rows: uRows } = await client.query('SELECT * FROM users WHERE id = $1', [assigneeId]);
      if (uRows.length) {
        aEmail = aEmail || uRows[0].email;
        aLineUid = aLineUid || uRows[0].line_uid;
        aName = aName || uRows[0].name;
      }
    }

    // สร้างงาน
    const { rows } = await client.query(`
      INSERT INTO tasks (title, description, assignee_id, assignee_name, assignee_email,
        assignee_line_uid, dept, due_date, priority, tag, note,
        assigned_by_id, assigned_by_name, assigned_by_email)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *
    `, [title, description, assigneeId||null, aName, aEmail, aLineUid,
        dept, dueDate, priority||'mid', tag, note,
        req.user.id, req.user.name, req.user.email]);

    const task = rows[0];

    // บันทึกไฟล์แนบ
    if (req.files && req.files.length) {
      for (const file of req.files) {
        await client.query(
          `INSERT INTO task_files (task_id, filename, original_name, file_size, mime_type, file_type, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,'attachment',$6)`,
          [task.id, file.filename, file.originalname, file.size, file.mimetype, req.user.id]
        );
      }
    }

    // บันทึก timeline
    await client.query(
      `INSERT INTO task_timeline (task_id, event_text, event_type, created_by) VALUES ($1,$2,'done',$3)`,
      [task.id, `มอบหมายงานโดย ${req.user.name}`, req.user.id]
    );

    await client.query('COMMIT');

    // ส่งแจ้งเตือน (หลัง commit)
    const notifChannels = channels ? JSON.parse(channels) : ['app'];
    await notify.notifyAssigned(task, notifChannels);

    res.status(201).json({ ...task, message: `มอบหมายงาน "${title}" เรียบร้อย` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /tasks error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ===== POST /api/tasks/:id/submit — ส่งงาน + แนบไฟล์ =====
router.post('/:id/submit', auth, upload.array('files', 10), async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { progress, note, channels } = req.body;
    const prog = parseInt(progress) || 100;

    const { rows: taskRows } = await client.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
    if (!taskRows.length) return res.status(404).json({ error: 'ไม่พบงาน' });
    const task = taskRows[0];

    if (!req.files || !req.files.length) {
      return res.status(400).json({ error: 'กรุณาแนบไฟล์ผลงานอย่างน้อย 1 ไฟล์' });
    }

    // บันทึกไฟล์ submission
    for (const file of req.files) {
      await client.query(
        `INSERT INTO task_files (task_id, filename, original_name, file_size, mime_type, file_type, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,'submission',$6)`,
        [task.id, file.filename, file.originalname, file.size, file.mimetype, req.user.id]
      );
    }

    // อัปเดตสถานะ
    const newStatus = prog >= 100 ? 'done' : 'inprogress';
    await client.query(
      'UPDATE tasks SET progress=$1, status=$2 WHERE id=$3',
      [prog, newStatus, task.id]
    );

    // บันทึก timeline
    await client.query(
      `INSERT INTO task_timeline (task_id, event_text, event_type, created_by) VALUES ($1,$2,'done',$3)`,
      [task.id, `ส่งงาน ${prog}%${note ? ' — ' + note : ''} (${req.files.length} ไฟล์)`, req.user.id]
    );

    await client.query('COMMIT');

    // แจ้งเตือนผู้มอบหมาย
    const notifChannels = channels ? JSON.parse(channels) : ['app'];
    const updatedTask = { ...task, progress: prog, status: newStatus };

    // ดึง line_uid ของ assigned_by จาก users
    const { rows: byUser } = await db.query('SELECT line_uid, email FROM users WHERE id = $1', [task.assigned_by_id]);
    if (byUser.length) {
      updatedTask.assigned_by_line_uid = byUser[0].line_uid;
      updatedTask.assigned_by_email = task.assigned_by_email || byUser[0].email;
    }

    await notify.notifySubmitted(updatedTask, note, notifChannels);

    res.json({ message: `ส่งงานเรียบร้อย (${prog}%)`, status: newStatus, progress: prog });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /tasks/:id/submit error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ===== POST /api/tasks/:id/remind — ส่งเตือนด้วยตนเอง =====
router.post('/:id/remind', auth, async (req, res) => {
  try {
    const { message, channels } = req.body;
    const { rows } = await db.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบงาน' });
    const task = rows[0];

    // ดึง line_uid จาก assignee user
    const { rows: aUser } = await db.query('SELECT line_uid FROM users WHERE id = $1', [task.assignee_id]);
    if (aUser.length && !task.assignee_line_uid) task.assignee_line_uid = aUser[0].line_uid;

    const notifChannels = channels || ['app'];
    await notify.notifyReminder(task, message, notifChannels);

    // บันทึก timeline + อัปเดต last_reminded_at
    await db.query(
      `INSERT INTO task_timeline (task_id, event_text, event_type, created_by) VALUES ($1,$2,'warn',$3)`,
      [task.id, `ส่งแจ้งเตือนด้วยตนเอง (${notifChannels.join(', ')})`, req.user.id]
    );
    await db.query('UPDATE tasks SET last_reminded_at = NOW() WHERE id = $1', [task.id]);

    res.json({ message: `ส่งแจ้งเตือนไปยัง ${task.assignee_name} เรียบร้อย` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== PATCH /api/tasks/:id — อัปเดตสถานะ/ข้อมูล =====
router.patch('/:id', auth, async (req, res) => {
  try {
    const { status, progress, title, priority, dueDate, note } = req.body;
    const fields = [], params = [];
    let i = 1;
    if (status !== undefined) { fields.push(`status=$${i++}`); params.push(status); }
    if (progress !== undefined) { fields.push(`progress=$${i++}`); params.push(progress); }
    if (title) { fields.push(`title=$${i++}`); params.push(title); }
    if (priority) { fields.push(`priority=$${i++}`); params.push(priority); }
    if (dueDate) { fields.push(`due_date=$${i++}`); params.push(dueDate); }
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

// ===== DELETE /api/tasks/:id =====
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

// ===== GET /api/tasks/file/:filename — ดาวน์โหลดไฟล์ =====
router.get('/file/:filename', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM task_files WHERE filename=$1', [req.params.filename]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบไฟล์' });
    const filePath = path.join(uploadDir, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'ไฟล์ถูกลบออกจาก server' });
    res.download(filePath, rows[0].original_name);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== GET /api/tasks/stats/summary — สถิติ Dashboard =====
router.get('/stats/summary', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE true) AS total,
        COUNT(*) FILTER (WHERE status = 'done') AS done,
        COUNT(*) FILTER (WHERE status IN ('pending','inprogress')) AS pending,
        COUNT(*) FILTER (WHERE status = 'overdue' OR (status != 'done' AND due_date < CURRENT_DATE)) AS overdue,
        COUNT(*) FILTER (WHERE due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 5 AND status != 'done') AS due_soon
      FROM tasks
    `);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
