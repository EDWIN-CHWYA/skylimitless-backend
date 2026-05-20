// Validate phone number
exports.validatePhone = (req, res, next) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({
      success: false,
      message: 'Phone number is required'
    });
  }

  // Kenyan phone number validation (07XXXXXXXX or 01XXXXXXXX)
  const phoneRegex = /^(07|01)\d{8}$/;
  if (!phoneRegex.test(phone)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid Kenyan phone number. Should start with 07 or 01 and have 10 digits'
    });
  }

  next();
};

// Validate payment request
exports.validatePayment = (req, res, next) => {
  const { phone, packageName, amount } = req.body;

  const errors = [];

  if (!phone) errors.push('Phone number is required');
  if (!packageName) errors.push('Package name is required');
  if (!amount) errors.push('Amount is required');
  
  if (amount && (isNaN(amount) || amount <= 0)) {
    errors.push('Amount must be a positive number');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      errors
    });
  }

  next();
};

// Validate admin login
exports.validateAdminLogin = (req, res, next) => {
  const { username, password } = req.body;

  const errors = [];

  if (!username) errors.push('Username is required');
  if (!password) errors.push('Password is required');

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      errors
    });
  }

  next();
};

// Validate session extension
exports.validateSessionExtension = (req, res, next) => {
  const { sessionId, additionalHours } = req.body;

  const errors = [];

  if (!sessionId) errors.push('Session ID is required');
  if (!additionalHours) errors.push('Additional hours is required');
  if (additionalHours && (isNaN(additionalHours) || additionalHours <= 0)) {
    errors.push('Additional hours must be a positive number');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      errors
    });
  }

  next();
};

// Validate MAC address
exports.validateMacAddress = (req, res, next) => {
  const { mac_address } = req.body;

  if (!mac_address) {
    return next(); // MAC is optional
  }

  // MAC address format: XX:XX:XX:XX:XX:XX
  const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
  if (!macRegex.test(mac_address)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid MAC address format. Use XX:XX:XX:XX:XX:XX'
    });
  }

  next();
};

// Validate pagination
exports.validatePagination = (req, res, next) => {
  const { page, limit } = req.query;

  if (page && (isNaN(page) || page < 1)) {
    return res.status(400).json({
      success: false,
      message: 'Page must be a positive number'
    });
  }

  if (limit && (isNaN(limit) || limit < 1 || limit > 100)) {
    return res.status(400).json({
      success: false,
      message: 'Limit must be between 1 and 100'
    });
  }

  next();
};