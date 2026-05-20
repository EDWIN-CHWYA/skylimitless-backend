require('dotenv').config();

module.exports = {
  // Router connection details
  ip: process.env.ROUTER_IP || '192.168.1.1',
  username: process.env.ROUTER_USER || 'admin',
  password: process.env.ROUTER_PASSWORD || '',
  port: process.env.ROUTER_API_PORT || 8728,
  
  // Hotspot configuration
  hotspot: {
    server: 'hotspot1',
    profile: 'default',
    rateLimit: '10M/10M' // Download/Upload limit
  },
  
  // Connection methods
  connectionMethod: process.env.ROUTER_CONNECTION || 'api', // 'api' or 'rest'
  
  // REST API URL for RouterOS 7+
  restUrl: function() {
    return `http://${this.ip}/rest`;
  }
};