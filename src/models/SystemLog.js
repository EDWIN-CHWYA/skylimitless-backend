const { DataTypes, Op } = require('sequelize');
const sequelize = require('../config/database');

const SystemLog = sequelize.define('SystemLog', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  admin_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Admin who performed the action'
  },
  admin_phone: {
    type: DataTypes.STRING(15),
    allowNull: true,
    comment: 'Admin phone number',
    validate: {
      is: /^(07|01)\d{8}$/i
    }
  },
  action: {
    type: DataTypes.ENUM(
      'LOGIN',
      'LOGOUT',
      'LOGIN_FAILED',
      'USER_BLOCKED',
      'USER_UNBLOCKED',
      'SESSION_EXTENDED',
      'SESSION_TERMINATED',
      'USER_CREATED',
      'USER_UPDATED'
    ),
    allowNull: false
  },
  target_type: {
    type: DataTypes.ENUM('user', 'session', 'transaction', 'admin', 'system'),
    allowNull: true
  },
  target_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'ID of the affected record',
    validate: {
      min: 1
    }
  },
  details: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Additional details (max 2000 chars)',
    get() {
      const rawValue = this.getDataValue('details');
      if (!rawValue) return null;
      try {
        return JSON.parse(rawValue);
      } catch (e) {
        return { raw: rawValue };
      }
    },
    set(value) {
      if (!value) {
        this.setDataValue('details', null);
        return;
      }
      
      let detailsStr;
      if (typeof value === 'object') {
        detailsStr = JSON.stringify(value);
      } else {
        detailsStr = String(value);
      }
      
      // Limit size to prevent database bloat
      if (detailsStr.length > 2000) {
        detailsStr = JSON.stringify({ 
          truncated: true, 
          message: 'Details exceeded 2000 characters',
          preview: detailsStr.substring(0, 500) + '...'
        });
      }
      
      this.setDataValue('details', detailsStr);
    }
  },
  ip_address: {
    type: DataTypes.STRING(45),
    allowNull: true,
    validate: {
      isIP: true
    }
  },
  user_agent: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('success', 'failed', 'warning'),
    defaultValue: 'success'
  }
}, {
  timestamps: true,
  indexes: [
    { fields: ['admin_id'] },
    { fields: ['action'] },
    { fields: ['createdAt'] },
    { fields: ['target_type', 'target_id'] },
    { fields: ['status'] },
    { fields: ['createdAt'], name: 'logs_cleanup_idx' }
  ]
});

// Auto-delete logs older than 90 days
async function cleanupOldLogs() {
  try {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    const deleted = await SystemLog.destroy({
      where: {
        createdAt: { [Op.lt]: ninetyDaysAgo }
      }
    });
    
    if (deleted > 0) {
      console.log(`🗑️ [CLEANUP] Removed ${deleted} log records older than 90 days`);
    }
  } catch (error) {
    console.error('❌ Log cleanup error:', error.message);
  }
}

// Run cleanup daily in production
if (process.env.NODE_ENV === 'production') {
  // Run once on startup
  cleanupOldLogs();
  // Then every 24 hours
  setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000);
  console.log('📋 Log cleanup scheduled (every 24 hours, keeping 90 days)');
}

module.exports = SystemLog;