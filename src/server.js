// backend/src/server.js

const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/db');
const campaignRoutes = require('./routes/campaignRoutes');
const recipientRoutes = require('./routes/recipientRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const replyRoutes = require('./routes/replyRoutes');
const authRoutes = require('./routes/authRoutes');

dotenv.config();
connectDB();

const app = express();

// --- THIS IS THE CHANGE ---
// A more robust CORS configuration
const corsOptions = {
  origin: 'http://localhost:3000', // Allow your frontend origin
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE", // Allow all common methods
  credentials: true, // Allow cookies to be sent
  optionsSuccessStatus: 204
};
app.use(cors(corsOptions));
// --- END OF CHANGE ---

app.use(express.json());

const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send('✅ Backend server is live and connected to MongoDB!');
});

// Mount The Routes
app.use('/api/campaigns', campaignRoutes);
app.use('/api/recipients', recipientRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/replies', replyRoutes);
app.use('/api/auth', authRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});