const express = require('express');
const cors = require('cors');
require('dotenv').config();
require('./db');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', require('./routes/auth'));

app.use('/api/products', require('./routes/products'));

app.use('/api/sales', require('./routes/sales'));

app.use('/api/analytics', require('./routes/analytics'));app.use('/api/analytics', require('./routes/analytics'));

app.get('/', (req, res) => {
  res.json({ message: 'Dukabora API is running 🚀' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});