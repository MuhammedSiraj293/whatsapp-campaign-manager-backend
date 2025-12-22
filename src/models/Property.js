const mongoose = require("mongoose");

const propertySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    propertyType: { type: String }, // e.g., "Apartment", "Villa"
    location: { type: String, required: true },
    developer: { type: String },
    priceRange: { type: String },
    unitSize: { type: String }, // e.g., "1,200 sqft"
    unitType: { type: String }, // e.g., "1BR, 2BR"
    handoverDate: { type: String },
    description: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Property", propertySchema);
