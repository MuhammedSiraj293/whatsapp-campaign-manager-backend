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
const templateRoutes = require("./routes/templateRoutes");

connectDB();

const app = express();
const httpServer = http.createServer(app);

// CORS Configuration
// CORS Configuration
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173", // Vite default
  "https://whatsapp-campaign-manager-frontend.vercel.app",
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    // Check if origin is in the allowed list OR if it is a vercel preview deployment
    if (
      allowedOrigins.indexOf(origin) !== -1 ||
      origin.endsWith(".vercel.app") ||
      origin.endsWith(".onrender.com") // Include Render domains just in case
    ) {
      callback(null, true);
    } else {
      console.log("🚫 CORS Blocked Origin:", origin); // Log the blocked origin
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Initialize Socket.IO using the manager
// Note: We need to pass a function or array for origin. Socket.io accepts regex or standard array.
// For simplicity in socket.io, we will allow all or complex logic.
// Socket.io 'origin' option can be a function in newer versions or we can just pass specific domains.
// To keep it simple and consistent with Express CORS:
const io = socketManager.init(httpServer, {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (
      allowedOrigins.indexOf(origin) !== -1 ||
      origin.endsWith(".vercel.app") ||
      origin.endsWith(".onrender.com")
    ) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"), false);
    }
  },
  credentials: true,
});

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
app.use("/api/auto-reply", require("./routes/autoReplyRoutes"));
app.use("/api/properties", require("./routes/propertyRoutes")); // <-- NEW ROUTE
app.use("/api/templates", templateRoutes);

app.get("*splat", (req, res) => {
  res.sendFile(path.join(__dirname, "../../frontend/build", "index.html"));
});

httpServer.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);

  // Start all schedulers (Campaigns, Inactivity, Follow-ups)
  startScheduler();
});
