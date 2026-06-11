const express = require('express');
const pool = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.use(verifyToken);

// POST /api/sales — process a checkout
// expects: { items: [{ product_id, qty }], payment_method }
router.post('/', async (req, res) => {
  const { items, payment_method } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let total_amount = 0;
    const saleItems = [];

    // validate each item and check stock
    for (const item of items) {
      const [rows] = await conn.query(
        'SELECT * FROM products WHERE id = ? AND store_id = ? AND deleted_at IS NULL FOR UPDATE',
        [item.product_id, req.user.store_id]
      );

      if (rows.length === 0) {
        throw new Error(`Product ID ${item.product_id} not found.`);
      }

      const product = rows[0];

      if (product.stock_qty < item.qty) {
        throw new Error(`Not enough stock for ${product.name}. Only ${product.stock_qty} left.`);
      }

      total_amount += parseFloat(product.selling_price) * item.qty;
      saleItems.push({
        product_id: product.id,
        qty: item.qty,
        price_at_sale: product.selling_price,
        cost_at_sale: product.cost_price,
        name: product.name,
      });
    }

    // create the sale record
    const [saleResult] = await conn.query(
      'INSERT INTO sales (store_id, user_id, total_amount, tax_amount, payment_method) VALUES (?, ?, ?, ?, ?)',
      [req.user.store_id, req.user.user_id, total_amount, 0, payment_method || 'cash']
    );
    const sale_id = saleResult.insertId;

    // insert line items + deduct stock
    for (const item of saleItems) {
      await conn.query(
        'INSERT INTO sale_items (sale_id, product_id, qty, price_at_sale, cost_at_sale) VALUES (?, ?, ?, ?, ?)',
        [sale_id, item.product_id, item.qty, item.price_at_sale, item.cost_at_sale]
      );

      await conn.query(
        'UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?',
        [item.qty, item.product_id]
      );
    }

    // audit log
    await conn.query(
      'INSERT INTO audit_logs (store_id, user_id, action_type, description) VALUES (?, ?, ?, ?)',
      [req.user.store_id, req.user.user_id, 'SALE', `Sale #${sale_id} — ${saleItems.length} item(s), total ${total_amount}`]
    );

    await conn.commit();

    res.status(201).json({
      message: 'Sale completed',
      sale_id,
      total_amount,
      items: saleItems.map(i => ({ name: i.name, qty: i.qty, price: i.price_at_sale })),
    });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// GET /api/sales — sales history (supports ?from=YYYY-MM-DD&to=YYYY-MM-DD)
router.get('/', async (req, res) => {
  try {
    let query = `
      SELECT s.id, s.total_amount, s.tax_amount, s.payment_method, s.created_at, u.email AS sold_by
      FROM sales s
      JOIN users u ON s.user_id = u.id
      WHERE s.store_id = ?
    `;
    const params = [req.user.store_id];

    if (req.query.from) {
      query += ' AND s.created_at >= ?';
      params.push(req.query.from);
    }
    if (req.query.to) {
      query += ' AND s.created_at <= ?';
      params.push(req.query.to + ' 23:59:59');
    }

    query += ' ORDER BY s.created_at DESC LIMIT 100';

    const [sales] = await pool.query(query, params);
    res.json(sales);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sales: ' + err.message });
  }
});

// GET /api/sales/:id — single sale with its line items
router.get('/:id', async (req, res) => {
  try {
    const [sales] = await pool.query(
      'SELECT * FROM sales WHERE id = ? AND store_id = ?',
      [req.params.id, req.user.store_id]
    );
    if (sales.length === 0) {
      return res.status(404).json({ error: 'Sale not found.' });
    }

    const [items] = await pool.query(
      `SELECT si.*, p.name, p.sku
       FROM sale_items si
       JOIN products p ON si.product_id = p.id
       WHERE si.sale_id = ?`,
      [req.params.id]
    );

    res.json({ ...sales[0], items });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sale: ' + err.message });
  }
});

module.exports = router;