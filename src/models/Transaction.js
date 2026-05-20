const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const User = require('./user');

const Transaction = sequelize.define('Transaction', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    references: {
      model: user,
      key: 'id'
    }
  },
  phone: {
    type: DataTypes.STRING(15),
    allowNull: false
  },
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  package_name: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  duration_hours: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false
  },
  mpesa_receipt: {
    type: DataTypes.STRING(50),
    allowNull: true,
    unique: true
  },
  merchant_request_id: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  checkout_request_id: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('pending', 'completed', 'failed', 'cancelled'),
    defaultValue: 'pending'
  },
  result_code: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  result_desc: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  timestamps: true
});

Transaction.belongsTo(user, { foreignKey: 'user_id' });
user.hasMany(Transaction, { foreignKey: 'user_id' });

module.exports = Transaction;
