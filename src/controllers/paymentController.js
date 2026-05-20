const mpesaService = require('../services/mpesaService');
const routerService = require('../services/routerService');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Session = require('../models/Session');
const { Op } = require('sequelize');

// ========== UPDATED: Package definitions with data limits ==========
const PACKAGES = {
  // Time-only packages (no data limit)
  '40 Mins': { hours: 0.67, price: 5, data_limit_mb: null },
  '2 Hours': { hours: 2, price: 10, data_limit_mb: null },
  '6 Hours': { hours: 6, price: 20, data_limit_mb: null },
  '12 Hours': { hours: 12, price: 30, data_limit_mb: null },
  '24 Hours': { hours: 24, price: 40, data_limit_mb: null },
  '3 Days': { hours: 72, price: 100, data_limit_mb: null },
  
  // Packages with data limits (GB to MB conversion)
  '2GB - 3 Hours': { hours: 3, price: 10, data_limit_mb: 2048 },    // 2GB = 2048 MB
  '3GB - 4 Hours': { hours: 4, price: 15, data_limit_mb: 3072 },    // 3GB = 3072 MB
  
  // Unlimited data packages (no data limit)
  '7 Days Unlimited': { hours: 168, price: 160, data_limit_mb: null },
  '2GB - 7 Days': { hours: 168, price: 30, data_limit_mb: 2048 },    // 2GB = 2048 MB
  
  // Monthly packages
  '30GB - 30 Days': { hours: 720, price: 400, data_limit_mb: 30720 }, // 30GB = 30720 MB
  '1 Month Unlimited': { hours: 720, price: 499, data_limit_mb: null }
};

// Helper function to format phone number
function formatPhoneNumber(phone) {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('254')) {
    cleaned = '0' + cleaned.slice(3);
  }
  return cleaned;
}

// Helper function to convert local phone to international format
function toInternationalFormat(phone) {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '254' + cleaned.slice(1);
  }
  return cleaned;
}

// ✅ NEW: Verify callback is from Safaricom
function isSafaricomCallback(ip) {
  if (process.env.NODE_ENV === 'development') {
    console.log(`⚠️ Development mode: Allowing callback from ${ip}`);
    return true;
  }
  
  const isSafaricom = ip.startsWith('197.248.') || 
                      ip.startsWith('196.201.') ||
                      ip.startsWith('52.');
  
  if (!isSafaricom) {
    console.error(`❌ Rejected callback from unauthorized IP: ${ip}`);
  }
  
  return isSafaricom;
}

// Initiate payment
exports.initiatePayment = async (req, res) => {
  try {
    let { phone, packageName, amount } = req.body;

    const formattedPhone = formatPhoneNumber(phone);

    if (!formattedPhone.match(/^(07|01)\d{8}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Kenyan phone number. Use format: 07XXXXXXXX or 2547XXXXXXXX'
      });
    }

    const selectedPackage = PACKAGES[packageName];
    if (!selectedPackage) {
      return res.status(400).json({
        success: false,
        message: 'Invalid package selected'
      });
    }

    if (selectedPackage.price !== amount) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount for selected package'
      });
    }

    let [user, created] = await User.findOrCreate({
      where: { phone: formattedPhone },
      defaults: { phone: formattedPhone }
    });

    const mpesaPhone = toInternationalFormat(formattedPhone);

    const result = await mpesaService.stkPush(
      mpesaPhone,
      amount,
      'SKYLIMITLESS',
      `WiFi ${packageName}`,
      packageName,
      selectedPackage.hours
    );

    if (result.success) {
      return res.json({
        success: true,
        message: 'STK Push sent to your phone. Please enter PIN.',
        transactionId: result.transactionId,
        checkoutRequestId: result.data.CheckoutRequestID
      });
    } else {
      return res.status(500).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    console.error('Payment initiation error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during payment initiation'
    });
  }
};

