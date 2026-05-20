const LoginAttempt = require('../models/LoginAttempt');
const { Op } = require('sequelize');
const rateLimit = require('express-rate-limit');

// Progressive delay calculation based on attempt stage
function calculateBlockDuration(stage) {
  const durations = {
    1: { value: 15, unit: 'minutes' },   // After 3-5 attempts: 15 minutes
    2: { value: 1, unit: 'hours' },       // After 6-8 attempts: 1 hour
    3: { value: 3, unit: 'days' },        // After 9-11 attempts: 3 days
    4: { value: 2, unit: 'months' }       // After 12+ attempts: 2 months
  };
  
  return durations[stage] || durations[4];
}

// Track failed login attempts with progressive blocking
async function trackFailedLogin(ip, phone = null) {
  try {
    // Clean old expired records first
    await LoginAttempt.destroy({
      where: {
        blocked_until: { [Op.lt]: new Date() },
        [Op.or]: [
          { blocked_until: { [Op.ne]: null } }
        ]
      }
    });
    
    let attempt = await LoginAttempt.findOne({
      where: {
        ip_address: ip
      }
    });
    
    if (!attempt) {
      attempt = await LoginAttempt.create({
        ip_address: ip,
        phone: phone,
        attempt_count: 1,
        first_attempt_at: new Date(),
        last_attempt_at: new Date(),
        block_stage: 0
      });
      return { 
        blocked: false, 
        remainingTime: 0, 
        attemptsRemaining: 2,
        blockStage: 0 
      };
    }
    
    // Update attempt count
    attempt.attempt_count += 1;
    attempt.last_attempt_at = new Date();
    if (phone) attempt.phone = phone;
    
    // Calculate current block stage (every 3 attempts advances stage)
    const newStage = Math.floor((attempt.attempt_count - 1) / 3);
    
    if (newStage > attempt.block_stage && newStage > 0) {
      attempt.block_stage = newStage;
      const blockInfo = calculateBlockDuration(newStage);
      
      const blockedUntil = new Date();
      if (blockInfo.unit === 'minutes') {
        blockedUntil.setMinutes(blockedUntil.getMinutes() + blockInfo.value);
      } else if (blockInfo.unit === 'hours') {
        blockedUntil.setHours(blockedUntil.getHours() + blockInfo.value);
      } else if (blockInfo.unit === 'days') {
        blockedUntil.setDate(blockedUntil.getDate() + blockInfo.value);
      } else if (blockInfo.unit === 'months') {
        blockedUntil.setMonth(blockedUntil.getMonth() + blockInfo.value);
      }
      
      attempt.blocked_until = blockedUntil;
    }
    
    await attempt.save();
    
    const isBlocked = attempt.blocked_until && attempt.blocked_until > new Date();
    const remainingTime = isBlocked ? Math.ceil((attempt.blocked_until - new Date()) / 1000 / 60) : 0;
    const attemptsUsed = attempt.attempt_count % 3;
    const attemptsRemaining = attemptsUsed === 0 ? 3 : 3 - attemptsUsed;
    
    return {
      blocked: isBlocked,
      remainingTime: remainingTime,
      attemptsRemaining: attemptsRemaining,
      blockStage: attempt.block_stage
    };
  } catch (error) {
    console.error('Error tracking failed login:', error);
    return { blocked: false, remainingTime: 0, attemptsRemaining: 3 };
  }
}

// Reset login attempts on successful login
async function resetLoginAttempts(ip) {
  try {
    await LoginAttempt.destroy({
      where: { ip_address: ip }
    });
  } catch (error) {
    console.error('Error resetting login attempts:', error);
  }
}

// General rate limiter for all requests
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100,
  message: { success: false, message: 'Too many requests from this IP, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiter for authentication
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5,
  skipSuccessfulRequests: true,
  message: { success: false, message: 'Too many login attempts, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  trackFailedLogin,
  resetLoginAttempts,
  generalLimiter,
  authLimiter
};