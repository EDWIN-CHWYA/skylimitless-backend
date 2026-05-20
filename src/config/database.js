const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    dialect: 'mysql',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    timezone: '+03:00', // East Africa Time (UTC+3)
    pool: {
      max: 30,
      min: 5,
      acquire: 30000,
      idle: 10000  
    }
  }
);

module.exports = sequelize;