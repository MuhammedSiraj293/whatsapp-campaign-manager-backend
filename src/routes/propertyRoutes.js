const express = require("express");
const router = express.Router();
const {
  getProperties,
  createProperty,
  updateProperty,
  deleteProperty,
  deleteProperties,
} = require("../controllers/propertyController");

// Base route: /api/properties
router.get("/", getProperties);
router.post("/", createProperty);
router.put("/:id", updateProperty);
router.post("/bulk-delete", deleteProperties);
router.delete("/:id", deleteProperty);

module.exports = router;
