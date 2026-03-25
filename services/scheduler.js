// services/scheduler.js
// ระบบแจ้งเตือนอัตโนมัติ — ทำงานเหมือน "ขุนทอง" ทวงงานไม่หยุด

const cron = require('node-cron');
const db = require('../db');
const notify = require('./notify');

// ===== JOB 1: แจ้งเตือนงานเกินกำหนด — ทุกวัน 8:00 น. =====
function startOverdueJob() {
  cron.schedule('0 8 * * *', async () => {
    console.log(`[CRON] ${new Date().toISOString()} — ตรวจงานเกินกำหนด`);
    try {
      // หางานที่เกินกำหนด ยังไม่เสร็จ และยังไม่ได้แจ้งเตือนวันนี้
      const { rows: overdueTasks } = await db.query(`
        SELECT t.*, 
               u.line_uid AS assignee_line_uid_user,
               us.notify_email, us.notify_line, us.remind_freq_days
        FROM tasks t
        LEFT JOIN users u ON u.id = t.assignee_id
        LEFT JOIN user_settings us ON us.user_id = t.assigned_by_id
        WHERE t.status != 'done'
          AND t.due_date < CURRENT_DATE
          AND (
            t.last_reminded_at IS NULL OR
            t.last_reminded_at < NOW() - INTERVAL '1 day' * COALESCE(us.remind_freq_days, 3)
          )
      `);

      console.log(`[CRON] พบ ${overdueTasks.length} งานเกินกำหนด`);

      for (const task of overdueTasks) {
        const channels = ['app'];
        if (task.notify_email) channels.push('email');
        if (task.notify_line) channels.push('line');

        // ใช้ line_uid จาก user table ถ้าไม่มีใน task
        if (!task.assignee_line_uid && task.assignee_line_uid_user) {
          task.assignee_line_uid = task.assignee_line_uid_user;
        }

        await notify.notifyReminder(task, null, channels);

        // Update last_reminded_at
        await db.query(
          `UPDATE tasks SET last_reminded_at = NOW(), status = 'overdue' WHERE id = $1`,
          [task.id]
        );

        // บันทึก timeline
        await db.query(
          `INSERT INTO task_timeline (task_id, event_text, event_type) VALUES ($1, $2, 'danger')`,
          [task.id, `แจ้งเตือนอัตโนมัติ — งานเกินกำหนด (${channels.join(', ')})`]
        );

        console.log(`[CRON] ✅ แจ้งเตือน "${task.title}" → ${task.assignee_name} (${channels.join(', ')})`);
      }
    } catch (err) {
      console.error('[CRON] overdue error:', err.message);
    }
  }, { timezone: 'Asia/Bangkok' });

  console.log('[CRON] ✅ overdue job ตั้งเวลาไว้ที่ 08:00 น. ทุกวัน (Bangkok)');
}

// ===== JOB 2: แจ้งเตือนก่อนครบกำหนด 1 วัน — ทุกวัน 9:00 น. =====
function startPreDueJob() {
  cron.schedule('0 9 * * *', async () => {
    console.log(`[CRON] ${new Date().toISOString()} — ตรวจงานใกล้ครบกำหนด`);
    try {
      const { rows: preDueTasks } = await db.query(`
        SELECT t.*, 
               u.line_uid AS assignee_line_uid_user,
               us.notify_email, us.notify_line, us.notify_pre_due
        FROM tasks t
        LEFT JOIN users u ON u.id = t.assignee_id
        LEFT JOIN user_settings us ON us.user_id = t.assigned_by_id
        WHERE t.status NOT IN ('done', 'overdue')
          AND t.due_date = CURRENT_DATE + INTERVAL '1 day'
          AND COALESCE(us.notify_pre_due, true) = true
      `);

      console.log(`[CRON] พบ ${preDueTasks.length} งานครบกำหนดพรุ่งนี้`);

      for (const task of preDueTasks) {
        const channels = ['app'];
        if (task.notify_email) channels.push('email');
        if (task.notify_line) channels.push('line');
        if (!task.assignee_line_uid && task.assignee_line_uid_user) task.assignee_line_uid = task.assignee_line_uid_user;

        await notify.notifyReminder(task, `🔔 แจ้งเตือน: งาน "${task.title}" จะครบกำหนดพรุ่งนี้! กรุณาเตรียมส่งงาน`, channels);
        await db.query(`INSERT INTO task_timeline (task_id, event_text, event_type) VALUES ($1, $2, 'warn')`,
          [task.id, `แจ้งเตือนล่วงหน้า 1 วัน (${channels.join(', ')})`]);
        console.log(`[CRON] ✅ แจ้งก่อนครบกำหนด "${task.title}" → ${task.assignee_name}`);
      }
    } catch (err) {
      console.error('[CRON] pre-due error:', err.message);
    }
  }, { timezone: 'Asia/Bangkok' });

  console.log('[CRON] ✅ pre-due job ตั้งเวลาไว้ที่ 09:00 น. ทุกวัน (Bangkok)');
}

// ===== JOB 3: อัปเดตสถานะ overdue อัตโนมัติ — ทุกชั่วโมง =====
function startStatusUpdateJob() {
  cron.schedule('0 * * * *', async () => {
    try {
      const result = await db.query(`
        UPDATE tasks SET status = 'overdue'
        WHERE status NOT IN ('done', 'overdue')
        AND due_date < CURRENT_DATE
      `);
      if (result.rowCount > 0) {
        console.log(`[CRON] อัปเดต ${result.rowCount} งานเป็น overdue`);
      }
    } catch (err) {
      console.error('[CRON] status update error:', err.message);
    }
  });
}

function startAll() {
  startOverdueJob();
  startPreDueJob();
  startStatusUpdateJob();
  console.log('[SCHEDULER] 🕐 เริ่ม scheduler ทั้งหมดแล้ว');
}

module.exports = { startAll };
