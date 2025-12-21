const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require("dotenv");
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const models = ["gemini-1.5-flash", "gemini-pro", "gemini-1.0-pro"];

async function checkModels() {
  console.log("----------------------------------------");
  console.log("🔍 Checking Models with Current Key...");

  for (const modelName of models) {
    process.stdout.write(`Testing '${modelName}'... `);
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent("Hi");
      const text = result.response.text();
      console.log(`✅ SUCCESS!`);
      console.log(`   Response: ${text}`);
      return;
    } catch (error) {
      console.log(`❌ Failed: ${error.message}`);
    }
  }
  console.log("----------------------------------------");
}

checkModels();
