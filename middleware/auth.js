// middleware/auth.js
const jwt = require('jsonwebtoken');
const db = require('../db');

const auth = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'ไม่ได้รับอนุญาต — กรุณาเข้าสู่ระบบ' });
  }
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await db.query('SELECT * FROM users WHERE id = $1 AND is_active = true', [decoded.id]);
    if (!rows.length) return res.status(401).json({ error: 'ผู้ใช้ไม่พบในระบบ' });
    req.user = rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token ไม่ถูกต้องหรือหมดอายุ' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'เฉพาะ Admin เท่านั้น' });
  next();
};

module.exports = { auth, adminOnly };
