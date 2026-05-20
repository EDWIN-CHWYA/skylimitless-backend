const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { protect, admin } = require('../middleware/auth');
const { validateAdminLogin, validatePagination } = require('../middleware/validation');

// Public route - admin login
router.post('/login', validateAdminLogin, adminController.login);

// Public route - get user status
router.get('/user-status', adminController.getUserStatus);

// ========== PROTECTED ROUTES ==========
router.use(protect);
router.use(admin);

// GET routes (read-only, no CSRF needed)
router.get('/dashboard/stats', adminController.getDashboardStats);
router.get('/users', validatePagination, adminController.getUsers);
router.get('/transactions', validatePagination, adminController.getTransactions);

// ========== FIXED: CSRF Protection Middleware ==========
// Enforce CSRF validation on ALL state-changing routes
router.use((req, res, next) => {
  // Skip CSRF for GET requests (they are read-only)
  if (req.method === 'GET') {
    return next();
  }
  
  // ✅ CRITICAL FIX: If CSRF middleware is not available, BLOCK the request
  if (!req.validateCsrf) {
    console.error('❌ CSRF validation middleware not available - blocking request');
    return res.status(500).json({
      success: false,
      message: 'Security configuration error. Please contact administrator.'
    });
  }
  
  // Apply CSRF validation
  req.validateCsrf(req, res, next);
});

// State-changing routes (CSRF protected)
router.put('/users/:userId', adminController.updateUser);
router.patch('/users/:userId/toggle-block', adminController.toggleUserBlock);
router.post('/logout', adminController.logout);  // ← ADDED LOGOUT ROUTE

module.exports = router;