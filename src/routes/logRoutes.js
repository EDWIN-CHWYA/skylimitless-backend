const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const logController = require('../controllers/logController');
const { protect, admin } = require('../middleware/auth');
const { validatePagination } = require('../middleware/validation');

// Rate limiter for log endpoints (prevent abuse)
const logLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: { 
    success: false, 
    message: 'Too many log requests. Please wait a moment.' 
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

// All log routes require admin authentication
router.use(protect);
router.use(admin);
router.use(logLimiter);

// GET /api/admin/logs - Get system logs with filters
router.get('/', validatePagination, logController.getSystemLogs);

// GET /api/admin/logs/summary - Get log summary for dashboard
router.get('/summary', logController.getLogSummary);

// GET /api/admin/logs/actions - Get list of available actions
router.get('/actions', logController.getActionsList);

// GET /api/admin/logs/admins - Get list of admins who have logs
router.get('/admins', logController.getAdminsList);

module.exports = router;