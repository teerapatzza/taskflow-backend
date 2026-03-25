// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { auth } = require('../middleware/auth');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, password, name, dept, email, lineUid } = req.body;
  if (!username || !password || !name || !dept) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });

  try {
    const existing = await db.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length) return res.status(409).json({ error: 'ชื่อผู้ใช้นี้มีอยู่แล้ว' });

    const hash = await bcrypt.hash(password, 10);
    const colors = ['#4f7aff','#00d4aa','#f5a623','#e84c76','#9b59b6','#2ecc71'];
    const color = colors[Math.floor(Math.random() * colors.length)];

    const { rows } = await db.query(
      `INSERT INTO users (username, password, name, dept, email, line_uid, avatar_color)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, username, name, dept, email, line_uid, role, avatar_color, created_at`,
      [username, hash, name, dept, email || null, lineUid || null, color]
    );
    const user = rows[0];

    // สร้าง settings เริ่มต้น
    await db.query('INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);

    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
    res.status(201).json({ token, user: sanitizeUser(user) });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'กรอก username และ password' });

  try {
    const { rows } = await db.query('SELECT * FROM users WHERE username = $1 AND is_active = true', [username]);
    if (!rows.length) return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });

    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
    res.json({ token, user: sanitizeUser(user) });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
  }
});

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.*, us.notify_email, us.notify_line, us.notify_pre_due, us.notify_overdue, us.remind_freq_days
     FROM users u LEFT JOIN user_settings us ON us.user_id = u.id WHERE u.id = $1`,
    [req.user.id]
  );
  res.json(sanitizeUser(rows[0]));
});

// PUT /api/auth/profile
router.put('/profile', auth, async (req, res) => {
  const { name, email, lineUid, dept } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email),
       line_uid = COALESCE($3, line_uid), dept = COALESCE($4, dept)
       WHERE id = $5 RETURNING id, username, name, dept, email, line_uid, role, avatar_color`,
      [name, email, lineUid, dept, req.user.id]
    );
    res.json(sanitizeUser(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/auth/password
router.put('/password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัว' });
  }
  const match = await bcrypt.compare(currentPassword, req.user.password);
  if (!match) return res.status(401).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
  const hash = await bcrypt.hash(newPassword, 10);
  await db.query('UPDATE users SET password = $1 WHERE id = $2', [hash, req.user.id]);
  res.json({ message: 'เปลี่ยนรหัสผ่านเรียบร้อย' });
});

// PUT /api/auth/settings
router.put('/settings', auth, async (req, res) => {
  const { notifyEmail, notifyLine, notifyPreDue, notifyOverdue, notifySubmit, remindFreqDays, lineUid } = req.body;
  try {
    await db.query(
      `INSERT INTO user_settings (user_id, notify_email, notify_line, notify_pre_due, notify_overdue, notify_submit, remind_freq_days, line_uid)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (user_id) DO UPDATE SET
         notify_email=$2, notify_line=$3, notify_pre_due=$4,
         notify_overdue=$5, notify_submit=$6, remind_freq_days=$7,
         line_uid=COALESCE($8, user_settings.line_uid), updated_at=NOW()`,
      [req.user.id, notifyEmail, notifyLine, notifyPreDue, notifyOverdue, notifySubmit, remindFreqDays || 3, lineUid]
    );
    if (lineUid) await db.query('UPDATE users SET line_uid=$1 WHERE id=$2', [lineUid, req.user.id]);
    res.json({ message: 'บันทึกการตั้งค่าเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function sanitizeUser(u) {
  if (!u) return null;
  const { password, ...safe } = u;
  return safe;
}

module.exports = router;
