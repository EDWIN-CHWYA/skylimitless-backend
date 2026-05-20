const Session = require('../models/Session');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const routerService = require('../services/routerService');
const { Op } = require('sequelize');
const { createAuditLog } = require('../middleware/auditLog');  // ← ADDED FOR SYSTEM LOGS

// Get active session for a user
exports.getActiveSession = async (req, res) => {
  try {
    const { phone } = req.query;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    // Find user
    const user = await User.findOne({ where: { phone } });
    
    if (!user) {
      return res.json({
        success: true,
        active: false,
        message: 'No user found'
      });
    }

    // ✅ UPDATE: First mark any expired sessions as expired
    await Session.update(
      { status: 'expired' },
      {
        where: {
          user_id: user.id,
          status: 'active',
          end_time: { [Op.lt]: new Date() }
        }
      }
    );

    // Find active session
    const session = await Session.findOne({
      where: {
        user_id: user.id,
        end_time: { [Op.gt]: new Date() },
        status: 'active'
      },
      order: [['end_time', 'DESC']]
    });

    if (session) {
      const now = new Date();
      const timeRemaining = session.end_time - now;
      const totalMinutes = Math.floor(timeRemaining / (1000 * 60));
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;

      // Get router active sessions for additional info (temporarily disabled)
let routerActive = false;
// TODO: Re-enable when router API is available
/*
try {
  const activeSessions = await routerService.getActiveSessions();
  if (user.mac_address) {
    routerActive = activeSessions.some(s => 
      s.mac_address && s.mac_address.toLowerCase() === user.mac_address.toLowerCase()
    );
  }
} catch (error) {
  console.error('Error checking router session:', error);
}
*/

      return res.json({
        success: true,
        active: true,
        session: {
          id: session.id,
          startTime: session.start_time,
          endTime: session.end_time,
          remaining: `${hours}h ${minutes}m`,
          remainingMinutes: totalMinutes,
          duration: session.duration_hours,
          dataUsed: session.data_used,
          dataLimit: session.data_limit_mb,
          hotspot_username: session.hotspot_username,
          hotspot_password: session.hotspot_password,
          routerActive: routerActive
        }
      });
    } else {
      // Check for expired sessions that need cleanup (already handled by update above)
      const expiredSession = await Session.findOne({
        where: {
          user_id: user.id,
          status: 'expired',
          end_time: { [Op.lte]: new Date() }
        }
      });

      if (expiredSession) {
        // Disconnect from router if needed
        if (user.mac_address) {
          try {
            await routerService.disconnectUser(user.mac_address);
          } catch (error) {
            console.error('Error disconnecting user:', error);
          }
        }
      }

      return res.json({
        success: true,
        active: false,
        message: 'No active session found'
      });
    }
  } catch (error) {
    console.error('Get active session error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Extend session (for admin use)
exports.extendSession = async (req, res) => {
  try {
    const { sessionId, additionalHours } = req.body;

    console.log('🔍 DEBUG - Raw request:', { sessionId, additionalHours });
    
    // Input validation
    const sessionIdNum = parseInt(sessionId);
    const hoursNum = parseFloat(additionalHours);

    console.log('🔍 DEBUG - Parsed values:', { sessionIdNum, hoursNum });
    
    if (isNaN(sessionIdNum) || sessionIdNum <= 0) {
      console.log('❌ DEBUG - Invalid session ID');
      return res.status(400).json({
        success: false,
        message: 'Valid session ID is required'
      });
    }
    
    if (isNaN(hoursNum) || hoursNum < 0.5 || hoursNum > 720) {
      console.log('❌ DEBUG - Invalid hours:', { hoursNum, min: 0.5, max: 720 });
      return res.status(400).json({
        success: false,
        message: 'Valid additional hours (0.5-720) are required'
      });
    }

    const session = await Session.findByPk(sessionIdNum, {
      include: [{ model: User }]
    });
    
    if (!session) {
      console.log('❌ DEBUG - Session not found');
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }
    
    console.log('✅ DEBUG - Session found, extending...');

    // Store old end time for audit log
    const oldEndTime = session.end_time;
    
    // Extend end time
    const newEndTime = new Date(session.end_time);
const additionalMilliseconds = hoursNum * 60 * 60 * 1000;
newEndTime.setTime(newEndTime.getTime() + additionalMilliseconds);
    
    session.end_time = newEndTime;
    session.duration_hours = parseFloat(session.duration_hours) + hoursNum;
    await session.save();

    console.log('✅ DEBUG - Session extended successfully');

    // ✅ ADD AUDIT LOG FOR SESSION EXTENSION
    await createAuditLog({
      adminId: req.user.id,
      adminPhone: req.user.phone,
      action: 'SESSION_EXTENDED',
      targetType: 'session',
      targetId: session.id,
      details: {
        user_phone: session.User?.phone || 'Unknown',
        additional_hours: hoursNum,
        old_end_time: oldEndTime,
        new_end_time: newEndTime
      },
      status: 'success',
      req: req
    });

    // Update router if possible
    try {
      const user = await User.findByPk(session.user_id);
      if (user && user.mac_address) {
        // Re-add to router with new expiry
        await routerService.addHotspotUser(
          user.phone,
          user.mac_address,
          hoursNum
        );
      }
    } catch (error) {
      console.error('Error updating router:', error);
    }

    res.json({
      success: true,
      message: `Session extended by ${hoursNum} hours`,
      newEndTime: session.end_time
    });
  } catch (error) {
    console.error('Extend session error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Terminate session (admin or auto)
exports.terminateSession = async (req, res) => {
  try {
    const { sessionId, force } = req.body;
    
    // Input validation
    const sessionIdNum = parseInt(sessionId);
    if (isNaN(sessionIdNum) || sessionIdNum <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid session ID is required'
      });
    }

    const session = await Session.findByPk(sessionIdNum, {
      include: [{ model: User }]
    });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    const oldStatus = session.status;
    session.status = force ? 'disconnected' : 'expired';
    await session.save();

    // ✅ ADD AUDIT LOG FOR SESSION TERMINATION
    await createAuditLog({
      adminId: req.user.id,
      adminPhone: req.user.phone,
      action: 'SESSION_TERMINATED',
      targetType: 'session',
      targetId: session.id,
      details: {
        user_phone: session.User?.phone || 'Unknown',
        force_termination: force || false,
        previous_status: oldStatus,
        new_status: session.status
      },
      status: 'success',
      req: req
    });

    // Disconnect from router
    if (session.User && session.User.mac_address) {
      try {
        await routerService.disconnectUser(session.User.mac_address);
      } catch (error) {
        console.error('Error disconnecting from router:', error);
      }
    }

    res.json({
      success: true,
      message: 'Session terminated successfully'
    });
  } catch (error) {
    console.error('Terminate session error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// ========== UPDATED: Record data usage with SECURITY CHECKS ==========
exports.recordDataUsage = async (req, res) => {
  try {
    const { sessionId, dataUsed } = req.body;
    
    // ✅ Input validation - ensure sessionId is valid
    const sessionIdNum = parseInt(sessionId);
    const dataUsedNum = parseFloat(dataUsed);
    
    if (isNaN(sessionIdNum) || sessionIdNum <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid session ID is required'
      });
    }
    
    // ✅ STRICTER VALIDATION: Prevent unrealistic data usage
    if (isNaN(dataUsedNum) || dataUsedNum < 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid data amount is required'
      });
    }
    
    // ✅ NEW: Prevent absurd data usage reports (max 1GB per report = 1024 MB)
    // This prevents a malicious user from reporting huge amounts to trigger false limit
    const MAX_REPORTABLE_MB = 1024; // 1 GB per report
    if (dataUsedNum > MAX_REPORTABLE_MB) {
      console.warn(`⚠️ Suspicious data report: ${dataUsedNum} MB from user ${req.user?.id}`);
      return res.status(400).json({
        success: false,
        message: 'Data usage report exceeds maximum allowed per request'
      });
    }

    // ✅ NEW: Verify the session belongs to the authenticated user
    const session = await Session.findByPk(sessionIdNum);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }
    
    // ✅ CRITICAL: Ensure user can only report data for their own session
    if (session.user_id !== req.user.id && !req.user.is_admin) {
      console.warn(`⚠️ Unauthorized data report attempt: User ${req.user.id} tried to report for session ${session.id}`);
      return res.status(403).json({
        success: false,
        message: 'You can only report data usage for your own sessions'
      });
    }

    // Update data usage
    const oldDataUsed = parseFloat(session.data_used) || 0;
    session.data_used = oldDataUsed + dataUsedNum;
    await session.save();
    
    // ✅ NEW: Log suspicious activity if data usage seems manipulated
    // If the reported usage jumps too fast (more than 100MB in 1 report), log it
    if (dataUsedNum > 100) {
      console.log(`📊 Large data report: ${dataUsedNum} MB for session ${session.id} (Total: ${session.data_used} MB)`);
    }
    
    // ✅ Check if data limit has been reached
    let dataLimitReached = false;
    if (session.data_limit_mb && session.data_used >= session.data_limit_mb) {
      dataLimitReached = true;
      console.log(`⚠️ Data limit reached for session ${session.id}. User: ${session.user_id}`);
      session.status = 'data_limit_reached';
      await session.save();
      
      // Disconnect from router if MAC address exists
      const user = await User.findByPk(session.user_id);
      if (user && user.mac_address) {
        try {
          await routerService.disconnectUser(user.mac_address);
          console.log(`✅ User ${user.phone} disconnected due to data limit reached`);
        } catch (error) {
          console.error('Error disconnecting user after data limit:', error);
        }
      }
    }

    res.json({
      success: true,
      message: 'Data usage recorded',
      totalUsed: session.data_used,
      dataLimit: session.data_limit_mb,
      dataLimitReached: dataLimitReached
    });
  } catch (error) {
    console.error('Record data usage error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Check and update expired sessions (can be called by cron job)
exports.checkExpiredSessions = async () => {
  try {
    const now = new Date();
    const expiredSessions = await Session.update(
      { status: 'expired' },
      {
        where: {
          status: 'active',
          end_time: { [Op.lt]: now }
        }
      }
    );
    
    if (expiredSessions[0] > 0) {
      console.log(`✅ Updated ${expiredSessions[0]} expired sessions`);
    }
    return expiredSessions[0];
  } catch (error) {
    console.error('Error checking expired sessions:', error);
    return 0;
  }
};

// ========== UPDATED: Reconnect with data limit check ==========
exports.reconnectWithReceipt = async (req, res) => {
  try {
    const { phone, receiptCode, deviceId } = req.body;
    
    console.log(`🔄 Reconnect request - Phone: ${phone}, Receipt: ${receiptCode}, Device: ${deviceId}`);
    
    if (!phone || !receiptCode) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and receipt code are required'
      });
    }
    
    // Clean phone number
    let cleanPhone = phone.replace(/\D/g, '');
    console.log(`📞 Cleaned phone: ${cleanPhone}`);
    
    // Create both local and international formats
    let localPhone = cleanPhone;
    let internationalPhone = cleanPhone;
    
    if (cleanPhone.startsWith('0')) {
      localPhone = cleanPhone;
      internationalPhone = '254' + cleanPhone.slice(1);
    } else if (cleanPhone.startsWith('254')) {
      internationalPhone = cleanPhone;
      localPhone = '0' + cleanPhone.slice(3);
    }
    
    console.log(`📞 Searching with local: ${localPhone}, international: ${internationalPhone}`);
    
    // Find the user (try both formats)
    let user = await User.findOne({
      where: { phone: localPhone }
    });
    
    if (!user) {
      user = await User.findOne({
        where: { phone: internationalPhone }
      });
    }
    
    if (!user) {
      console.log(`❌ User not found for phone: ${localPhone} or ${internationalPhone}`);
      return res.status(404).json({
        success: false,
        message: 'No account found with this phone number'
      });
    }
    
    console.log(`✅ User found: ${user.id} - ${user.phone}`);
    
    // Find a completed transaction with this receipt code (try both phone formats)
    let transaction = await Transaction.findOne({
      where: {
        [Op.or]: [
          { phone: localPhone },
          { phone: internationalPhone }
        ],
        mpesa_receipt: receiptCode,
        status: 'completed'
      }
    });
    
    if (!transaction) {
      console.log(`❌ No transaction found for receipt: ${receiptCode}`);
      return res.status(404).json({
        success: false,
        message: 'Invalid receipt code. Please check and try again.'
      });
    }
    
    console.log(`✅ Transaction found: ${transaction.id}`);
    
    // Find active session
    let session = await Session.findOne({
      where: {
        user_id: user.id,
        status: 'active',
        end_time: { [Op.gt]: new Date() }
      }
    });
    
    if (!session) {
      // Check if there's an expired session that was active
      const expiredSession = await Session.findOne({
        where: {
          user_id: user.id,
          status: 'active',
          end_time: { [Op.lte]: new Date() }
        }
      });
      
      if (expiredSession) {
        expiredSession.status = 'expired';
        await expiredSession.save();
      }
      
      // ✅ NEW: Check for data limit reached session
      const dataLimitSession = await Session.findOne({
        where: {
          user_id: user.id,
          status: 'data_limit_reached'
        }
      });
      
      if (dataLimitSession) {
        return res.status(403).json({
          success: false,
          message: 'Your data limit has been exhausted. Please purchase a new package to continue browsing.',
          reason: 'DATA_LIMIT_EXCEEDED',
          data_used_mb: dataLimitSession.data_used,
          data_limit_mb: dataLimitSession.data_limit_mb
        });
      }
      
      return res.status(404).json({
        success: false,
        message: 'No active session found. Your package may have expired. Please purchase a new package.'
      });
    }
    
    // ✅ NEW: Check if session has data limit reached status
    if (session.status === 'data_limit_reached') {
      console.log(`⚠️ Session ${session.id} ended due to data limit reached`);
      return res.status(403).json({
        success: false,
        message: 'Your data limit has been exhausted. Please purchase a new package to continue browsing.',
        reason: 'DATA_LIMIT_EXCEEDED',
        data_used_mb: session.data_used,
        data_limit_mb: session.data_limit_mb
      });
    }
    
    // ✅ NEW: Check if data usage exceeds limit
    if (session.data_limit_mb && session.data_used >= session.data_limit_mb) {
      console.log(`⚠️ Data limit exceeded for session ${session.id}. Updating status.`);
      session.status = 'data_limit_reached';
      await session.save();
      
      // Disconnect from router
      if (user.mac_address) {
        try {
          await routerService.disconnectUser(user.mac_address);
        } catch (error) {
          console.error('Error disconnecting user:', error);
        }
      }
      
      return res.status(403).json({
        success: false,
        message: 'Your data limit has been exhausted. Please purchase a new package to continue browsing.',
        reason: 'DATA_LIMIT_EXCEEDED',
        data_used_mb: session.data_used,
        data_limit_mb: session.data_limit_mb
      });
    }
    
    console.log(`✅ Active session found: ${session.id}, ends at: ${session.end_time}`);
    
    // Check if session is already in use on another device
    if (session.device_id && session.device_id !== deviceId) {
      return res.status(403).json({
        success: false,
        message: 'This package is already being used on another device. Please purchase a new package for this device.'
      });
    }
    
    // Update session with current device ID (first time or device switch)
    if (deviceId && !session.device_id) {
      session.device_id = deviceId;
      await session.save();
      console.log(`✅ Session ${session.id} bound to device: ${deviceId}`);
    }
    
    // Calculate remaining time
    const now = new Date();
    const remainingMs = session.end_time - now;
    const remainingMinutes = Math.floor(remainingMs / (1000 * 60));
    const hours = Math.floor(remainingMinutes / 60);
    const minutes = remainingMinutes % 60;
    
    console.log(`✅ Reconnect successful - ${hours}h ${minutes}m remaining`);
    
    res.json({
      success: true,
      active: true,
      remaining: `${hours}h ${minutes}m`,
      remainingMinutes: remainingMinutes,
      endTime: session.end_time,
      message: `Reconnected successfully! You have ${hours}h ${minutes}m remaining.`
    });
    
  } catch (error) {
    console.error('❌ Reconnect error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.'
    });
  }
};

// ========== GET ALL ACTIVE SESSIONS (for admin dashboard) ==========
exports.getAllActiveSessions = async (req, res) => {
  try {
    const sessions = await Session.findAll({
      where: {
        status: 'active',
        end_time: { [Op.gt]: new Date() }
      },
      include: [{ model: User, attributes: ['id', 'phone', 'name'] }],
      order: [['end_time', 'ASC']]
    });
    
    res.json({
      success: true,
      sessions: sessions
    });
  } catch (error) {
    console.error('Get all active sessions error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};