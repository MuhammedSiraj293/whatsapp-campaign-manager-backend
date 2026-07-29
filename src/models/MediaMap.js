// backend/src/models/MediaMap.js
const mongoose = require("mongoose");

const MediaMapSchema = new mongoose.Schema(
  {
    templateName: { type: String, required: true },
    cardIndex: { type: Number, required: true },
    url: { type: String, required: true },
    handle: { type: String },
  },
  { timestamps: true }
);

// Create compound unique index for templateName + cardIndex
MediaMapSchema.index({ templateName: 1, cardIndex: 1 }, { unique: true });

module.exports = mongoose.model("MediaMap", MediaMapSchema);
