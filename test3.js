const mongoose = require('mongoose');
const Reply = require('./src/models/Reply');
require('dotenv').config({ path: './.env' });

async function test() {
  await mongoose.connect(process.env.MONGO_URI);
  try {
    const distinctFroms = await Reply.distinct('from', { recipientId: '780010391854784' });
    console.log('Distinct froms length:', distinctFroms.length);
    console.log('Distinct froms:', distinctFroms);
  } catch (err) {
    console.error('ERROR:', err);
  }
  process.exit(0);
}
test();
