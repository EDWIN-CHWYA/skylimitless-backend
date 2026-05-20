// Format phone number to international format
exports.formatPhone = (phone) => {
  if (!phone) return null;
  // Remove any non-digit characters
  const cleaned = phone.replace(/\D/g, '');
  
  // Convert 07XXXXXXXX to 254XXXXXXXX
  if (cleaned.startsWith('0')) {
    return '254' + cleaned.slice(1);
  }
  // If already 254XXXXXXXX, return as is
  if (cleaned.startsWith('254')) {
    return cleaned;
  }
  // Default: assume it's a local number without 0
  return '254' + cleaned;
};

// Generate random password
exports.generatePassword = (length = 8) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

// Format remaining time
exports.formatRemainingTime = (milliseconds) => {
  if (milliseconds <= 0) return 'Expired';
  
  const totalMinutes = Math.floor(milliseconds / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

// Generate MAC address from phone number (for testing)
exports.generateMacFromPhone = (phone) => {
  const cleaned = phone.replace(/\D/g, '');
  // Create a fake MAC: 02:00:00:XX:XX:XX
  const lastSix = cleaned.slice(-6).padStart(6, '0');
  const parts = lastSix.match(/.{2}/g);
  return `02:00:00:${parts.join(':')}`;
};

// Calculate expiry time from hours
exports.calculateExpiry = (hours) => {
  const now = new Date();
  return new Date(now.getTime() + (hours * 60 * 60 * 1000));
};

// Format currency (KES)
exports.formatCurrency = (amount) => {
  return `Ksh ${parseFloat(amount).toFixed(2)}`;
};

// Generate transaction reference
exports.generateReference = () => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `SKY${timestamp}${random}`.toUpperCase();
};

// Validate email
exports.isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Sanitize input (basic XSS prevention)
exports.sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
};

// Group transactions by date
exports.groupTransactionsByDate = (transactions) => {
  return transactions.reduce((groups, transaction) => {
    const date = transaction.created_at.toISOString().split('T')[0];
    if (!groups[date]) {
      groups[date] = {
        count: 0,
        total: 0,
        transactions: []
      };
    }
    groups[date].count++;
    groups[date].total += parseFloat(transaction.amount);
    groups[date].transactions.push(transaction);
    return groups;
  }, {});
};

// Sleep function (for delays)
exports.sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

// Retry function with exponential backoff
exports.retry = async (fn, maxRetries = 3, delay = 1000) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await exports.sleep(delay * Math.pow(2, i));
    }
  }
};