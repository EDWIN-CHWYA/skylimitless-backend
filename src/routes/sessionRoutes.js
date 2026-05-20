const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/sessionController');
const { protect, admin } = require('../middleware/auth');
const { validateSessionExtension, validateMacAddress } = require('../middleware/validation');
const rateLimit = require('express-rate-limit');

// ========== RATE LIMITING FOR PUBLIC ROUTES ==========
// Limit public session checks to prevent abuse
const publicSessionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 checks per 15 minutes
  message: {
    success: false,
    message: 'Too many session check requests. Please try again later.'
  }
});

// Stricter limit for reconnect attempts
const reconnectLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 attempts per hour
  message: {
    success: false,
    message: 'Too many reconnect attempts. Please try again later.'
  }
});

// ========== NEW: Rate limiting for data usage endpoint ==========
// Prevent spam on data usage reports
const dataUsageLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 reports per minute (reasonable for active user)
  message: {
    success: false,
    message: 'Too many data usage reports. Please slow down.'
  },
  skipSuccessfulRequests: false,
  keyGenerator: (req) => {
    // Rate limit by user ID if available, otherwise by IP
    return req.user?.id?.toString() || req.ip;
  }
});

// ========== PUBLIC ROUTES (No authentication required) ==========
// Public route - check active session (rate limited)
router.get('/active', publicSessionLimiter, sessionController.getActiveSession);

// Public route - reconnect using M-Pesa receipt (rate limited)
router.post('/reconnect', reconnectLimiter, sessionController.reconnectWithReceipt);

// ========== PROTECTED ROUTES (Require authentication) ==========

// Get all active sessions - ADMIN ONLY
router.get('/all-active', protect, admin, sessionController.getAllActiveSessions);

// Extend session (admin only)
router.post('/extend', protect, admin, validateSessionExtension, sessionController.extendSession);

// Terminate session (admin only)
router.post('/terminate', protect, admin, sessionController.terminateSession);

// ========== UPDATED: Record data usage with rate limiting ==========
// Record data usage (requires authentication + rate limiting)
router.post('/data-usage', protect, dataUsageLimiter, sessionController.recordDataUsage);

module.exports = router;