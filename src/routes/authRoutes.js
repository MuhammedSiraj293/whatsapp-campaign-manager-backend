// backend/src/routes/authRoutes.js
    
const express = require('express');
const { register, login } = require('../controllers/authController');
const { setupTwoFactorAuth, verifyTwoFactorAuth } = require('../controllers/twoFactorController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();
    
// Public routes
router.post('/register', register);
router.post('/login', login);
router.post('/2fa/verify', verifyTwoFactorAuth);

// Protected route - only a logged-in user can set up 2FA
router.post('/2fa/setup', protect, setupTwoFactorAuth);
    
module.exports = router;