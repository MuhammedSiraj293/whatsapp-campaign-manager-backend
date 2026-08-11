const mongoose = require('mongoose');
const Reply = require('./src/models/Reply');
require('dotenv').config({ path: './.env' });

async function test() {
  await mongoose.connect(process.env.MONGO_URI);
  try {
    const pipeline = [
      { $match: { recipientId: '780010391854784' } },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$from',
          lastMessage: { $first: '$body' },
          lastMessageTimestamp: { $first: '$timestamp' },
        }
      },
      {
        $lookup: {
          from: "contacts",
          localField: "_id",
          foreignField: "phoneNumber",
          as: "contactByPhone",
        },
      },
      {
        $lookup: {
          from: "contacts",
          localField: "_id",
          foreignField: "bsuid",
          as: "contactByBsuid",
        },
      },
      {
        $lookup: {
          from: "enquiries",
          localField: "_id",
          foreignField: "phoneNumber",
          as: "enquiryByPhone",
        },
      },
      {
        $lookup: {
          from: "enquiries",
          localField: "_id",
          foreignField: "bsuid",
          as: "enquiryByBsuid",
        },
      },
      {
        $project: {
          _id: 1,
          lastMessage: 1,
          lastMessageTimestamp: 1,
          name: {
            $let: {
              vars: {
                cPhone: { $arrayElemAt: ["$contactByPhone", 0] },
                cBsuid: { $arrayElemAt: ["$contactByBsuid", 0] },
                ePhone: { $arrayElemAt: ["$enquiryByPhone", 0] },
                eBsuid: { $arrayElemAt: ["$enquiryByBsuid", 0] }
              },
              in: {
                $ifNull: ["$$cPhone.name", "$$cBsuid.name", "$$ePhone.name", "$$eBsuid.name"]
              }
            }
          }
        },
      }
    ];

    const result = await Reply.aggregate(pipeline);
    
    // Find all results where name is Muhammed Siraj
    const sirajs = result.filter(r => r.name && r.name.toLowerCase().includes('siraj'));
    
    console.log('Total Sirajs:', sirajs.length);
    console.log(sirajs.map(s => ({ from: s._id, lastMessage: s.lastMessage })));
    
  } catch (err) {
    console.error('ERROR:', err);
  }
  process.exit(0);
}
test();
