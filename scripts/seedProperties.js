const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Property = require("../src/models/Property");

dotenv.config();

const seedProperties = async () => {
  try {
    await mongoose.connect(
      process.env.MONGO_URI ||
        "mongodb://localhost:27017/whatsapp-campaign-manager",
      {
        // useParser: true
      }
    );
    console.log("Connected to MongoDB...");

    const properties = [
      {
        name: "Sunrise Bay Residences",
        location: "Yas Island, Abu Dhabi",
        priceRange: "Starts from AED 1.5M",
        types: ["1BR", "2BR", "3BR", "Townhouses"],
        description:
          "A luxury waterfront community offering stunning views of the bay. Features infinity pools, gym, and private beach access.",
        handoverDate: "Q3 2026",
        amenities: ["Beach Access", "Pool", "Gym", "Parking", "24/7 Security"],
      },
      {
        name: "Oasis Garden Villas",
        location: "Saadiyat Island, Abu Dhabi",
        priceRange: "Starts from AED 4.2M",
        types: ["4BR Villa", "5BR Villa"],
        description:
          "Exclusive cultural district villas surrounded by museums and art galleries. Sustainable design with lush greenery.",
        handoverDate: "Q2 2025",
        amenities: ["Private Garden", "Smart Home", "Clubhouse", "Parks"],
      },
    ];

    await Property.deleteMany({}); // Clear old data
    console.log("Cleared existing properties.");

    await Property.insertMany(properties);
    console.log("✅ Seeded 2 properties successfully!");

    process.exit(0);
  } catch (error) {
    console.error("❌ Seeding Error:", error);
    process.exit(1);
  }
};

seedProperties();
