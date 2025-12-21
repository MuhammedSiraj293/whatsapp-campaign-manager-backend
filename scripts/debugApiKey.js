const axios = require("axios");
const dotenv = require("dotenv");
dotenv.config();

async function listModels() {
  const key = process.env.GOOGLE_API_KEY;
  console.log("----------------------------------------");
  console.log(
    `🔑 Debugging Key: ${key ? key.substring(0, 8) + "..." : "MISSING"}`
  );

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;

  try {
    const response = await axios.get(url);
    console.log("✅ API Connection SUCCESS!");
    console.log("Models available:");
    response.data.models.forEach((m) => {
      if (m.name.includes("gemini")) console.log(` - ${m.name}`);
    });
  } catch (error) {
    console.log("❌ API Connection FAILED");
    if (error.response) {
      console.log(`Status: ${error.response.status}`);
      console.log(`Data:`, JSON.stringify(error.response.data, null, 2));
    } else {
      console.log(`Error: ${error.message}`);
    }
  }
  console.log("----------------------------------------");
}

listModels();