// ========== REFACTORED: M-Pesa callback using service ==========
exports.mpesaCallback = async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
  console.log(`🔥 M-Pesa Callback from IP: ${clientIp}`);
  
  // ✅ Step 1: Verify callback source
  if (!isSafaricomCallback(clientIp)) {
    return res.status(403).json({ 
      ResultCode: 1, 
      ResultDesc: 'Unauthorized source' 
    });
  }
  
  console.log('✅ Callback source verified');
  
  try {
    // ✅ Step 2: Process callback using service (passes IP for verification)
    const result = await mpesaService.handleCallback(req.body, clientIp);
    
    // ✅ Step 3: If payment was successful, create/extend session
    if (result.success && result.transaction.status === 'completed') {
      const transaction = result.transaction;
      
      // Convert phone number to local format
      let userPhone = transaction.phone;
      if (userPhone.startsWith('254')) {
        userPhone = '0' + userPhone.slice(3);
      }
      
      // Find or create user
      const [user] = await User.findOrCreate({
        where: { phone: userPhone },
        defaults: { phone: userPhone }
      });
      
      // Check if user is blocked
      if (user.status === 'blocked') {
        console.log(`⚠️ User ${user.id} is blocked. Not creating session.`);
        return res.json({ ResultCode: 1, ResultDesc: 'User is blocked' });
      }
      
      // Get package details to check data limit
      const packageName = transaction.package_name;
      const packageDetails = PACKAGES[packageName];
      const dataLimitMB = packageDetails ? packageDetails.data_limit_mb : null;
      
      // Calculate end time
      const durationHours = parseFloat(transaction.duration_hours);
      const durationMs = durationHours * 60 * 60 * 1000;
      const startTime = new Date();
      const endTime = new Date(startTime.getTime() + durationMs);
      
      // Check for existing active session
      const existingSession = await Session.findOne({
        where: {
          user_id: user.id,
          status: 'active',
          end_time: { [Op.gt]: new Date() }
        }
      });
      
      if (existingSession) {
        // Extend existing session
        console.log(`⚠️ User already has active session ${existingSession.id}. Extending instead.`);
        const newEndTime = new Date(existingSession.end_time.getTime() + durationMs);
        existingSession.end_time = newEndTime;
        existingSession.duration_hours = parseFloat(existingSession.duration_hours) + durationHours;
        
        // ✅ NEW: Update data limit if this package has a limit
        if (dataLimitMB) {
          existingSession.data_limit_mb = dataLimitMB;
          console.log(`📊 Data limit set to ${dataLimitMB} MB for session ${existingSession.id}`);
        }
        
        await existingSession.save();
        console.log(`✅ Session ${existingSession.id} extended by ${durationHours} hours`);
      } else {
        // Create new session with data limit
        const sessionData = {
          user_id: user.id,
          transaction_id: transaction.id,
          start_time: startTime,
          end_time: endTime,
          duration_hours: durationHours,
          status: 'active',
          data_used: 0
        };
        
        // ✅ NEW: Add data limit to session if package has one
        if (dataLimitMB) {
          sessionData.data_limit_mb = dataLimitMB;
          console.log(`📊 New session will have data limit: ${dataLimitMB} MB`);
        }
        
        const session = await Session.create(sessionData);
        console.log(`✅ Session created: ${session.id}`);
      }
      
      // Update transaction with user_id
      transaction.user_id = user.id;
      await transaction.save();
      
      // Try to add to MikroTik with data limit
      try {
        const routerResult = await routerService.addHotspotUser(
          userPhone,
          user.mac_address || '00:00:00:00:00:00',
          durationHours,
          dataLimitMB  // ✅ NEW: Pass data limit to router service
        );
        if (routerResult.success) {
          console.log(`✅ MikroTik user created: ${routerResult.username}`);
          if (dataLimitMB) {
            console.log(`📊 Data limit set in MikroTik: ${dataLimitMB} MB`);
          }
        }
      } catch (routerError) {
        console.log(`⚠️ Router error (non-critical): ${routerError.message}`);
      }
    }
    
    console.log('🔥🔥🔥 CALLBACK PROCESSED SUCCESSFULLY 🔥🔥🔥');
    res.json({ ResultCode: 0, ResultDesc: 'Success' });
    
  } catch (error) {
    console.error('❌ Callback error:', error);
    res.json({ ResultCode: 1, ResultDesc: 'Error processing callback' });
  }
};

