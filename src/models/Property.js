const mongoose = require("mongoose");

const propertySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    location: { type: String, required: true },
    priceRange: { type: String }, // e.g., "Starts from AED 1.2M"
    types: { type: [String] }, // e.g., ["1BR", "2BR", "Townhouse"]
    description: { type: String },
    handoverDate: { type: String }, // e.g., "Q4 2026"
    amenities: { type: [String] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Property", propertySchema);
