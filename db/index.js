// db/index.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

// Helper: query with auto-release
const query = (text, params) => pool.query(text, params);

// Helper: get client for transactions
const getClient = () => pool.connect();

module.exports = { query, getClient, pool };
