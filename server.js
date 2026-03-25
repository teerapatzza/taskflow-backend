// server.js — TaskFlow Backend Entry Point
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const taskRoutes = require('./routes/tasks');
const { userRouter, notifRouter } = require('./routes/users');
const scheduler = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3001;

// ===== MIDDLEWARE =====
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files (uploaded)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ===== ROUTES =====
app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/users', userRouter);
app.use('/api/notifications', notifRouter);

// ===== HEALTH CHECK =====
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'TaskFlow API',
    version: '3.0.0',
    time: new Date().toISOString(),
    env: process.env.NODE_ENV
  });
});

// ===== 404 =====
app.use((req, res) => res.status(404).json({ error: `ไม่พบ endpoint: ${req.method} ${req.path}` }));

// ===== ERROR HANDLER =====
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'ไฟล์ใหญ่เกินไป' });
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ===== START =====
app.listen(PORT, async () => {
  console.log(`\n🚀 TaskFlow API running on port ${PORT}`);
  console.log(`📍 Health: http://localhost:${PORT}/health`);
  console.log(`🗄️  Database: ${process.env.DATABASE_URL ? '✅ Connected' : '❌ Not configured'}`);
  console.log(`📧 Gmail: ${process.env.GMAIL_USER ? '✅ ' + process.env.GMAIL_USER : '⚠️  Not configured'}`);
  console.log(`💬 Line: ${process.env.LINE_CHANNEL_ACCESS_TOKEN ? '✅ Configured' : '⚠️  Not configured'}`);
  console.log('');

  // Start automatic notification scheduler
  scheduler.startAll();
});

module.exports = app;
