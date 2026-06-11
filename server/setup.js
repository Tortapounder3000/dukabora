const pool = require('./db');

async function createTables() {
  const conn = await pool.getConnection();
  
  try {
    console.log('Creating tables...');

    await conn.query(`
      CREATE TABLE IF NOT EXISTS stores (
        id INT AUTO_INCREMENT PRIMARY KEY,
        store_name VARCHAR(100) NOT NULL,
        store_code VARCHAR(20) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ stores table');

    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        store_id INT NOT NULL,
        email VARCHAR(100) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('manager', 'storekeeper') DEFAULT 'storekeeper',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (store_id) REFERENCES stores(id),
        UNIQUE KEY unique_email_per_store (store_id, email)
      )
    `);
    console.log('✅ users table');

    await conn.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        store_id INT NOT NULL,
        sku VARCHAR(50) NOT NULL,
        name VARCHAR(150) NOT NULL,
        category VARCHAR(100),
        cost_price DECIMAL(10,2) NOT NULL DEFAULT 0,
        selling_price DECIMAL(10,2) NOT NULL DEFAULT 0,
        stock_qty INT NOT NULL DEFAULT 0,
        low_stock_threshold INT DEFAULT 5,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (store_id) REFERENCES stores(id),
        UNIQUE KEY unique_sku_per_store (store_id, sku)
      )
    `);
    console.log('✅ products table');

    await conn.query(`
      CREATE TABLE IF NOT EXISTS sales (
        id INT AUTO_INCREMENT PRIMARY KEY,
        store_id INT NOT NULL,
        user_id INT NOT NULL,
        total_amount DECIMAL(10,2) NOT NULL,
        tax_amount DECIMAL(10,2) DEFAULT 0,
        payment_method ENUM('cash', 'card', 'mobile') DEFAULT 'cash',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (store_id) REFERENCES stores(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    console.log('✅ sales table');

    await conn.query(`
      CREATE TABLE IF NOT EXISTS sale_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sale_id INT NOT NULL,
        product_id INT NOT NULL,
        qty INT NOT NULL,
        price_at_sale DECIMAL(10,2) NOT NULL,
        cost_at_sale DECIMAL(10,2) NOT NULL,
        FOREIGN KEY (sale_id) REFERENCES sales(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);
    console.log('✅ sale_items table');

    await conn.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        store_id INT NOT NULL,
        user_id INT NOT NULL,
        action_type VARCHAR(50) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (store_id) REFERENCES stores(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    console.log('✅ audit_logs table');

    console.log('\n🚀 All tables created successfully!');
  } catch (err) {
    console.error('❌ Error creating tables:', err.message);
  } finally {
    conn.release();
    process.exit();
  }
}

createTables();