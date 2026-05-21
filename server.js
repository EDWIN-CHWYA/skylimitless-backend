const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const sequelize = require('./src/config/database');
const { generalLimiter, authLimiter } = require('./src/middleware/security');
const crypto = require('crypto');
const path = require('path');  // ← ADDED FOR STATIC FILES

// Load env vars
dotenv.config();

// Import routes
const paymentRoutes = require('./src/routes/paymentRoutes');
const sessionRoutes = require('./src/routes/sessionRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const logRoutes = require('./src/routes/logRoutes');

// Initialize express
const app = express();

// ========== SECURITY MIDDLEWARE ==========

// 1. Helmet - Security headers (updated to allow inline event handlers)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "https://cdnjs.cloudflare.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://sandbox.safaricom.co.ke", "https://api.safaricom.co.ke"],
    },
  },
}));

// 2. Remove X-Powered-By header
app.disable('x-powered-by');

// 3. Rate limiting for all requests
app.use(generalLimiter);

// 4. Cookie parser (for CSRF)
app.use(cookieParser(process.env.COOKIE_SECRET));

// ========== SIMPLE CSRF PROTECTION (WORKING) ==========

// Store CSRF tokens in memory (use Redis in production)
const csrfTokens = new Map();

// Clean up expired tokens every hour
setInterval(() => {
  const now = Date.now();
  for (const [token, expiry] of csrfTokens.entries()) {
    if (expiry < now) {
      csrfTokens.delete(token);
    }
  }
}, 60 * 60 * 1000);

// Generate CSRF token endpoint
app.get('/api/csrf-token', (req, res) => {
  try {
    const token = crypto.randomBytes(32).toString('hex');
    csrfTokens.set(token, Date.now() + 60 * 60 * 1000);
    res.json({ token });
  } catch (error) {
    console.error('CSRF token generation error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate CSRF token' });
  }
});

// CSRF validation middleware
const validateCsrfToken = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  
  const token = req.headers['x-csrf-token'];
  
  if (!token) {
    return res.status(403).json({ success: false, message: 'CSRF token missing' });
  }
  
  if (csrfTokens.has(token)) {
    csrfTokens.delete(token);
    return next();
  }
  
  res.status(403).json({ success: false, message: 'Invalid or expired CSRF token' });
};

app.use((req, res, next) => {
  req.validateCsrf = validateCsrfToken;
  next();
});

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ========== FIXED: CORS Configuration ==========
const allowedOrigins = process.env.NODE_ENV === 'production' 
  ? [
      process.env.FRONTEND_URL || 'https://yourdomain.com',
      'https://yourdomain.com',
      'https://admin.yourdomain.com'
    ]
  : ['http://localhost:3000', 'http://localhost:5000', 'http://127.0.0.1:3000', 'http://127.0.0.1:5000'];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`⚠️ CORS blocked request from origin: ${origin}`);
      callback(new Error('CORS policy violation'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token']
}));

// ========== HTTPS ENFORCEMENT (Production) ==========
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    const isHttps = req.headers['x-forwarded-proto'] === 'https' || req.secure;
    
    if (!isHttps) {
      const httpsUrl = `https://${req.headers.host}${req.url}`;
      console.log(`🔒 Redirecting HTTP to HTTPS: ${httpsUrl}`);
      return res.redirect(301, httpsUrl);
    }
    next();
  });
  console.log('🔒 HTTPS enforcement enabled - HTTP requests will redirect to HTTPS');
}

// Apply stricter rate limiting to auth routes
app.use('/api/admin/login', authLimiter);

// ========== FIXED: Serve static files (works on both Windows and Linux) ==========
app.use(express.static(path.join(__dirname)));

// Request logging middleware
app.use((req, res, next) => {
  if (req.path === '/api/payments/callback' && process.env.NODE_ENV === 'production') {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - Callback received`);
  } else {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  }
  next();
});

// Debug endpoint (only in development)
if (process.env.NODE_ENV !== 'production') {
  app.post('/debug-callback', (req, res) => {
    console.log('🔥🔥🔥 DEBUG CALLBACK RECEIVED 🔥🔥🔥');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(req.body, null, 2));
    res.json({ received: true, body: req.body });
  });
}

// ========== MOUNT ROUTES ==========
app.use('/api/payments', paymentRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/logs', logRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'SKYLIMITLESS WiFi Billing API',
    version: '1.0.0',
    endpoints: {
      payments: '/api/payments',
      sessions: '/api/sessions',
      admin: '/api/admin',
      logs: '/api/admin/logs',
      health: '/health'
    }
  });
});

// Error handler middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  
  if (err.message === 'CORS policy violation') {
    return res.status(403).json({
      success: false,
      message: 'Origin not allowed'
    });
  }
  
  if (err.name === 'SequelizeValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: err.errors.map(e => e.message)
    });
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired'
    });
  }

  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler for undefined routes
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl}`
  });
});

// Start server
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected successfully');
    
    await sequelize.sync();
    console.log('✅ Database synced');

    const User = require('./src/models/User');
    const Transaction = require('./src/models/Transaction');
    const Session = require('./src/models/Session');
    const LoginAttempt = require('./src/models/LoginAttempt');
    const SystemLog = require('./src/models/SystemLog');
    
    const adminExists = await User.findOne({ where: { is_admin: true } });
    
    if (!adminExists && process.env.ADMIN_PHONE && process.env.ADMIN_PASSWORD) {
      await User.create({
        phone: process.env.ADMIN_PHONE,
        password: process.env.ADMIN_PASSWORD,
        name: 'Administrator',
        is_admin: true
      });
      console.log('✅ Default admin created');
    }

    const server = app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`📁 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
      console.log(`🔧 Health check: http://localhost:${PORT}/health`);
      console.log(`📋 Logs endpoint: /api/admin/logs (admin only)`);
    });
    
    process.server = server;
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Rejection:', err);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
});

process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received, shutting down gracefully');
  if (process.server) {
    process.server.close(() => {
      console.log('💤 Process terminated');
    });
  } else {
    process.exit(0);
  }
});
