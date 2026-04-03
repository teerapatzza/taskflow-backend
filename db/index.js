// db/index.js
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 10000,
});
pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});
const query = (text, params) => pool.query(text, params);
const getClient = () => pool.connect();
module.exports = { query, getClient, pool };
