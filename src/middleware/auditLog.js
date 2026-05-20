const SystemLog = require('../models/SystemLog');

/**
 * Create an audit log entry
 * @param {Object} params - Log parameters
 * @param {number} params.adminId - ID of admin performing action
 * @param {string} params.adminPhone - Phone number of admin
 * @param {string} params.action - Action type (LOGIN, USER_BLOCKED, etc.)
 * @param {string} params.targetType - Type of target (user, session, etc.)
 * @param {number} params.targetId - ID of target record
 * @param {Object|string} params.details - Additional details
 * @param {string} params.status - success, failed, or warning
 * @param {Object} params.req - Express request object (for IP and user agent)
 */
async function createAuditLog({ adminId, adminPhone, action, targetType, targetId, details, status, req }) {
  try {
    // Don't log if action is not provided
    if (!action) {
      console.warn('⚠️ Audit log skipped: No action provided');
      return;
    }
    
    // Sanitize details
    let sanitizedDetails = details;
    if (typeof details === 'object' && details !== null) {
      // Remove sensitive fields
      const sensitiveFields = ['password', 'token', 'secret', 'key', 'authorization'];
      const cleanDetails = { ...details };
      for (const field of sensitiveFields) {
        if (cleanDetails[field]) {
          cleanDetails[field] = '[REDACTED]';
        }
      }
      sanitizedDetails = cleanDetails;
    }
    
    // Get client IP (handle proxies)
    let clientIp = req?.ip || req?.connection?.remoteAddress || req?.socket?.remoteAddress;
    if (req?.headers?.['x-forwarded-for']) {
      clientIp = req.headers['x-forwarded-for'].split(',')[0].trim();
    }
    
    const logData = {
      admin_id: adminId || null,
      admin_phone: adminPhone || null,
      action: action,
      target_type: targetType || null,
      target_id: targetId || null,
      details: sanitizedDetails || null,
      status: status || 'success',
      ip_address: clientIp || null,
      user_agent: req?.headers?.['user-agent']?.substring(0, 500) || null
    };
    
    await SystemLog.create(logData);
    console.log(`📝 [AUDIT] ${action}${adminPhone ? ` by ${adminPhone}` : ''}`);
  } catch (error) {
    // Logging should never break the main application
    console.error('❌ Failed to create audit log:', error.message);
  }
}

/**
 * Middleware to automatically log admin actions
 * @param {string} action - Action type
 * @param {Function} getDetails - Optional function to extract details from request/response
 */
function logAdminAction(action, getDetails = null) {
  return async (req, res, next) => {
    // Store original json method
    const originalJson = res.json;
    
    // Override json method to log after response
    res.json = function(data) {
      // Only log API requests
      if (req.route || req.originalUrl?.includes('/api/')) {
        const logDetails = getDetails ? getDetails(req, data) : null;
        
        // Determine status based on response
        let logStatus = 'success';
        if (data.success === false) logStatus = 'failed';
        else if (data.success === undefined && res.statusCode >= 400) logStatus = 'failed';
        
        createAuditLog({
          adminId: req.user?.id,
          adminPhone: req.user?.phone,
          action: action,
          targetType: req.params?.userId ? 'user' : (req.params?.sessionId ? 'session' : null),
          targetId: req.params?.userId || req.params?.sessionId,
          details: logDetails,
          status: logStatus,
          req: req
        });
      }
      
      originalJson.call(this, data);
    };
    
    next();
  };
}

module.exports = { createAuditLog, logAdminAction };