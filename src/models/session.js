const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const User = require('./User');

const Session = sequelize.define('Session', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    references: {
      model: User,
      key: 'id'
    }
  },
  transaction_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  mac_address: {
    type: DataTypes.STRING(17),
    allowNull: true
  },
  ip_address: {
    type: DataTypes.STRING(45),
    allowNull: true
  },
  start_time: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  end_time: {
    type: DataTypes.DATE,
    allowNull: false
  },
  duration_hours: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false
  },
  data_used: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    comment: 'Data used in MB'
  },
  // ✅ NEW: Data limit for this session (in MB)
  data_limit_mb: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    defaultValue: null,
    comment: 'Data limit in MB (null = unlimited)'
  },
  status: {
    type: DataTypes.ENUM('active', 'expired', 'disconnected', 'data_limit_reached'),
    defaultValue: 'active'
  },
  // Hotspot credentials from MikroTik
  hotspot_username: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  hotspot_password: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  // Device ID for one-user-at-a-time restriction
  device_id: {
    type: DataTypes.STRING(50),
    allowNull: true
  }
}, {
  timestamps: true,
  indexes: [
    { fields: ['user_id'] },
    { fields: ['status'] },
    { fields: ['end_time'] },
    { fields: ['data_limit_mb'] }
  ]
});

Session.belongsTo(User, { foreignKey: 'user_id' });
User.hasMany(Session, { foreignKey: 'user_id' });

module.exports = Session;