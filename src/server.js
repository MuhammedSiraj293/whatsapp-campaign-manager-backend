// backend/src/server.js

const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

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
  'https://whatsapp-campaign-manager-frontend-fhmhx0aob.vercel.app' // Add all your Vercel URLs
];
const corsOptions = {
  origin: allowedOrigins,
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: true,
  optionsSuccessStatus: 204
};
app.use(cors(corsOptions));

// Initialize Socket.IO Server
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  }
});

// Middleware to attach io to requests, making it available in controllers
const socketIoMiddleware = (req, res, next) => {
  req.io = io;
  next();
};

app.use(express.json());

const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send('✅ Backend server is live and connected to MongoDB!');
});

// Mount The Routes
// Apply the socket middleware to all routes that might need it
app.use('/api/auth', authRoutes);
app.use('/api/campaigns', socketIoMiddleware, campaignRoutes);
app.use('/api/replies', socketIoMiddleware, replyRoutes);
app.use('/api/webhook', socketIoMiddleware, webhookRoutes);
app.use('/api/contacts', socketIoMiddleware, contactRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/logs', logRoutes);

io.on('connection', (socket) => {
  console.log('🔌 A user connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('🔌 User disconnected:', socket.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  startScheduler();
});