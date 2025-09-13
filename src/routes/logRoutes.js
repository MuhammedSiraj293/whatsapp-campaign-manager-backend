// backend/src/routes/logRoutes.js

const express = require('express');
const { getLogs } = require('../controllers/logController');
const { protect, authorize } = require('../middleware/authMiddleware');

const router = express.Router();

// This route is protected and only accessible by admins
router.get('/', protect, authorize('admin'), getLogs);

module.exports = router;