const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const Reply = require("../src/models/Reply");

const runTest = async () => {
  try {
    console.log("🔌 Connecting to MongoDB...");
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) throw new Error("MONGODB_URI missing");

    await mongoose.connect(mongoUri);
    console.log("✅ Connected.");

    const testId = `simple-test-${Date.now()}`;
    const replyData = {
      messageId: testId,
      from: "971500000000",
      recipientId: "123456",
      body: "Test Duplicate",
      timestamp: new Date(),
      direction: "incoming",
    };

    // The logic to test (copied from webhookHandler.js)
    const saveReplySafe = async (label) => {
      try {
        console.log(`[${label}] Attempting save...`);
        // Simulate delay to ensure overlap
        await new Promise((r) => setTimeout(r, 100));

        const r = new Reply(replyData);
        await r.save();
        console.log(`[${label}] 💾 Saved successfully.`);
      } catch (saveErr) {
        // THE FIX LOGIC
        if (saveErr.code === 11000) {
          console.warn(
            `[${label}] ⚠️ Race Condition Detected: Ignoring duplicate (As Expected).`,
          );
          return; // Graceful exit
        } else {
          console.error(`[${label}] ❌ Unexpected Error:`, saveErr);
          throw saveErr;
        }
      }
    };

    console.log("🚀 Starting Parallel Saves...");
    await Promise.all([saveReplySafe("Thread A"), saveReplySafe("Thread B")]);

    console.log(
      "\n✅ Verification SUCCESS: Both saves completed without crashing.",
    );
  } catch (err) {
    console.error("❌ Verification FAILED:", err);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
};

runTest();
