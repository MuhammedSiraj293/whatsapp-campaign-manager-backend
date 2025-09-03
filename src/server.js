// backend/src/server.js

const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/db');
const campaignRoutes = require('./routes/campaignRoutes');
const recipientRoutes = require('./routes/recipientRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const replyRoutes = require('./routes/replyRoutes');
const authRoutes = require('./routes/authRoutes'); // <-- IMPORT NEW ROUTES

dotenv.config();
connectDB();

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5001;

app.get('/', (req, res) => {
  res.send('✅ Backend server is live and connected to MongoDB!');
});

// Mount The Routes
app.use('/api/campaigns', campaignRoutes);
app.use('/api/recipients', recipientRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/replies', replyRoutes);
app.use('/api/auth', authRoutes); // <-- USE THE NEW ROUTES

app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});