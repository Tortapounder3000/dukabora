const express = require('express');
const pool = require('../db');
const { verifyToken, requireManager } = require('../middleware/auth');

const router = express.Router();

router.use(verifyToken, requireManager);

router.get('/summary', async (req, res) => {
  try {
    const [summary] = await pool.query(
      `SELECT COUNT(*) AS transactions_today, COALESCE(SUM(total_amount), 0) AS revenue_today
       FROM sales WHERE store_id = ? AND DATE(created_at) = CURDATE()`,
      [req.user.store_id]
    );

    const [profit] = await pool.query(
      `SELECT COALESCE(SUM((si.price_at_sale - si.cost_at_sale) * si.qty), 0) AS profit_today
       FROM sale_items si JOIN sales s ON si.sale_id = s.id
       WHERE s.store_id = ? AND DATE(s.created_at) = CURDATE()`,
      [req.user.store_id]
    );

    const [monthRevenue] = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) AS revenue_month
       FROM sales WHERE store_id = ? AND MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE())`,
      [req.user.store_id]
    );

    res.json({
      today: {
        total_revenue: summary[0].revenue_today || 0,
        total_profit: profit[0].profit_today || 0,
        total_transactions: summary[0].transactions_today || 0,
      },
      monthly_revenue: monthRevenue[0].revenue_month || 0,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch summary: ' + err.message });
  }
});

router.get('/velocity', async (req, res) => {
  try {
    const [fastMovers] = await pool.query(
      `SELECT p.id, p.name, p.sku, p.category, p.stock_qty, SUM(si.qty) AS total_sold
       FROM sale_items si
       JOIN sales s ON si.sale_id = s.id
       JOIN products p ON si.product_id = p.id
       WHERE s.store_id = ? AND s.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY p.id
       ORDER BY total_sold DESC
       LIMIT 5`,
      [req.user.store_id]
    );

    const [deadStock] = await pool.query(
      `SELECT p.id, p.name, p.sku, p.category, p.stock_qty,
              COALESCE(SUM(CASE WHEN s.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN si.qty END), 0) AS total_sold
       FROM products p
       LEFT JOIN sale_items si ON si.product_id = p.id
       LEFT JOIN sales s ON si.sale_id = s.id AND s.store_id = p.store_id
       WHERE p.store_id = ? AND p.deleted_at IS NULL
       GROUP BY p.id
       ORDER BY total_sold ASC
       LIMIT 5`,
      [req.user.store_id]
    );

    res.json({ fast_movers: fastMovers, slow_movers: deadStock });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch velocity: ' + err.message });
  }
});

router.get('/margins', async (req, res) => {
  try {
    const [margins] = await pool.query(
      `SELECT p.id, p.name, p.sku, p.category,
              p.cost_price, p.selling_price,
              ROUND(((p.selling_price - p.cost_price) / p.selling_price) * 100, 1) AS margin_percent,
              COALESCE(SUM(si.qty), 0) AS total_sold,
              COALESCE(SUM((si.price_at_sale - si.cost_at_sale) * si.qty), 0) AS total_profit_generated
       FROM products p
       LEFT JOIN sale_items si ON p.id = si.product_id
       WHERE p.store_id = ? AND p.deleted_at IS NULL
       GROUP BY p.id
       ORDER BY margin_percent DESC
       LIMIT 10`,
      [req.user.store_id]
    );
    res.json(margins);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch margins: ' + err.message });
  }
});

router.get('/low-stock', async (req, res) => {
  try {
    const [products] = await pool.query(
      `SELECT id, name, sku, stock_qty, low_stock_threshold
       FROM products
       WHERE store_id = ? AND deleted_at IS NULL AND stock_qty <= low_stock_threshold
       ORDER BY stock_qty ASC`,
      [req.user.store_id]
    );
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch low stock: ' + err.message });
  }
});

module.exports = router;
