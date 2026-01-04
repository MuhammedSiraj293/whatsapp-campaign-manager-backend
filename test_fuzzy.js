const mongoose = require("mongoose");
const { getPropertyKnowledge } = require("./src/services/aiService");
const Property = require("./src/models/Property");
require("dotenv").config();

async function testMatcher() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to DB");

    // Create Dummy Property "Al Naseem" if not exists, matching the user's screenshot
    // Type: "Villa (4 BR + MMAID)"
    // Location: "Hudayriyat Island"
    let p = await Property.findOne({ name: "Al Naseem" });
    if (!p) {
      p = new Property({
        name: "Al Naseem",
        developer: "Modon",
        propertyType: "Villa (4 BR + MMAID)",
        location: "Hudayriyat Island",
        priceRange: "AED 8,300,000",
        isActive: true,
      });
      await p.save();
      console.log("Created Mock Property: Al Naseem");
    } else {
      console.log("Found Existing Property: Al Naseem", p.propertyType);
    }

    const inputProject = "Al Naseem Community";
    console.log(`\nTesting getPropertyKnowledge with input: "${inputProject}"`);

    const result = await getPropertyKnowledge("", inputProject);

    console.log("\n--- RESULT TEXT ---");
    console.log(result.text);
    console.log("-------------------");

    if (result.text.includes("Al Naseem") && result.text.includes("Villa")) {
      console.log("SUCCESS: Found Al Naseem in results.");
    } else {
      console.log("FAILURE: Al Naseem NOT found in results.");
    }
  } catch (error) {
    console.error(error);
  } finally {
    await mongoose.disconnect();
  }
}

testMatcher();
