const express = require("express");
const router = express.Router();
const {
  getProperties,
  createProperty,
  updateProperty,
  deleteProperty,
  deleteProperties,
} = require("../controllers/propertyController");
const { protect, authorize } = require("../middleware/authMiddleware");

// Base route: /api/properties
router.use(protect);
router.use(authorize("admin"));

router.get("/", getProperties);
router.post("/", createProperty);
router.put("/:id", updateProperty);
router.post("/bulk-delete", deleteProperties);
router.delete("/:id", deleteProperty);

module.exports = router;
