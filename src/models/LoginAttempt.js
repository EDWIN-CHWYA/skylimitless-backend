const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const LoginAttempt = sequelize.define('LoginAttempt', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  ip_address: {
    type: DataTypes.STRING(45),
    allowNull: false
  },
  phone: {
    type: DataTypes.STRING(15),
    allowNull: true
  },
  attempt_count: {
    type: DataTypes.INTEGER,
    defaultValue: 1
  },
  first_attempt_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  last_attempt_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  blocked_until: {
    type: DataTypes.DATE,
    allowNull: true
  },
  block_stage: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
}, {
  timestamps: true,
  tableName: 'LoginAttempts'
});

module.exports = LoginAttempt;