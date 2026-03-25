# TaskFlow Backend — คู่มือติดตั้งและ Deploy

## ภาพรวมระบบ

```
Frontend (HTML/JS)  ←→  Backend API (Node.js)  ←→  Database (PostgreSQL/Supabase)
                              ↓
                    Email (Gmail SMTP) + Line (Messaging API)
                              ↓
                    Scheduler (Cron Jobs อัตโนมัติ)
```

---

## ขั้นตอนที่ 1 — ตั้งค่า Database (Supabase · ฟรี)

1. ไปที่ **[supabase.com](https://supabase.com)** → Sign up ฟรี
2. **New Project** → ตั้งชื่อ `taskflow` → เลือก Region `Southeast Asia (Singapore)`
3. ไปที่ **Settings → Database → Connection string → URI**
4. คัดลอก connection string (แบบ `postgresql://postgres:...`)
5. เก็บไว้ใส่ใน `.env` ที่ `DATABASE_URL`

---

## ขั้นตอนที่ 2 — ตั้งค่า Email (Gmail · ฟรีไม่จำกัด)

1. ไปที่ **[myaccount.google.com](https://myaccount.google.com)**
2. **Security** → เปิด **2-Step Verification** ก่อน
3. **App passwords** → เลือก App: `Mail` → Generate
4. คัดลอก **16 หลัก** (เช่น `abcd efgh ijkl mnop`)
5. ใส่ใน `.env`:
   ```
   GMAIL_USER=your.email@gmail.com
   GMAIL_APP_PASSWORD=abcdefghijklmnop
   ```

---

## ขั้นตอนที่ 3 — ตั้งค่า Line (Messaging API · ฟรี 200 ข้อความ/เดือน)

1. ไปที่ **[developers.line.biz](https://developers.line.biz)**
2. **Create Provider** → ตั้งชื่อบริษัท
3. **Create Channel** → เลือก **Messaging API**
4. กรอกข้อมูล Channel → บันทึก
5. **Channel settings** → **Messaging API** tab → **Channel access token** → **Issue**
6. คัดลอก Token ใส่ใน `.env`:
   ```
   LINE_CHANNEL_ACCESS_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxx
   ```
7. **วิธีหา Line User ID ของพนักงาน:**
   - ให้พนักงาน Add บอทเป็นเพื่อน (QR Code อยู่ใน Channel settings)
   - ใช้ Webhook หรือดูใน **Webhook URL logs** เพื่อรับ User ID (เริ่มต้นด้วย `U`)
   - หรือสร้าง endpoint ให้พนักงาน `/api/line/get-uid` แล้วส่ง message มาที่บอท

---

## ขั้นตอนที่ 4 — Run ในเครื่อง (Local Development)

```bash
# 1. Clone / วางไฟล์ลงโฟลเดอร์
cd taskflow-backend

# 2. ติดตั้ง dependencies
npm install

# 3. สร้างไฟล์ .env
cp .env.example .env
# แก้ไขค่าใน .env ให้ครบ

# 4. สร้าง tables ใน database
node db/migrate.js

# 5. รันเซิร์ฟเวอร์
npm run dev   # development (auto-restart)
npm start     # production
```

เซิร์ฟเวอร์จะขึ้นที่ http://localhost:3001

---

## ขั้นตอนที่ 5 — Deploy บน Render.com (ฟรี)

### 5.1 Push ขึ้น GitHub
```bash
git init
git add .
git commit -m "TaskFlow backend v3"
git remote add origin https://github.com/YOUR_USERNAME/taskflow-backend.git
git push -u origin main
```

### 5.2 สร้าง Web Service บน Render
1. ไปที่ **[render.com](https://render.com)** → Sign up → **New Web Service**
2. เชื่อมต่อ GitHub repository
3. ตั้งค่า:
   - **Name:** `taskflow-backend`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** `Free`

### 5.3 ตั้งค่า Environment Variables บน Render
ไปที่ **Environment** tab แล้วเพิ่ม:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | (Supabase connection string) |
| `JWT_SECRET` | (สร้างเอง: รัน `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`) |
| `GMAIL_USER` | your@gmail.com |
| `GMAIL_APP_PASSWORD` | (App Password 16 หลัก) |
| `LINE_CHANNEL_ACCESS_TOKEN` | (จาก Line Developers) |
| `FRONTEND_URL` | https://your-frontend-url.com |
| `NODE_ENV` | production |

### 5.4 Run Migration บน Render
หลัง deploy สำเร็จ ไปที่ **Shell** tab บน Render แล้วรัน:
```bash
node db/migrate.js
```

---

## ขั้นตอนที่ 6 — เชื่อมต่อ Frontend

แก้ไข `task-tracker.html` เพิ่ม API URL ที่บนสุดของ `<script>`:

```javascript
const API_URL = 'https://taskflow-backend.onrender.com/api';
const token = localStorage.getItem('tf_token');

// Login
const res = await fetch(`${API_URL}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password })
});
const { token, user } = await res.json();
localStorage.setItem('tf_token', token);