// Check transaction status
exports.checkStatus = async (req, res) => {
  try {
    const { checkoutRequestId } = req.params;
    
    const transaction = await Transaction.findOne({
      where: { checkout_request_id: checkoutRequestId }
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    res.json({
      success: true,
      status: transaction.status,
      mpesa_receipt: transaction.mpesa_receipt
    });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// ========== NEW: Manual query transaction status (fallback when callback fails) ==========
exports.queryTransactionStatus = async (req, res) => {
  try {
    const { checkoutRequestId } = req.params;
    
    // Find transaction in database
    const transaction = await Transaction.findOne({
      where: { checkout_request_id: checkoutRequestId }
    });
    
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    // ✅ PREVENT WASTED API CALLS: If already completed, return immediately
    if (transaction.status === 'completed') {
      console.log(`✅ Transaction ${transaction.id} already completed, skipping M-Pesa query`);
      return res.json({
        success: true,
        status: 'completed',
        message: 'Transaction already completed',
        fromCache: true
      });
    }
    
    // ✅ PREVENT DUPLICATE SESSION: Check if session already exists
    const existingSession = await Session.findOne({
      where: {
        user_id: transaction.user_id,
        status: 'active'
      }
    });
    
    if (existingSession) {
      console.log(`✅ Session already exists for user ${transaction.user_id}, skipping creation`);
      return res.json({
        success: true,
        status: 'completed',
        message: 'Session already active',
        sessionExists: true
      });
    }
    
    // Only query M-Pesa if needed
    console.log(`⏳ Querying M-Pesa for transaction ${transaction.id}...`);
    const result = await mpesaService.queryStatus(checkoutRequestId);
    
    if (result.ResultCode === 0) {
      // ✅ PREVENT RACE CONDITION: Use transaction lock
      const mpesaReceipt = result.CallbackMetadata?.Item?.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
      
      const [updated] = await Transaction.update(
        { 
          status: 'completed',
          mpesa_receipt: mpesaReceipt
        },
        { 
          where: { 
            id: transaction.id, 
            status: 'pending' // Only update if still pending
          }
        }
      );
      
      if (updated > 0) {
        console.log(`✅ Transaction ${transaction.id} updated to completed`);
        
        // ✅ PREVENT DUPLICATE SESSION: Check again before creating
        const sessionExists = await Session.findOne({
          where: { user_id: transaction.user_id, status: 'active' }
        });
        
        if (!sessionExists) {
          // Get user and package details
          const user = await User.findByPk(transaction.user_id);
          const durationHours = parseFloat(transaction.duration_hours);
          const endTime = new Date(Date.now() + durationHours * 60 * 60 * 1000);
          
          await Session.create({
            user_id: transaction.user_id,
            transaction_id: transaction.id,
            start_time: new Date(),
            end_time: endTime,
            duration_hours: durationHours,
            status: 'active',
            data_used: 0
          });
          console.log(`✅ Session created for user ${transaction.user_id}`);
        }
      }
      
      return res.json({
        success: true,
        status: 'completed',
        message: 'Payment confirmed',
        receipt: mpesaReceipt
      });
    } else {
      return res.json({
        success: false,
        status: 'pending',
        message: result.ResultDesc || 'Payment not completed yet'
      });
    }
  } catch (error) {
    console.error('Manual query error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// Check active session (updated to show data limit info)
exports.checkSession = async (req, res) => {
  try {
    const { phone } = req.query;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    console.log('🔍 Checking session for phone:', phone);

    const user = await User.findOne({
      where: { phone: phone }
    });

    if (!user) {
      return res.json({
        success: true,
        active: false,
        message: 'No user found'
      });
    }

    if (user.status === 'blocked') {
      return res.json({
        success: true,
        active: false,
        blocked: true,
        message: 'Your account has been blocked'
      });
    }

    const session = await Session.findOne({
      where: {
        user_id: user.id,
        status: 'active',
        end_time: { [Op.gt]: new Date() }
      },
      order: [['end_time', 'DESC']]
    });

    if (session) {
      const now = new Date();
      const timeRemaining = session.end_time - now;
      const totalMinutes = Math.floor(timeRemaining / (1000 * 60));
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      
      // ✅ NEW: Calculate data usage percentage if data limit exists
      let dataUsagePercent = null;
      let dataRemainingMB = null;
      if (session.data_limit_mb && session.data_limit_mb > 0) {
        const dataUsedMB = session.data_used || 0;
        dataRemainingMB = Math.max(0, session.data_limit_mb - dataUsedMB);
        dataUsagePercent = (dataUsedMB / session.data_limit_mb) * 100;
      }

      res.json({
        success: true,
        active: true,
        remaining: `${hours}h ${minutes}m`,
        endTime: session.end_time,
        hotspot_username: session.hotspot_username,
        hotspot_password: session.hotspot_password,
        data_used_mb: session.data_used || 0,
        data_limit_mb: session.data_limit_mb || null,
        data_remaining_mb: dataRemainingMB,
        data_usage_percent: dataUsagePercent
      });
    } else {
      res.json({
        success: true,
        active: false
      });
    }
  } catch (error) {
    console.error('Session check error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};