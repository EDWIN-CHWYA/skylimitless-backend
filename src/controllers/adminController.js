const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Session = require('../models/Session');
const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const routerService = require('../services/routerService');
const { trackFailedLogin, resetLoginAttempts } = require('../middleware/security');
const { createAuditLog } = require('../middleware/auditLog');  // ← ADDED FOR SYSTEM LOGS

// Admin login with progressive blocking
exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    const clientIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    
    // Check if IP is blocked due to failed attempts
    const attemptStatus = await trackFailedLogin(clientIp, username);
    
    if (attemptStatus.blocked) {
      let timeMessage = '';
      if (attemptStatus.remainingTime < 60) {
        timeMessage = `${attemptStatus.remainingTime} minutes`;
      } else if (attemptStatus.remainingTime < 1440) {
        timeMessage = `${Math.floor(attemptStatus.remainingTime / 60)} hours`;
      } else {
        timeMessage = `${Math.floor(attemptStatus.remainingTime / 1440)} days`;
      }
      
      return res.status(403).json({
        success: false,
        message: `Too many failed attempts. Please try again after ${timeMessage}.`,
        blocked: true,
        remainingTime: attemptStatus.remainingTime,
        attemptsRemaining: attemptStatus.attemptsRemaining
      });
    }

    // Find admin user
    const admin = await User.findOne({
      where: {
        phone: username,
        is_admin: true
      }
    });

    if (!admin) {
      // Track failed attempt
      await trackFailedLogin(clientIp, username);
      
      // ✅ ADD AUDIT LOG FOR FAILED LOGIN (admin not found)
      await createAuditLog({
        action: 'LOGIN_FAILED',
        targetType: 'system',
        details: { 
          username: username, 
          reason: 'Admin not found',
          ip: clientIp
        },
        status: 'failed',
        req: req
      });
      
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        attemptsRemaining: attemptStatus.attemptsRemaining
      });
    }

    // Validate password
    const isValidPassword = await admin.validatePassword(password);
    if (!isValidPassword) {
      // Track failed attempt
      await trackFailedLogin(clientIp, username);
      
      // ✅ ADD AUDIT LOG FOR FAILED LOGIN (wrong password)
      await createAuditLog({
        action: 'LOGIN_FAILED',
        targetType: 'system',
        details: { 
          username: username, 
          reason: 'Invalid password',
          ip: clientIp
        },
        status: 'failed',
        req: req
      });
      
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        attemptsRemaining: attemptStatus.attemptsRemaining
      });
    }

    // Login successful - reset attempts
    await resetLoginAttempts(clientIp);

    // Create token
    const token = jwt.sign(
      { id: admin.id, phone: admin.phone, is_admin: true },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    // ✅ ADD AUDIT LOG FOR SUCCESSFUL LOGIN
    await createAuditLog({
      adminId: admin.id,
      adminPhone: admin.phone,
      action: 'LOGIN',
      targetType: 'admin',
      targetId: admin.id,
      details: { 
        login_time: new Date().toISOString(),
        ip: clientIp
      },
      status: 'success',
      req: req
    });

    res.json({
      success: true,
      token,
      user: {
        id: admin.id,
        phone: admin.phone,
        name: admin.name,
        is_admin: true
      }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// ========== NEW: Secure Logout with Audit Log ==========
exports.logout = async (req, res) => {
  try {
    // Verify user is authenticated (req.user exists from protect middleware)
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated'
      });
    }
    
    const clientIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    
    // Record logout in audit log
    await createAuditLog({
      adminId: req.user.id,
      adminPhone: req.user.phone,
      action: 'LOGOUT',
      targetType: 'admin',
      targetId: req.user.id,
      details: { 
        logout_time: new Date().toISOString(),
        ip: clientIp
      },
      status: 'success',
      req: req
    });
    
    console.log(`📝 [AUDIT] LOGOUT by ${req.user.phone} from IP ${clientIp}`);
    
    // Note: JWT tokens are stateless, so we don't need to invalidate them
    // The client will simply remove the token from localStorage
    
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    // Still return success so user can logout even if logging fails
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  }
};

