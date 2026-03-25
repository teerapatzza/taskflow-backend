// routes/users.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { auth, adminOnly } = require('../middleware/auth');

// GET /api/users — ดูผู้ใช้ทั้งหมด
router.get('/', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT u.id, u.username, u.name, u.dept, u.email, u.line_uid, u.role, u.avatar_color, u.created_at,
        COUNT(t.id) FILTER (WHERE t.status != 'done') AS pending_tasks
      FROM users u
      LEFT JOIN tasks t ON t.assignee_id = u.id
      WHERE u.is_active = true
      GROUP BY u.id ORDER BY u.name
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/users/:id/role — เปลี่ยน role (admin only)
router.patch('/:id/role', auth, adminOnly, async (req, res) => {
  const { role } = req.body;
  if (!['admin','member'].includes(role)) return res.status(400).json({ error: 'role ไม่ถูกต้อง' });
  const { rows } = await db.query('UPDATE users SET role=$1 WHERE id=$2 RETURNING id,name,role', [role, req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  res.json(rows[0]);
});

// DELETE /api/users/:id (soft delete)
router.delete('/:id', auth, adminOnly, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'ไม่สามารถลบตัวเองได้' });
  await db.query('UPDATE users SET is_active=false WHERE id=$1', [req.params.id]);
  res.json({ message: 'ปิดการใช้งานผู้ใช้เรียบร้อย' });
});

module.exports = router;


// ===== NOTIFICATIONS ROUTES =====
const notifRouter = express.Router();

// GET /api/notifications
notifRouter.get('/', auth, async (req, res) => {
  const { limit = 30, unreadOnly } = req.query;
  let where = 'user_id = $1';
  if (unreadOnly === 'true') where += ' AND is_read = false';
  const { rows } = await db.query(
    `SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT $2`,
    [req.user.id, parseInt(limit)]
  );
  const unreadCount = rows.filter(n => !n.is_read).length;
  res.json({ notifications: rows, unreadCount });
});

// PATCH /api/notifications/read-all
notifRouter.patch('/read-all', auth, async (req, res) => {
  await db.query('UPDATE notifications SET is_read=true WHERE user_id=$1', [req.user.id]);
  res.json({ message: 'อ่านทั้งหมดแล้ว' });
});

// DELETE /api/notifications
notifRouter.delete('/', auth, async (req, res) => {
  await db.query('DELETE FROM notifications WHERE user_id=$1', [req.user.id]);
  res.json({ message: 'ล้างการแจ้งเตือนทั้งหมดแล้ว' });
});

module.exports = { userRouter: router, notifRouter };
