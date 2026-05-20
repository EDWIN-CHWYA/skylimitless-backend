const SystemLog = require('../models/SystemLog');
const { Op } = require('sequelize');

/**
 * Get system logs with pagination and filters
 * Access: Admin only
 */
exports.getSystemLogs = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      action, 
      admin_id, 
      startDate, 
      endDate,
      status 
    } = req.query;
    
    // Validate and sanitize inputs
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;
    
    const whereClause = {};
    
    // Apply filters (only if valid)
    if (action && typeof action === 'string') {
      whereClause.action = action;
    }
    
    if (admin_id && !isNaN(parseInt(admin_id))) {
      whereClause.admin_id = parseInt(admin_id);
    }
    
    if (status && ['success', 'failed', 'warning'].includes(status)) {
      whereClause.status = status;
    }
    
    // Date range filter
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        whereClause.createdAt = { [Op.between]: [start, end] };
      }
    }
    
    const { count, rows } = await SystemLog.findAndCountAll({
      where: whereClause,
      limit: limitNum,
      offset: offset,
      order: [['createdAt', 'DESC']],
      attributes: { exclude: [] } // Include all fields
    });
    
    res.json({
      success: true,
      logs: rows,
      pagination: {
        total: count,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(count / limitNum)
      }
    });
  } catch (error) {
    console.error('Get system logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/**
 * Get log summary for dashboard
 * Access: Admin only
 */
exports.getLogSummary = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    lastWeek.setHours(0, 0, 0, 0);
    
    const [recentLogs, todayLogins, todayFailedLogins, weeklyActions, totalLogs] = await Promise.all([
      SystemLog.findAll({
        limit: 10,
        order: [['createdAt', 'DESC']],
        attributes: ['id', 'action', 'admin_phone', 'target_type', 'target_id', 'status', 'createdAt']
      }),
      SystemLog.count({
        where: {
          action: 'LOGIN',
          createdAt: { [Op.gte]: today },
          status: 'success'
        }
      }),
      SystemLog.count({
        where: {
          action: 'LOGIN_FAILED',
          createdAt: { [Op.gte]: today }
        }
      }),
      SystemLog.count({
        where: {
          createdAt: { [Op.gte]: lastWeek },
          action: {
            [Op.in]: ['USER_BLOCKED', 'USER_UNBLOCKED', 'SESSION_EXTENDED']
          }
        }
      }),
      SystemLog.count()
    ]);
    
    res.json({
      success: true,
      recentLogs,
      summary: {
        todayLogins,
        todayFailedAttempts: todayFailedLogins,
        weeklyModerations: weeklyActions,
        totalLogsStored: totalLogs
      }
    });
  } catch (error) {
    console.error('Get log summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/**
 * Get list of available actions for filter dropdown
 * Access: Admin only
 */
exports.getActionsList = async (req, res) => {
  try {
    const actions = await SystemLog.findAll({
      attributes: [[SystemLog.sequelize.fn('DISTINCT', SystemLog.sequelize.col('action')), 'action']],
      order: [[SystemLog.sequelize.col('action'), 'ASC']],
      raw: true
    });
    
    res.json({
      success: true,
      actions: actions.map(a => a.action).filter(a => a)
    });
  } catch (error) {
    console.error('Get actions list error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/**
 * Get unique admin list for filter
 * Access: Admin only
 */
exports.getAdminsList = async (req, res) => {
  try {
    const admins = await SystemLog.findAll({
      attributes: ['admin_id', 'admin_phone'],
      where: {
        admin_id: { [Op.ne]: null }
      },
      group: ['admin_id', 'admin_phone'],
      order: [['admin_phone', 'ASC']],
      raw: true
    });
    
    res.json({
      success: true,
      admins: admins.map(a => ({ id: a.admin_id, phone: a.admin_phone }))
    });
  } catch (error) {
    console.error('Get admins list error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};