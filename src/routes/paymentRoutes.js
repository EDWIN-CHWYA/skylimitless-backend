const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const paymentController = require('../controllers/paymentController');
const { protect } = require('../middleware/auth');

// ========== RATE LIMITING FOR PAYMENT INITIATION ==========
// Limit to 3 payment attempts per 15 minutes per IP
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // 3 attempts per window
  message: {
    success: false,
    message: 'Too many payment attempts. Please wait 15 minutes before trying again.'
  },
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false,
  skipSuccessfulRequests: true // Don't count successful payments toward limit
});

// ========== STRICTER LIMIT FOR CHECKING STATUS ==========
// Limit to 60 status checks per minute per IP (1 per second)
const statusLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute (1 per second)
  message: {
    success: false,
    message: 'Too many status check requests. Please wait a moment.'
  }
});

// ========== RATE LIMITING FOR MANUAL QUERY ==========
// Limit to 5 manual queries per minute per IP (fallback only)
const queryLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per minute
  message: {
    success: false,
    message: 'Too many query requests. Please wait a moment.'
  }
});

// Initiate M-Pesa payment (with rate limiting)
router.post('/initiate', paymentLimiter, paymentController.initiatePayment);

// M-Pesa callback (no auth, public - no rate limit needed, Safaricom controls this)
router.post('/callback', paymentController.mpesaCallback);

// Check transaction status (with rate limiting, no authentication needed)
router.get('/status/:checkoutRequestId', statusLimiter, paymentController.checkStatus);

// ========== NEW: Manual query transaction status (fallback when callback fails) ==========
// This queries M-Pesa directly to check if payment was completed
router.get('/query/:checkoutRequestId', queryLimiter, paymentController.queryTransactionStatus);

// Check active session (no rate limit needed)
router.get('/session', paymentController.checkSession);

module.exports = router;