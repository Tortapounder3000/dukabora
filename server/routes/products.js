const express = require('express');
const pool = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// all product routes require a valid token
router.use(verifyToken);

// GET /api/products — all products for the logged-in store
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

// GET /api/products/sku/:sku — lookup by barcode/SKU (used by the POS scanner)
router.get('/sku/:sku', async (req, res) => {
  try {
    const [products] = await pool.query(
      'SELECT * FROM products WHERE store_id = ? AND sku = ? AND deleted_at IS NULL',
      [req.user.store_id, req.params.sku]
    );
    if (products.length === 0) {
      return res.status(404).json({ error: 'Product not found.' });
    }
    res.json(products[0]);
  } catch (err) {
    res.status(500).json({ error: 'Lookup failed: ' + err.message });
  }
});

// POST /api/products — add a product
router.post('/', async (req, res) => {
  const { sku, name, category, cost_price, selling_price, stock_qty, low_stock_threshold } = req.body;

  if (!sku || !name || selling_price === undefined) {
    return res.status(400).json({ error: 'sku, name and selling_price are required.' });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO products (store_id, sku, name, category, cost_price, selling_price, stock_qty, low_stock_threshold)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.store_id,
        sku,
        name,
        category || null,
        cost_price || 0,
        selling_price,
        stock_qty || 0,
        low_stock_threshold || 5,
      ]
    );

    await pool.query(
      'INSERT INTO audit_logs (store_id, user_id, action_type, description) VALUES (?, ?, ?, ?)',
      [req.user.store_id, req.user.user_id, 'PRODUCT_ADD', `Added product: ${name} (${sku})`]
    );

    res.status(201).json({ message: 'Product added', product_id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A product with this SKU already exists in your store.' });
    }
    res.status(500).json({ error: 'Failed to add product: ' + err.message });
  }
});

// PUT /api/products/:id — edit a product
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

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Product not found.' });
    }

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

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Product not found.' });
    }

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