// backend/src/list_all_meta_templates.js
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const path = require('path');
const axios = require('axios');

dotenv.config({ path: path.join(__dirname, '../.env') });

const connectDB = require('./config/db');
const WabaAccount = require('./models/WabaAccount');

async function run() {
  await connectDB();
  const waba = await WabaAccount.findOne({});
  if (!waba) {
    console.error("No WABA account");
    return;
  }
  
  const url = `https://graph.facebook.com/v20.0/${waba.businessAccountId}/message_templates`;
  const headers = { Authorization: `Bearer ${waba.accessToken}` };
  
  const response = await axios.get(url, { headers });
  console.log(`Total templates on Meta: ${response.data.data.length}`);
  response.data.data.forEach(t => {
    console.log(`- ${t.name} [${t.status}] (${t.language})`);
  });
  
  mongoose.connection.close();
}

run().catch(err => {
  console.error("Error:", err);
  mongoose.connection.close();
});
