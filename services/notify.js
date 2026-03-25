// services/notify.js
// บริการส่งแจ้งเตือนทาง Email (Gmail) และ Line Messaging API

const nodemailer = require('nodemailer');
const axios = require('axios');
const db = require('../db');

// ===== EMAIL TRANSPORTER =====
let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }
  return transporter;
}

// ===== EMAIL TEMPLATES =====
function emailTemplate(title, body, ctaText, ctaLink) {
  return `
<!DOCTYPE html>
<html lang="th">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
  body{margin:0;padding:0;background:#f4f6f9;font-family:'Sarabun',Arial,sans-serif;}
  .wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08);}
  .header{background:linear-gradient(135deg,#0d1628,#1a2a4a);padding:28px 32px;text-align:center;}
  .logo{font-size:22px;font-weight:800;color:#fff;letter-spacing:-1px;}
  .logo span{color:#4f7aff;}
  .body{padding:32px;}
  .title{font-size:20px;font-weight:700;color:#1a1a2e;margin-bottom:16px;}
  .content{font-size:14px;color:#4a5568;line-height:1.8;}
  .info-box{background:#f8faff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:20px 0;}
  .info-row{display:flex;gap:8px;margin-bottom:8px;font-size:13px;}
  .info-label{color:#718096;min-width:110px;}
  .info-value{color:#2d3748;font-weight:600;}
  .cta{text-align:center;margin:28px 0 8px;}
  .cta a{background:#4f7aff;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;}
  .footer{background:#f8faff;padding:16px 32px;text-align:center;font-size:11px;color:#a0aec0;border-top:1px solid #e2e8f0;}
  .badge-danger{background:#fff0f3;color:#e53e3e;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:700;}
  .badge-warn{background:#fffaf0;color:#d69e2e;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:700;}
  .badge-success{background:#f0fff4;color:#38a169;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:700;}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo">Task<span>Flow</span></div>
    <div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:4px;">ระบบติดตามและมอบหมายงาน</div>
  </div>
  <div class="body">
    <div class="title">${title}</div>
    <div class="content">${body}</div>
    ${ctaText && ctaLink ? `<div class="cta"><a href="${ctaLink}">${ctaText}</a></div>` : ''}
  </div>
  <div class="footer">
    อีเมลนี้ส่งโดยอัตโนมัติจาก TaskFlow · กรุณาอย่าตอบกลับ<br>
    ${new Date().toLocaleDateString('th-TH', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}
  </div>
</div>
</body>
</html>`;
}

function buildTaskInfoBox(task) {
  const due = new Date(task.due_date).toLocaleDateString('th-TH', { day:'numeric', month:'long', year:'numeric' });
  const priMap = { high:'<span class="badge-danger">🔴 เร่งด่วน</span>', mid:'<span class="badge-warn">🟡 ปานกลาง</span>', low:'ปกติ' };
  return `
    <div class="info-box">
      <div class="info-row"><span class="info-label">📋 งาน</span><span class="info-value">${task.title}</span></div>
      <div class="info-row"><span class="info-label">📅 กำหนดส่ง</span><span class="info-value">${due}</span></div>
      <div class="info-row"><span class="info-label">⚡ ความสำคัญ</span><span class="info-value">${priMap[task.priority]||task.priority}</span></div>
      ${task.description ? `<div class="info-row"><span class="info-label">📝 รายละเอียด</span><span class="info-value">${task.description}</span></div>` : ''}
      ${task.note ? `<div class="info-row"><span class="info-label">💬 หมายเหตุ</span><span class="info-value">${task.note}</span></div>` : ''}
    </div>`;
}

