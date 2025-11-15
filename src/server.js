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
const userRoutes = require('./routes/userRoutes'); // <-- 1. IMPORT NEW ROUTES
const wabaRoutes = require('./routes/wabaRoutes'); // <-- 1. IMPORT NEW ROUTES
const enquiryRoutes = require('./routes/enquiryRoutes');
const botFlowRoutes = require('./routes/botFlowRoutes'); // <-- 1. IMPORT NEW ROUTES

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

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
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
app.use('/api/users', userRoutes); // <-- 2. USE THE NEW ROUTES
app.use('/api/waba', wabaRoutes); 
app.use('/api/enquiries', enquiryRoutes); // <-- 2. USE THE NEW ROUTES
app.use('/api/bot-flows', botFlowRoutes); // <-- 2. USE THE NEW ROUTES

httpServer.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  startScheduler();
});