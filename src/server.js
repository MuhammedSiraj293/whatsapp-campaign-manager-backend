// backend/src/server.js

const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

dotenv.config();

const connectDB = require('./config/db');
const { startScheduler } = require('./jobs/scheduler');

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

const allowedOrigins = [
  'http://localhost:3000', 
  'https://whatsapp-campaign-manager-frontend.vercel.app',
  'https://whatsapp-campaign-manager-frontend-fhmhx0aob.vercel.app'
];
const corsOptions = { origin: allowedOrigins, methods: "GET,HEAD,PUT,PATCH,POST,DELETE", credentials: true };
app.use(cors(corsOptions));

const io = new Server(httpServer, { cors: { origin: allowedOrigins, methods: ["GET", "POST"] } });

io.on('connection', (socket) => {
  console.log('🔌 A user connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('🔌 User disconnected:', socket.id);
  });
});

// --- THIS IS THE KEY CHANGE ---
// Create middleware to attach the io instance to the request object
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
app.use('/api/auth', authRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/replies', replyRoutes);
// Apply the middleware specifically to the webhook route
app.use('/api/webhook', socketIoMiddleware, webhookRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/logs', logRoutes);

httpServer.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  startScheduler();
});