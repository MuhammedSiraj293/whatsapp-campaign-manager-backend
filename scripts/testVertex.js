const axios = require("axios");
const dotenv = require("dotenv");
dotenv.config();

const PROJECT_ID = "whatsapp-crm-472112";
const LOCATION = "us-central1";
const MODEL_NAME = "gemini-pro";
const API_KEY = process.env.GOOGLE_API_KEY;

async function checkVertexRest() {
  console.log("----------------------------------------");
  console.log("🔍 Checking Vertex AI (REST API)...");

  const endpoint = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_NAME}:generateContent?key=${API_KEY}`;

  console.log(`   Endpoint: ${endpoint.replace(API_KEY, "API_KEY")}`); // Hide key in logs

  try {
    const response = await axios.post(endpoint, {
      contents: [
        {
          role: "user",
          parts: [{ text: "Say 'REST Ready!'" }],
        },
      ],
    });

    const text = response.data.candidates[0].content.parts[0].text;
    console.log("✅ SUCCESS!");
    console.log(`   Response: ${text}`);
  } catch (error) {
    console.log("❌ FAILURE:");
    if (error.response) {
      console.log(`   Status: ${error.response.status}`);
      console.log(`   Data:`, JSON.stringify(error.response.data, null, 2));
    } else {
      console.log(`   Error: ${error.message}`);
    }
  }
  console.log("----------------------------------------");
}

checkVertexRest();