// สร้างงาน
await fetch(`${API_URL}/tasks`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ title, assigneeName, dept, dueDate, priority, channels: ['app','email','line'] })
});
```

---

## API Endpoints ทั้งหมด

### Auth
| Method | Endpoint | คำอธิบาย |
|--------|----------|-----------|
| POST | `/api/auth/register` | สมัครสมาชิก |
| POST | `/api/auth/login` | เข้าสู่ระบบ |
| GET | `/api/auth/me` | ดูข้อมูลตัวเอง |
| PUT | `/api/auth/profile` | แก้ไขโปรไฟล์ |
| PUT | `/api/auth/password` | เปลี่ยนรหัสผ่าน |
| PUT | `/api/auth/settings` | ตั้งค่าการแจ้งเตือน |

### Tasks
| Method | Endpoint | คำอธิบาย |
|--------|----------|-----------|
| GET | `/api/tasks` | ดูงานทั้งหมด (filter ได้) |
| GET | `/api/tasks/:id` | ดูงานชิ้นเดียว |
| POST | `/api/tasks` | สร้างงานใหม่ + แนบไฟล์ |
| PATCH | `/api/tasks/:id` | อัปเดตสถานะ/ข้อมูล |
| DELETE | `/api/tasks/:id` | ลบงาน |
| POST | `/api/tasks/:id/submit` | ส่งงาน + แนบไฟล์ผลงาน |
| POST | `/api/tasks/:id/remind` | ส่งแจ้งเตือนด้วยตนเอง |
| GET | `/api/tasks/stats/summary` | สถิติ dashboard |
| GET | `/api/tasks/file/:filename` | ดาวน์โหลดไฟล์ |

### Users & Notifications
| Method | Endpoint | คำอธิบาย |
|--------|----------|-----------|
| GET | `/api/users` | ดูผู้ใช้ทั้งหมด |
| GET | `/api/notifications` | ดูการแจ้งเตือน |
| PATCH | `/api/notifications/read-all` | อ่านทั้งหมด |
| DELETE | `/api/notifications` | ล้างการแจ้งเตือน |

---

## Automatic Scheduler (Cron Jobs)

| เวลา | Job | หน้าที่ |
|------|-----|---------|
| 08:00 น. ทุกวัน | Overdue Job | แจ้งเตือนงานเกินกำหนดทาง Email + Line |
| 09:00 น. ทุกวัน | Pre-Due Job | แจ้งก่อนครบกำหนด 1 วัน |
| ทุกชั่วโมง | Status Update | อัปเดตสถานะ overdue อัตโนมัติ |

---

## ค่าใช้จ่าย (ฟรีทั้งหมด!)

| บริการ | แผนฟรี | ข้อจำกัด |
|--------|---------|----------|
| **Render.com** | ✅ ฟรี | Sleep หลังไม่ใช้ 15 นาที (Paid $7/เดือน ไม่ sleep) |
| **Supabase** | ✅ ฟรี | 500MB DB, 5GB bandwidth |
| **Gmail SMTP** | ✅ ฟรี | 500 emails/วัน |
| **Line Messaging API** | ✅ ฟรี | 200 ข้อความ/เดือน |

💡 **Tips:** ถ้าใช้งานจริงในองค์กร แนะนำ Render Starter ($7/เดือน) เพื่อไม่ให้ server หลับ
