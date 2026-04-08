// db/migrate.js
// รัน: node db/migrate.js
// จะสร้าง tables ทั้งหมดใน PostgreSQL (Supabase)

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const schema = `
-- ===== USERS =====
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username    VARCHAR(50) UNIQUE NOT NULL,
  password    TEXT NOT NULL,
  name        VARCHAR(100) NOT NULL,
  dept        VARCHAR(50) NOT NULL,
  email       VARCHAR(100) UNIQUE,
  line_uid    VARCHAR(100),
  role        VARCHAR(20) DEFAULT 'member' CHECK (role IN ('admin','member')),
  avatar_color VARCHAR(20) DEFAULT '#4f7aff',
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ===== TASKS =====
CREATE TABLE IF NOT EXISTS tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  assignee_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  assignee_name   VARCHAR(100) NOT NULL,
  assignee_email  VARCHAR(100),
  assignee_line_uid VARCHAR(100),
  dept            VARCHAR(50) NOT NULL,
  due_date        DATE NOT NULL,
  priority        VARCHAR(10) DEFAULT 'mid' CHECK (priority IN ('high','mid','low')),
  tag             VARCHAR(50),
  note            TEXT,
  status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','inprogress','overdue','done')),
  progress        INT DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  assigned_by_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_by_name VARCHAR(100) NOT NULL,
  assigned_by_email VARCHAR(100),
  last_reminded_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ===== TASK FILES (files attached when creating task) =====
CREATE TABLE IF NOT EXISTS task_files (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  filename    VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  file_size   BIGINT,
  mime_type   VARCHAR(100),
  file_type   VARCHAR(20) DEFAULT 'attachment' CHECK (file_type IN ('attachment','submission')),
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ===== TASK TIMELINE =====
CREATE TABLE IF NOT EXISTS task_timeline (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  event_text  TEXT NOT NULL,
  event_type  VARCHAR(20) DEFAULT 'info' CHECK (event_type IN ('done','warn','danger','info')),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ===== NOTIFICATIONS =====
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id     UUID REFERENCES tasks(id) ON DELETE CASCADE,
  message     TEXT NOT NULL,
  type        VARCHAR(20) DEFAULT 'info' CHECK (type IN ('success','danger','warn','info')),
  channel     VARCHAR(20) DEFAULT 'app' CHECK (channel IN ('app','email','line')),
  is_read     BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ===== SETTINGS (per user) =====
CREATE TABLE IF NOT EXISTS user_settings (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  line_uid        VARCHAR(100),
  notify_email    BOOLEAN DEFAULT true,
  notify_line     BOOLEAN DEFAULT false,
  notify_pre_due  BOOLEAN DEFAULT true,
  notify_overdue  BOOLEAN DEFAULT true,
  notify_submit   BOOLEAN DEFAULT true,
  remind_freq_days INT DEFAULT 3,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ===== TASK TOKENS (สำหรับกดอัปเดตผ่าน LINE/Email) =====
CREATE TABLE IF NOT EXISTS task_tokens (
  token       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  action      VARCHAR(50) DEFAULT 'mark_done',
  is_used     BOOLEAN DEFAULT false,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ===== INDEXES =====
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by ON tasks(assigned_by_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_task_files_task ON task_files(task_id);
CREATE INDEX IF NOT EXISTS idx_timeline_task ON task_timeline(task_id);
CREATE INDEX IF NOT EXISTS idx_task_tokens ON task_tokens(token);

-- ===== AUTO UPDATE updated_at =====
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_tasks_updated ON tasks;
CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔄 กำลังสร้าง tables...');
    await client.query(schema);
    console.log('✅ สร้าง tables เรียบร้อย');

    // Insert default admin user
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('admin123', 10);
    await client.query(`
      INSERT INTO users (username, password, name, dept, email, role, avatar_color)
      VALUES ('admin', $1, 'ผู้ดูแลระบบ', 'Management', 'admin@company.com', 'admin', '#4f7aff')
      ON CONFLICT (username) DO NOTHING
    `, [hash]);
    await client.query(`
      INSERT INTO user_settings (user_id)
      SELECT id FROM users WHERE username = 'admin'
      ON CONFLICT (user_id) DO NOTHING
    `);
    console.log('✅ สร้าง admin user เรียบร้อย (username: admin / password: admin123)');
    console.log('⚠️  กรุณาเปลี่ยนรหัสผ่าน admin ทันทีหลัง deploy!');
  } catch (err) {
    console.error('❌ Migration error:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();