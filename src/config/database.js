const { Sequelize } = require('sequelize');
require('dotenv').config();

const sslConfig = process.env.DB_SSL === 'true' ? {
  ssl: {
    ca: process.env.DB_SSL_CA ? require('fs').readFileSync(process.env.DB_SSL_CA) : undefined,
    rejectUnauthorized: true
  }
} : {};

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    timezone: '+03:00',
    dialectOptions: sslConfig,
    pool: {
      max: 30,
      min: 5,
      acquire: 30000,
      idle: 10000
    }
  }
);

module.exports = sequelize;
