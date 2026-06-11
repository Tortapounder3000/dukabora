const express = require('express');
const pool = require('../db');
const { verifyToken, requireManager } = require('../middleware/auth');

const router = express.Router();

// analytics is manager-only
router.use(verifyToken, requireManager);

// GET /api/analytics/summary — today's numbers
router.get('/summary', async (req, res) => {
  try {
    const [summary] = await pool.query(
      `SELECT
        COUNT(*) AS transactions_today,
        COALESCE(SUM(total_amount), 0) AS revenue_today
       FROM sales
       WHERE store_id = ? AND DATE(created_at) = CURDATE()`,
      [req.user.store_id]
    );

    const [profit] = await pool.query(
      `SELECT COALESCE(SUM((si.price_at_sale - si.cost_at_sale) * si.qty), 0) AS profit_today
       FROM sale_items si
       JOIN sales s ON si.sale_id = s.id
       WHERE s.store_id = ? AND DATE(s.created_at) = CURDATE()`,
      [req.user.store_id]
    );

    const [monthRevenue] = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) AS revenue_month
       FROM sales
       WHERE store_id = ? AND MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE())`,
      [req.user.store_id]
    );

    res.json({
  today: {
    total_revenue: today[0].total_revenue,
    total_profit: today[0].total_profit,
    total_transactions: today[0].total_transactions,
  },
  monthly_revenue: month[0].monthly_revenue,
});

  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch summary: ' + err.message });
  }
});

// GET /api/analytics/velocity — fast movers + dead stock (last 30 days)
router.get('/velocity', async (req, res) => {
  try {
    const [fastMovers] = await pool.query(
      `SELECT p.id, p.name, p.sku, p.stock_qty, SUM(si.qty) AS units_sold
       FROM sale_items si
       JOIN sales s ON si.sale_id = s.id
       JOIN products p ON si.product_id = p.id
       WHERE s.store_id = ? AND s.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY p.id
       ORDER BY units_sold DESC
       LIMIT 5`,
      [req.user.store_id]
    );

    const [deadStock] = await pool.query(
      `SELECT p.id, p.name, p.sku, p.stock_qty,
              COALESCE(SUM(CASE WHEN s.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN si.qty END), 0) AS units_sold
       FROM products p
       LEFT JOIN sale_items si ON si.product_id = p.id
       LEFT JOIN sales s ON si.sale_id = s.id AND s.store_id = p.store_id
       WHERE p.store_id = ? AND p.deleted_at IS NULL
       GROUP BY p.id
       ORDER BY units_sold ASC
       LIMIT 5`,
      [req.user.store_id]
    );

    res.json({ fast_movers: fastMovers, dead_stock: deadStock });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch velocity: ' + err.message });
  }
});

// GET /api/analytics/margins — highest profit margin products
router.get('/margins', async (req, res) => {
  try {
    const [margins] = await pool.query(
      `SELECT p.id, p.name, p.sku,
              SUM(si.qty) AS units_sold,
              SUM((si.price_at_sale - si.cost_at_sale) * si.qty) AS total_profit
       FROM sale_items si
       JOIN sales s ON si.sale_id = s.id
       JOIN products p ON si.product_id = p.id
       WHERE s.store_id = ? AND s.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY p.id
       ORDER BY total_profit DESC
       LIMIT 5`,
      [req.user.store_id]
    );

    res.json(margins);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch margins: ' + err.message });
  }

});

module.exports = router;