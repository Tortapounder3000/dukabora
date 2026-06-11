const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false },
  waitForConnections: true,
  connectionLimit: 10,
});

async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log('✅ Connected to Aiven MySQL — dukabora-db');
    conn.release();
  } catch (err) {
    console.error('❌ DB connection failed:', err.message);
  }
}

async function runMigrations() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pending_products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        store_id INT NOT NULL,
        submitted_by INT NOT NULL,
        sku VARCHAR(100) NOT NULL,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100),
        cost_price DECIMAL(10,2) DEFAULT 0.00,
        selling_price DECIMAL(10,2) NOT NULL,
        stock_qty INT DEFAULT 0,
        low_stock_threshold INT DEFAULT 5,
        status ENUM('pending','approved','rejected') DEFAULT 'pending',
        rejection_reason TEXT,
        reviewed_by INT,
        reviewed_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (store_id) REFERENCES stores(id),
        FOREIGN KEY (submitted_by) REFERENCES users(id)
      )
    `);
    console.log('✅ Migrations applied');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  }
}

testConnection();
runMigrations();

module.exports = pool;