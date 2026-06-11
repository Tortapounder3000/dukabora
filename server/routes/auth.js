const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const router = express.Router();

router.post('/register', async (req, res) => {
  const { store_name, email, password } = req.body;
  if (!store_name || !email || !password) {
    return res.status(400).json({ error: 'store_name, email and password are required.' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const store_code = 'DUKA-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    const [storeResult] = await conn.query('INSERT INTO stores (store_name, store_code) VALUES (?, ?)', [store_name, store_code]);
    const store_id = storeResult.insertId;
    const password_hash = await bcrypt.hash(password, 10);
    await conn.query('INSERT INTO users (store_id, email, password_hash, role) VALUES (?, ?, ?, ?)', [store_id, email, password_hash, 'manager']);
    await conn.commit();
    res.status(201).json({ message: 'Store registered successfully', store_code, store_id });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already registered.' });
    res.status(500).json({ error: 'Registration failed: ' + err.message });
  } finally {
    conn.release();
  }
});

router.post('/login', async (req, res) => {
  const { store_code, email, password } = req.body;
  if (!store_code || !email || !password) return res.status(400).json({ error: 'store_code, email and password are required.' });
  try {
    const [stores] = await pool.query('SELECT id FROM stores WHERE store_code = ?', [store_code]);
    if (stores.length === 0) return res.status(404).json({ error: 'Store not found.' });
    const store_id = stores[0].id;
    const [users] = await pool.query('SELECT * FROM users WHERE store_id = ? AND email = ?', [store_id, email]);
    if (users.length === 0) return res.status(401).json({ error: 'Invalid credentials.' });
    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return res.status(401).json({ error: 'Invalid credentials.' });
    const token = jwt.sign({ user_id: user.id, store_id: user.store_id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '12h' });
    res.json({ message: 'Login successful', token, role: user.role, store_id: user.store_id });
  } catch (err) {
    res.status(500).json({ error: 'Login failed: ' + err.message });
  }
});

router.post('/verify-password', async (req, res) => {
  const { password } = req.body;
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token.' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const [users] = await pool.query('SELECT * FROM users WHERE id = ? AND store_id = ? AND role = ?', [decoded.user_id, decoded.store_id, 'manager']);
    if (users.length === 0) return res.status(403).json({ error: 'Not a manager account.' });
    const valid = await bcrypt.compare(password, users[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Wrong password.' });
    res.json({ verified: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
