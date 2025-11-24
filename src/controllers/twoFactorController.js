// backend/src/controllers/twoFactorController.js

const User = require('../models/User');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const jwt = require('jsonwebtoken');

// Reusable function to create and send a final JWT
const sendFinalTokenResponse = (user, statusCode, res) => {
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });
  res.status(statusCode).json({ 
    success: true, 
    token,
    user: { name: user.name, role: user.role }
  });
};

// @desc    Generate a 2FA secret and QR code for the logged-in user
// @route   POST /api/auth/2fa/setup
const setupTwoFactorAuth = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    const secret = speakeasy.generateSecret({
      name: `WhatsApp CRM (${user.email})`,
    });
    user.twoFactorSecret = secret;
    user.isTwoFactorEnabled = true; 
    await user.save();
    qrcode.toDataURL(secret.otpauth_url, (err, data_url) => {
      if (err) throw new Error('Could not generate QR code.');
      res.status(200).json({
        success: true,
        qrCodeUrl: data_url,
        secret: secret.base32,
      });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Server Error' });
  }
};

// @desc    Verify a 2FA token and complete the login
// @route   POST /api/auth/2fa/verify
const verifyTwoFactorAuth = async (req, res) => {
    const { email, password, token } = req.body;

    if (!email || !password || !token) {
        return res.status(400).json({ success: false, error: 'Please provide email, password, and 2FA token.' });
    }

    try {
        const user = await User.findOne({ email }).select('+password +twoFactorSecret');
        if (!user) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        const isMatch = await user.matchPassword(password);
        if (!isMatch) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        // Verify the 2FA token
        const verified = speakeasy.totp.verify({
            secret: user.twoFactorSecret.base32,
            encoding: 'base32',
            token: token,
            window: 1,
        });

        if (verified) {
            // If the code is correct, send the final login token
            sendFinalTokenResponse(user, 200, res);
        } else {
            res.status(401).json({ success: false, error: 'Invalid 2FA token.' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: 'Server Error' });
    }
};

module.exports = {
  setupTwoFactorAuth,
  verifyTwoFactorAuth,
};