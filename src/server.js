// backend/src/server.js

const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');

// Load environment variables first
dotenv.config();

const connectDB = require('./config/db');
const { startScheduler } = require('./jobs/scheduler');

// Route Imports
const campaignRoutes = require('./routes/campaignRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const replyRoutes = require('./routes/replyRoutes');
const authRoutes = require('./routes/authRoutes');
const contactRoutes = require('./routes/contactRoutes');
const mediaRoutes = require('./routes/mediaRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const logRoutes = require('./routes/logRoutes');

connectDB();

const app = express();

// CORS Configuration
const corsOptions = {
  origin: [
      'http://localhost:3000', 
      'https://whatsapp-campaign-manager-frontend.vercel.app',
      'https://whatsapp-campaign-manager-frontend-fhmhx0aob.vercel.app' // Add all your Vercel URLs
    ],
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: true,
  optionsSuccessStatus: 204
};
app.use(cors(corsOptions));

app.use(express.json());

const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send('✅ Backend server is live and connected to MongoDB!');
});

// Mount The Routes
app.use('/api/auth', authRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/replies', replyRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/logs', logRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  startScheduler();
});