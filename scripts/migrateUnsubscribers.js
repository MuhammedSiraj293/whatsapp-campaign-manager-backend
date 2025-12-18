const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

// Load Environment Variables
dotenv.config({ path: path.join(__dirname, "../.env") });

const Contact = require("../src/models/Contact");
const ContactList = require("../src/models/ContactList");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ MongoDB Connected for Migration");
  } catch (err) {
    console.error("❌ DB Connection Error:", err.message);
    process.exit(1);
  }
};

const runMigration = async () => {
  await connectDB();

  try {
    console.log("🔍 Starting migration...");

    // 1. Find or create "Unsubscriber List"
    let unsubList = await ContactList.findOne({ name: "Unsubscriber List" });
    if (!unsubList) {
      unsubList = await ContactList.create({ name: "Unsubscriber List" });
      console.log(
        "📝 Created new 'Unsubscriber List' (ID: " + unsubList._id + ")"
      );
    } else {
      console.log(
        "👉 Found existing 'Unsubscriber List' (ID: " + unsubList._id + ")"
      );
    }

    // 2. Find ALL contacts who are unsubscribed (and not already in the unsubscribe list)
    const unsubscribedContacts = await Contact.find({ isSubscribed: false });
    console.log(
      `📊 Found ${unsubscribedContacts.length} totally unsubscribed contacts in the database.`
    );

    let addedCount = 0;
    let skippedCount = 0;

    for (const contact of unsubscribedContacts) {
      // Check if this contact (phone number) is ALREADY in the Unsubscriber List
      const existingInUnsub = await Contact.findOne({
        phoneNumber: contact.phoneNumber,
        contactList: unsubList._id,
      });

      if (existingInUnsub) {
        skippedCount++;
        continue;
      }

      // Create a copy in the Unsubscriber List
      await Contact.create({
        phoneNumber: contact.phoneNumber,
        name: contact.name,
        contactList: unsubList._id,
        isSubscribed: false, // Ensure it's marked as unsubscribed
        variables: contact.variables,
      });

      // Console log occasionally
      process.stdout.write(".");
      addedCount++;
    }

    console.log("\n");
    console.log("✅ Migration Complete!");
    console.log(`➕ Added: ${addedCount}`);
    console.log(`⏩ Skipped (Already in list): ${skippedCount}`);
  } catch (err) {
    console.error("❌ Migration Error:", err);
  } finally {
    await mongoose.connection.close();
    console.log("👋 Database connection closed.");
    process.exit(0);
  }
};

runMigration();