// ===== SEND EMAIL =====
async function sendEmail({ to, toName, subject, title, body, ctaText, ctaLink }) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.log('[EMAIL SKIP] ไม่ได้ตั้งค่า Gmail credentials');
    return { success: false, reason: 'not_configured' };
  }
  try {
    const info = await getTransporter().sendMail({
      from: `"${process.env.EMAIL_FROM_NAME || 'TaskFlow'}" <${process.env.GMAIL_USER}>`,
      to: toName ? `"${toName}" <${to}>` : to,
      subject,
      html: emailTemplate(title, body, ctaText, ctaLink),
    });
    console.log(`[EMAIL ✅] ${to} — ${subject} (${info.messageId})`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[EMAIL ❌] ${to} — ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ===== SEND LINE =====
async function sendLine({ lineUid, message }) {
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    console.log('[LINE SKIP] ไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN');
    return { success: false, reason: 'not_configured' };
  }
  if (!lineUid) {
    console.log('[LINE SKIP] ไม่มี Line UID');
    return { success: false, reason: 'no_uid' };
  }
  try {
    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: lineUid,
      messages: [{ type: 'text', text: message }]
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(`[LINE ✅] ${lineUid.substring(0,10)}...`);
    return { success: true };
  } catch (err) {
    const errMsg = err.response?.data?.message || err.message;
    console.error(`[LINE ❌] ${lineUid} — ${errMsg}`);
    return { success: false, error: errMsg };
  }
}

// ===== SAVE NOTIFICATION TO DB =====
async function saveNotification({ userId, taskId, message, type = 'info', channel = 'app' }) {
  try {
    await db.query(
      `INSERT INTO notifications (user_id, task_id, message, type, channel) VALUES ($1, $2, $3, $4, $5)`,
      [userId, taskId, message, type, channel]
    );
  } catch (err) {
    console.error('saveNotification error:', err.message);
  }
}

// ===== HIGH-LEVEL: NOTIFY TASK ASSIGNED =====
async function notifyAssigned(task, channels = ['app']) {
  const appUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const due = new Date(task.due_date).toLocaleDateString('th-TH', { day:'numeric', month:'long', year:'numeric' });

  if (channels.includes('app') && task.assignee_id) {
    await saveNotification({
      userId: task.assignee_id, taskId: task.id,
      message: `📋 คุณได้รับมอบหมายงานใหม่: "${task.title}" กำหนดส่ง ${due}`,
      type: 'info', channel: 'app'
    });
  }

  if (channels.includes('email') && task.assignee_email) {
    await sendEmail({
      to: task.assignee_email, toName: task.assignee_name,
      subject: `[TaskFlow] งานใหม่: ${task.title}`,
      title: `📋 คุณได้รับมอบหมายงานใหม่`,
      body: `สวัสดีคุณ <strong>${task.assignee_name}</strong>,<br><br>
             คุณได้รับมอบหมายงานจาก <strong>${task.assigned_by_name}</strong>
             ${buildTaskInfoBox(task)}
             กรุณาดำเนินการให้แล้วเสร็จภายในกำหนด`,
      ctaText: 'ดูรายละเอียดงาน',
      ctaLink: `${appUrl}/tasks/${task.id}`
    });
  }

  if (channels.includes('line') && task.assignee_line_uid) {
    await sendLine({
      lineUid: task.assignee_line_uid,
      message: `📋 TaskFlow — งานใหม่!\n\nงาน: ${task.title}\nมอบหมายโดย: ${task.assigned_by_name}\nกำหนดส่ง: ${due}\nความสำคัญ: ${task.priority === 'high' ? '🔴 เร่งด่วน' : task.priority === 'mid' ? '🟡 ปานกลาง' : '🟢 ปกติ'}\n\nเข้าดูรายละเอียด: ${appUrl}`
    });
  }
}

// ===== HIGH-LEVEL: NOTIFY SUBMITTED =====
async function notifySubmitted(task, submissionNote, channels = ['app']) {
  const appUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  if (channels.includes('app') && task.assigned_by_id) {
    await saveNotification({
      userId: task.assigned_by_id, taskId: task.id,
      message: `✅ ${task.assignee_name} ส่งงาน "${task.title}" แล้ว`,
      type: 'success', channel: 'app'
    });
  }

  if (channels.includes('email') && task.assigned_by_email) {
    await sendEmail({
      to: task.assigned_by_email, toName: task.assigned_by_name,
      subject: `[TaskFlow] ส่งงานแล้ว: ${task.title}`,
      title: `✅ ${task.assignee_name} ส่งงานแล้ว`,
      body: `<strong>${task.assignee_name}</strong> ได้ส่งงาน <strong>${task.title}</strong> เรียบร้อยแล้ว
             ${buildTaskInfoBox(task)}
             ${submissionNote ? `<br><strong>หมายเหตุการส่ง:</strong> ${submissionNote}` : ''}`,
      ctaText: 'ตรวจสอบงาน',
      ctaLink: `${appUrl}/tasks/${task.id}`
    });
  }

  if (channels.includes('line') && task.assigned_by_line_uid) {
    await sendLine({
      lineUid: task.assigned_by_line_uid,
      message: `✅ TaskFlow — ส่งงานแล้ว!\n\n${task.assignee_name} ส่งงาน "${task.title}" แล้ว\n${submissionNote ? 'หมายเหตุ: ' + submissionNote : ''}\n\nตรวจสอบที่: ${appUrl}`
    });
  }
}

// ===== HIGH-LEVEL: NOTIFY REMINDER =====
async function notifyReminder(task, customMessage, channels = ['app']) {
  const appUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const due = new Date(task.due_date).toLocaleDateString('th-TH', { day:'numeric', month:'long', year:'numeric' });
  const today = new Date();
  const dueDate = new Date(task.due_date);
  const diffDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
  const isOverdue = diffDays < 0;
  const msg = customMessage || (isOverdue
    ? `⚠️ งาน "${task.title}" เกินกำหนดส่งแล้ว ${Math.abs(diffDays)} วัน! กรุณาส่งงานโดยด่วน`
    : `🔔 แจ้งเตือน: งาน "${task.title}" ครบกำหนดในอีก ${diffDays} วัน (${due})`);

  if (channels.includes('app') && task.assignee_id) {
    await saveNotification({
      userId: task.assignee_id, taskId: task.id,
      message: msg, type: isOverdue ? 'danger' : 'warn', channel: 'app'
    });
  }

  if (channels.includes('email') && task.assignee_email) {
    await sendEmail({
      to: task.assignee_email, toName: task.assignee_name,
      subject: `[TaskFlow] ${isOverdue ? '⚠️ เกินกำหนด' : '🔔 แจ้งเตือน'}: ${task.title}`,
      title: isOverdue ? `⚠️ งานเกินกำหนด!` : `🔔 แจ้งเตือนกำหนดส่งงาน`,
      body: `สวัสดีคุณ <strong>${task.assignee_name}</strong>,<br><br>${msg}
             ${buildTaskInfoBox(task)}
             <br>กรุณาส่งงานหรือแจ้งความคืบหน้าโดยด่วน`,
      ctaText: 'ส่งงาน / อัปเดตสถานะ',
      ctaLink: `${appUrl}/tasks/${task.id}`
    });
  }

  if (channels.includes('line') && task.assignee_line_uid) {
    await sendLine({
      lineUid: task.assignee_line_uid,
      message: `${isOverdue ? '⚠️' : '🔔'} TaskFlow\n\n${msg}\n\nผู้มอบหมาย: ${task.assigned_by_name}\n\nส่งงาน: ${appUrl}`
    });
  }
}

module.exports = { sendEmail, sendLine, saveNotification, notifyAssigned, notifySubmitted, notifyReminder };
