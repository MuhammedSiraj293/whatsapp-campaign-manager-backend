// backend/src/models/MediaMap.js
const mongoose = require("mongoose");

const MediaMapSchema = new mongoose.Schema(
  {
    handle: { type: String, required: true, unique: true },
    url: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MediaMap", MediaMapSchema);
