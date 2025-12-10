// backend/src/server.js

const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const http = require("http");
const socketManager = require("./socketManager");
const path = require("path");

// Load environment variables first
dotenv.config();

const connectDB = require("./config/db");
const { startScheduler } = require("./jobs/scheduler");

// Route Imports
const campaignRoutes = require("./routes/campaignRoutes");
const webhookRoutes = require("./routes/webhookRoutes");
const replyRoutes = require("./routes/replyRoutes");
const authRoutes = require("./routes/authRoutes");
const contactRoutes = require("./routes/contactRoutes");
const mediaRoutes = require("./routes/mediaRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");
const logRoutes = require("./routes/logRoutes");
const userRoutes = require("./routes/userRoutes");
const wabaRoutes = require("./routes/wabaRoutes");
const enquiryRoutes = require("./routes/enquiryRoutes");
const botFlowRoutes = require("./routes/botFlowRoutes");

connectDB();

const app = express();
const httpServer = http.createServer(app);

// CORS Configuration
const allowedOrigins = [
  "http://localhost:3000",
  "https://whatsapp-campaign-manager-frontend.vercel.app",
  "https://whatsapp-campaign-manager-frontend-fhmhx0aob.vercel.app",
];
const corsOptions = {
  origin: "*", // ALLOW ALL FOR DEBUGGING
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Initialize Socket.IO using the manager
const io = socketManager.init(httpServer, { origin: allowedOrigins });

io.on("connection", (socket) => {
  console.log("🔌 A user connected:", socket.id);
  socket.on("disconnect", () => {
    console.log("🔌 User disconnected:", socket.id);
  });
});

app.use(express.json());

// --- SERVE UPLOADS FOLDER STATICALLY ---
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// --- SERVE FRONTEND STATIC FILES ---
app.use(express.static(path.join(__dirname, "../../frontend/build")));

const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.send("✅ Backend server is live and connected to MongoDB!");
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "UP", timestamp: new Date().toISOString() });
});

// Mount The Routes
app.use("/api/auth", authRoutes);
app.use("/api/campaigns", campaignRoutes);
app.use("/api/replies", replyRoutes);
app.use("/api/webhook", webhookRoutes);
app.use("/api/contacts", contactRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/logs", logRoutes);
app.use("/api/users", userRoutes);
app.use("/api/waba", wabaRoutes);
app.use("/api/enquiries", enquiryRoutes);
app.use("/api/bot-flows", botFlowRoutes);

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../../frontend/build", "index.html"));
});

httpServer.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);

  // Start all schedulers (Campaigns, Inactivity, Follow-ups)
  startScheduler();
});
