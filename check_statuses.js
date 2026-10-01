const mongoose = require('mongoose');
require('dotenv').config();
mongoose.connect(process.env.MONGO_URI).then(async () => {
  const Contact = mongoose.model('Contact', new mongoose.Schema({}, { strict: false, collection: 'contacts' }));
  const counts = await Contact.aggregate([{ $group: { _id: '$computedStatus', count: { $sum: 1 } } }]);
  console.log("Contact status breakdown:", counts);
  process.exit(0);
});