// Get dashboard stats
exports.getDashboardStats = async (req, res) => {
  try {
    // Today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // This month range
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    // Get stats
    const [
      totalUsers,
      activeSessions,
      todayTransactions,
      monthTransactions,
      totalRevenue
    ] = await Promise.all([
      // Total users
      User.count({ where: { is_admin: false } }),
      
      // Active sessions
      Session.count({
        where: {
          end_time: { [Op.gt]: new Date() },
          status: 'active'
        }
      }),
      
      // Today's transactions
      Transaction.count({
        where: {
          createdAt: { [Op.between]: [today, tomorrow] },
          status: 'completed'
        }
      }),
      
      // Month's transactions
      Transaction.sum('amount', {
        where: {
          createdAt: { [Op.between]: [monthStart, monthEnd] },
          status: 'completed'
        }
      }),
      
      // Total revenue all time
      Transaction.sum('amount', {
        where: { status: 'completed' }
      })
    ]);

    // Get recent transactions
    const recentTransactions = await Transaction.findAll({
      limit: 10,
      order: [['createdAt', 'DESC']],
      include: [{ model: User, attributes: ['phone', 'name'] }]
    });

    // Get router status (temporarily disabled - router disconnected)
let routerStatus = 'unknown';
// TODO: Re-enable when router API is available
/*
try {
  const activeRouterSessions = await routerService.getActiveSessions();
  routerStatus = 'online';
} catch (error) {
  routerStatus = 'offline';
}
*/

    res.json({
      success: true,
      stats: {
        totalUsers,
        activeSessions,
        todayTransactions,
        monthRevenue: monthTransactions || 0,
        totalRevenue: totalRevenue || 0,
        routerStatus
      },
      recentTransactions
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// ========== FIXED: Get all users sorted by most recent transaction ==========
exports.getUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, status } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = { is_admin: false };
    
    if (search) {
      whereClause[Op.or] = [
        { phone: { [Op.like]: `%${search}%` } },
        { name: { [Op.like]: `%${search}%` } },
        { mac_address: { [Op.like]: `%${search}%` } }
      ];
    }

    if (status) {
      whereClause.status = status;
    }

    // Get all users first
    const { count, rows } = await User.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']]
    });

    // For each user, get their most recent transaction date
    const usersWithRecentTransaction = await Promise.all(rows.map(async (user) => {
      const latestTransaction = await Transaction.findOne({
        where: { user_id: user.id },
        order: [['createdAt', 'DESC']],
        attributes: ['createdAt', 'amount', 'package_name']
      });
      
      return {
        ...user.toJSON(),
        lastTransactionDate: latestTransaction ? latestTransaction.createdAt : null,
        lastAmount: latestTransaction ? latestTransaction.amount : null,
        lastPackage: latestTransaction ? latestTransaction.package_name : null
      };
    }));

    // Sort by most recent transaction date (users with transactions first, then by date)
    usersWithRecentTransaction.sort((a, b) => {
      if (!a.lastTransactionDate && !b.lastTransactionDate) return 0;
      if (!a.lastTransactionDate) return 1;
      if (!b.lastTransactionDate) return -1;
      return new Date(b.lastTransactionDate) - new Date(a.lastTransactionDate);
    });

    res.json({
      success: true,
      users: usersWithRecentTransaction,
      pagination: {
        total: count,
        page: parseInt(page),
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Get all transactions
exports.getTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 20, startDate, endDate, status } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = {};
    
    if (startDate && endDate) {
      whereClause.createdAt = {
        [Op.between]: [new Date(startDate), new Date(endDate)]
      };
    }

    if (status) {
      whereClause.status = status;
    }

    const { count, rows } = await Transaction.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']],
      include: [{ model: User, attributes: ['phone', 'name'] }]
    });

    res.json({
      success: true,
      transactions: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Update user (admin only)
exports.updateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, mac_address, status } = req.body;

    const user = await User.findByPk(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const oldValues = {
      name: user.name,
      mac_address: user.mac_address,
      status: user.status
    };

    if (name) user.name = name;
    if (mac_address) user.mac_address = mac_address;
    if (status) user.status = status;

    await user.save();

    // ✅ ADD AUDIT LOG FOR USER UPDATE
    await createAuditLog({
      adminId: req.user.id,
      adminPhone: req.user.phone,
      action: 'USER_UPDATED',
      targetType: 'user',
      targetId: user.id,
      details: {
        user_phone: user.phone,
        changes: {
          name: { from: oldValues.name, to: user.name },
          mac_address: { from: oldValues.mac_address, to: user.mac_address },
          status: { from: oldValues.status, to: user.status }
        }
      },
      status: 'success',
      req: req
    });

    res.json({
      success: true,
      message: 'User updated successfully',
      user
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// ========== FIXED: Block/unblock user with security checks and audit log ==========
exports.toggleUserBlock = async (req, res) => {
  try {
    const { userId } = req.params;
    const requestingAdminId = req.user.id; // From protect middleware

    // Validate userId is a number
    const targetUserId = parseInt(userId);
    if (isNaN(targetUserId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    // ✅ CRITICAL: Prevent self-block
    if (targetUserId === requestingAdminId) {
      return res.status(403).json({
        success: false,
        message: 'You cannot block or unblock yourself'
      });
    }

    const user = await User.findByPk(targetUserId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // ✅ CRITICAL: Prevent blocking other admin users
    if (user.is_admin === true) {
      return res.status(403).json({
        success: false,
        message: 'Cannot block or unblock other admin users'
      });
    }

    // Toggle status
    const oldStatus = user.status;
    const newStatus = user.status === 'blocked' ? 'active' : 'blocked';
    user.status = newStatus;
    await user.save();

    // If blocking, disconnect from router
    if (newStatus === 'blocked' && user.mac_address) {
      try {
        await routerService.disconnectUser(user.mac_address);
        console.log(`[AUDIT] User ${user.id} (${user.mac_address}) disconnected by admin ${requestingAdminId}`);
      } catch (error) {
        console.error('Error disconnecting user:', error);
      }
    }

    // ✅ ADD AUDIT LOG FOR BLOCK/UNBLOCK
    await createAuditLog({
      adminId: requestingAdminId,
      adminPhone: req.user.phone,
      action: newStatus === 'blocked' ? 'USER_BLOCKED' : 'USER_UNBLOCKED',
      targetType: 'user',
      targetId: user.id,
      details: {
        user_phone: user.phone,
        user_name: user.name || 'N/A',
        previous_status: oldStatus,
        new_status: newStatus
      },
      status: 'success',
      req: req
    });

    // Console audit log (keep for redundancy)
    console.log(`[AUDIT] Admin ${req.user.phone} (ID: ${requestingAdminId}) ${newStatus === 'blocked' ? 'BLOCKED' : 'UNBLOCKED'} user ${user.phone} (ID: ${user.id})`);

    res.json({
      success: true,
      message: `User ${newStatus === 'blocked' ? 'blocked' : 'unblocked'} successfully`,
      status: user.status
    });
  } catch (error) {
    console.error('Toggle user block error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Get user status (for frontend to check if blocked)
exports.getUserStatus = async (req, res) => {
  try {
    const { phone } = req.query;
    
    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number required'
      });
    }
    
    // Clean phone number to local format
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('254')) {
      cleanPhone = '0' + cleanPhone.slice(3);
    }
    
    const user = await User.findOne({
      where: { phone: cleanPhone }
    });
    
    if (!user) {
      return res.json({
        success: true,
        blocked: false,
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      blocked: user.status === 'blocked',
      status: user.status
    });
  } catch (error) {
    console.error('Get user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};