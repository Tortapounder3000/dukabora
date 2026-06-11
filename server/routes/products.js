const express = require('express');
const pool = require('../db');
const { verifyToken, requireManager } = require('../middleware/auth');

const router = express.Router();

router.use(verifyToken);

// GET /api/products
router.get('/', async (req, res) => {
  try {
    const [products] = await pool.query(
      'SELECT * FROM products WHERE store_id = ? AND deleted_at IS NULL ORDER BY name ASC',
      [req.user.store_id]
    );
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch products: ' + err.message });
  }
});

// GET /api/products/pending — manager only
router.get('/pending', requireManager, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT pp.*, u.email AS submitter_email
       FROM pending_products pp
       JOIN users u ON pp.submitted_by = u.id
       WHERE pp.store_id = ? AND pp.status = 'pending'
       ORDER BY pp.created_at DESC`,
      [req.user.store_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pending products: ' + err.message });
  }
});

// GET /api/products/sku/:sku — barcode/SKU lookup
router.get('/sku/:sku', async (req, res) => {
  try {
    const [products] = await pool.query(
      'SELECT * FROM products WHERE store_id = ? AND sku = ? AND deleted_at IS NULL',
      [req.user.store_id, req.params.sku]
    );
    if (products.length === 0) return res.status(404).json({ error: 'Product not found.' });
    res.json(products[0]);
  } catch (err) {
    res.status(500).json({ error: 'Lookup failed: ' + err.message });
  }
});

// POST /api/products — add directly (manager) or submit pending (storekeeper)
router.post('/', async (req, res) => {
  const { sku, name, category, cost_price, selling_price, stock_qty, low_stock_threshold } = req.body;

  if (!sku || !name || selling_price === undefined) {
    return res.status(400).json({ error: 'sku, name and selling_price are required.' });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO products (store_id, sku, name, category, cost_price, selling_price, stock_qty, low_stock_threshold)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.store_id, sku, name, category || null, cost_price || 0, selling_price, stock_qty || 0, low_stock_threshold || 5]
    );

    await pool.query(
      'INSERT INTO audit_logs (store_id, user_id, action_type, description) VALUES (?, ?, ?, ?)',
      [req.user.store_id, req.user.user_id, 'PRODUCT_ADD', `Added product: ${name} (${sku})`]
    );

    res.status(201).json({ message: 'Product added', product_id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A product with this SKU already exists.' });
    res.status(500).json({ error: 'Failed to add product: ' + err.message });
  }
});

// POST /api/products/pending — storekeeper submits for approval
router.post('/pending', async (req, res) => {
  const { sku, name, category, cost_price, selling_price, stock_qty, low_stock_threshold } = req.body;

  if (!sku || !name || selling_price === undefined) {
    return res.status(400).json({ error: 'sku, name and selling_price are required.' });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO pending_products (store_id, submitted_by, sku, name, category, cost_price, selling_price, stock_qty, low_stock_threshold)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.store_id, req.user.user_id, sku, name, category || null, cost_price || 0, selling_price, stock_qty || 0, low_stock_threshold || 5]
    );
    res.status(201).json({ message: 'Product submitted for approval', pending_id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit product: ' + err.message });
  }
});

// POST /api/products/pending/:id/approve — manager approves, moves to products
router.post('/pending/:id/approve', requireManager, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      "SELECT * FROM pending_products WHERE id = ? AND store_id = ? AND status = 'pending'",
      [req.params.id, req.user.store_id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Pending product not found.' });
    const p = rows[0];

    const [result] = await conn.query(
      `INSERT INTO products (store_id, sku, name, category, cost_price, selling_price, stock_qty, low_stock_threshold)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.store_id, p.sku, p.name, p.category, p.cost_price, p.selling_price, p.stock_qty, p.low_stock_threshold]
    );

    await conn.query(
      "UPDATE pending_products SET status = 'approved', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?",
      [req.user.user_id, req.params.id]
    );

    await conn.query(
      'INSERT INTO audit_logs (store_id, user_id, action_type, description) VALUES (?, ?, ?, ?)',
      [req.user.store_id, req.user.user_id, 'PRODUCT_ADD', `Approved pending product: ${p.name} (${p.sku})`]
    );

    await conn.commit();
    res.json({ message: 'Product approved', product_id: result.insertId });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A product with this SKU already exists.' });
    res.status(500).json({ error: 'Approval failed: ' + err.message });
  } finally {
    conn.release();
  }
});

// POST /api/products/pending/:id/reject — manager rejects
router.post('/pending/:id/reject', requireManager, async (req, res) => {
  const { reason } = req.body;
  try {
    const [result] = await pool.query(
      "UPDATE pending_products SET status = 'rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ? AND store_id = ? AND status = 'pending'",
      [reason || null, req.user.user_id, req.params.id, req.user.store_id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Pending product not found.' });
    res.json({ message: 'Product rejected' });
  } catch (err) {
    res.status(500).json({ error: 'Rejection failed: ' + err.message });
  }
});

// PUT /api/products/:id — edit
router.put('/:id', async (req, res) => {
  const { name, category, cost_price, selling_price, stock_qty, low_stock_threshold } = req.body;
  try {
    const [result] = await pool.query(
      `UPDATE products
       SET name = COALESCE(?, name),
           category = COALESCE(?, category),
           cost_price = COALESCE(?, cost_price),
           selling_price = COALESCE(?, selling_price),
           stock_qty = COALESCE(?, stock_qty),
           low_stock_threshold = COALESCE(?, low_stock_threshold)
       WHERE id = ? AND store_id = ? AND deleted_at IS NULL`,
      [name, category, cost_price, selling_price, stock_qty, low_stock_threshold, req.params.id, req.user.store_id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ error: 'Product not found.' });

    await pool.query(
      'INSERT INTO audit_logs (store_id, user_id, action_type, description) VALUES (?, ?, ?, ?)',
      [req.user.store_id, req.user.user_id, 'PRODUCT_EDIT', `Edited product ID ${req.params.id}`]
    );

    res.json({ message: 'Product updated' });
  } catch (err) {
    res.status(500).json({ error: 'Update failed: ' + err.message });
  }
});

// DELETE /api/products/:id — soft delete
router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.query(
      'UPDATE products SET deleted_at = NOW() WHERE id = ? AND store_id = ? AND deleted_at IS NULL',
      [req.params.id, req.user.store_id]
    );

    if (result.affectedRows === 0) return res.status(404).json({ error: 'Product not found.' });

    await pool.query(
      'INSERT INTO audit_logs (store_id, user_id, action_type, description) VALUES (?, ?, ?, ?)',
      [req.user.store_id, req.user.user_id, 'PRODUCT_DELETE', `Deleted product ID ${req.params.id}`]
    );

    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed: ' + err.message });
  }
});

module.exports = router;
