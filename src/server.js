// backend/src/server.js

const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const http = require('http');
const socketManager = require('./socketManager'); // <-- 1. IMPORT the manager

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
const httpServer = http.createServer(app);

// CORS Configuration
const allowedOrigins = [
  'http://localhost:3000', 
  'https://whatsapp-campaign-manager-frontend.vercel.app',
  'https://whatsapp-campaign-manager-frontend-fhmhx0aob.vercel.app'
];
const corsOptions = {
  origin: allowedOrigins,
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: true,
};
app.use(cors(corsOptions));

// --- 2. INITIALIZE Socket.IO using the manager ---
const io = socketManager.init(httpServer, { origin: allowedOrigins });

io.on('connection', (socket) => {
  console.log('🔌 A user connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('🔌 User disconnected:', socket.id);
  });
});

app.use(express.json());

const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send('✅ Backend server is live and connected to MongoDB!');
});

// Mount The Routes (no middleware needed here anymore)
app.use('/api/auth', authRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/replies', replyRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/logs', logRoutes);

httpServer.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  startScheduler();
});