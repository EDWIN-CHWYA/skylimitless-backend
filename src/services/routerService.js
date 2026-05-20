const { RouterOSAPI } = require('node-routeros');
const crypto = require('crypto');
require('dotenv').config();

class RouterService {
  constructor() {
    this.connection = null;
  }

  // ✅ NEW: Validate MAC address format
  validateMacAddress(macAddress) {
    if (!macAddress) return false;
    // Format: XX:XX:XX:XX:XX:XX or XX-XX-XX-XX-XX-XX
    const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
    return macRegex.test(macAddress);
  }

  // ✅ NEW: Normalize MAC address to consistent format
  normalizeMacAddress(macAddress) {
    if (!macAddress) return null;
    // Remove separators, convert to uppercase
    let clean = macAddress.toUpperCase().replace(/[:-]/g, '');
    if (clean.length !== 12) return null;
    // Format as XX:XX:XX:XX:XX:XX
    return clean.match(/.{2}/g).join(':');
  }

  // ✅ NEW: Validate phone number (Kenyan format)
  validatePhoneNumber(phone) {
    const phoneRegex = /^(07|01)\d{8}$/;
    return phoneRegex.test(phone);
  }

  // ✅ NEW: Validate duration (reasonable range)
  validateDuration(hours) {
    const num = parseFloat(hours);
    if (isNaN(num)) return false;
    // Min 30 minutes (0.5 hours), Max 720 hours (30 days)
    return num >= 0.5 && num <= 720;
  }

  // ✅ NEW: Validate data limit (reasonable range)
  validateDataLimit(dataLimitMB) {
    if (!dataLimitMB) return true; // No limit is valid
    const num = parseFloat(dataLimitMB);
    if (isNaN(num)) return false;
    // Min 1 MB, Max 1 TB (1,048,576 MB)
    return num >= 1 && num <= 1048576;
  }

  // ✅ NEW: Sanitize input for router API
  sanitizeForRouter(input) {
    if (!input) return '';
    // Remove potentially dangerous characters
    return String(input)
      .replace(/[&<>"']/g, '')
      .replace(/\n/g, ' ')
      .replace(/\r/g, '')
      .trim();
  }

  // ✅ NEW: Generate cryptographically secure password
  generateSecurePassword() {
    // 12 character secure random password
    return crypto.randomBytes(6).toString('hex');
  }

  // ✅ NEW: Generate secure username
  generateSecureUsername(phone) {
    const cleanPhone = phone.replace(/\D/g, '').slice(-6);
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(4).toString('hex');
    return `WIFI_${cleanPhone}_${timestamp}_${random}`;
  }

  async connect() {
    try {
      // Close existing connection if any
      if (this.connection) {
        try {
          await this.connection.close();
        } catch (e) {
          // Ignore close errors
        }
      }

      this.connection = new RouterOSAPI({
        host: process.env.ROUTER_IP || '192.168.10.1',
        user: process.env.ROUTER_USER || 'admin',
        password: process.env.ROUTER_PASSWORD || '',
        port: parseInt(process.env.ROUTER_API_PORT) || 8728,
        timeout: 10000,
        keepalive: true
      });

      await this.connection.connect();
      console.log('✅ Connected to MikroTik router');
      return true;
    } catch (error) {
      console.error('❌ Router connection error:', error.message);
      return false;
    }
  }

  // ========== UPDATED: Add hotspot user with validation AND data limit ==========
  async addHotspotUser(phone, macAddress, durationHours, dataLimitMB = null) {
    try {
      // ✅ CRITICAL FIX #1: Validate phone number
      if (!this.validatePhoneNumber(phone)) {
        console.error('❌ Invalid phone number format:', phone);
        return { 
          success: false, 
          error: 'Invalid phone number format',
          code: 'INVALID_PHONE'
        };
      }

      // ✅ CRITICAL FIX #2: Validate MAC address if provided
      let normalizedMac = null;
      if (macAddress && macAddress !== '00:00:00:00:00:00') {
        if (!this.validateMacAddress(macAddress)) {
          console.error('❌ Invalid MAC address format:', macAddress);
          return { 
            success: false, 
            error: 'Invalid MAC address format',
            code: 'INVALID_MAC'
          };
        }
        normalizedMac = this.normalizeMacAddress(macAddress);
      }

      // ✅ CRITICAL FIX #3: Validate duration
      if (!this.validateDuration(durationHours)) {
        console.error('❌ Invalid duration:', durationHours);
        return { 
          success: false, 
          error: 'Invalid duration (must be between 0.5 and 720 hours)',
          code: 'INVALID_DURATION'
        };
      }

      // ✅ NEW: Validate data limit
      if (!this.validateDataLimit(dataLimitMB)) {
        console.error('❌ Invalid data limit:', dataLimitMB);
        return { 
          success: false, 
          error: 'Invalid data limit (must be between 1 MB and 1 TB)',
          code: 'INVALID_DATA_LIMIT'
        };
      }

      // Connect to router
      const connected = await this.connect();
      if (!connected) {
        return { 
          success: false, 
          error: 'Router connection failed',
          code: 'ROUTER_OFFLINE'
        };
      }

      // ✅ CRITICAL FIX #4: Generate secure credentials
      const username = this.generateSecureUsername(phone);
      const password = this.generateSecurePassword();
      const uptime = `${Math.floor(durationHours * 60 * 60)}`; // seconds
      const comment = `Phone: ${phone} | Added: ${new Date().toISOString()}`;
      
      // ✅ NEW: Convert MB to bytes for MikroTik (1 MB = 1,048,576 bytes)
      let totalBytes = null;
      if (dataLimitMB && dataLimitMB > 0) {
        totalBytes = Math.floor(dataLimitMB * 1048576); // MB to bytes
        console.log(`📊 Data limit set: ${dataLimitMB} MB (${totalBytes} bytes)`);
      }

      // ✅ CRITICAL FIX #5: Sanitize all inputs
      const sanitizedUsername = this.sanitizeForRouter(username);
      const sanitizedPassword = this.sanitizeForRouter(password);
      const sanitizedComment = this.sanitizeForRouter(comment);

      // Build the add command array
      const addCommand = [
        `=name=${sanitizedUsername}`,
        `=password=${sanitizedPassword}`,
        `=limit-uptime=${uptime}`,
        `=comment=${sanitizedComment}`
      ];

      // ✅ NEW: Add data limit if specified
      if (totalBytes) {
        addCommand.push(`=limit-bytes-total=${totalBytes}`);
        console.log(`📡 Adding hotspot user: ${sanitizedUsername} (${durationHours}h, ${dataLimitMB}MB limit)`);
      } else {
        console.log(`📡 Adding hotspot user: ${sanitizedUsername} (${durationHours}h, unlimited data)`);
      }

      const result = await this.connection.write('/ip/hotspot/user/add', addCommand);

      // Add MAC binding if MAC address provided
      if (normalizedMac) {
        try {
          await this.connection.write('/ip/hotspot/user/add-binding', [
            `=user=${sanitizedUsername}`,
            `=mac-address=${normalizedMac}`,
            `=type=regular`
          ]);
          console.log(`✅ MAC binding added for ${normalizedMac}`);
        } catch (macError) {
          console.warn(`⚠️ Could not add MAC binding: ${macError.message}`);
        }
      }

      console.log('✅ Hotspot user added:', sanitizedUsername);
      return {
        success: true,
        username: sanitizedUsername,
        password: sanitizedPassword,
        duration: durationHours,
        dataLimitMB: dataLimitMB,
        endTime: new Date(Date.now() + durationHours * 60 * 60 * 1000)
      };
    } catch (error) {
      console.error('❌ Error adding hotspot user:', error.message);
      return { 
        success: false, 
        error: error.message,
        code: 'ROUTER_ERROR'
      };
    }
  }

  async getActiveSessions() {
    try {
      await this.connect();
      const active = await this.connection.write('/ip/hotspot/active/print');
      
      // ✅ Sanitize output (remove sensitive/internal fields)
      return active.map(session => ({
        username: session.name,
        macAddress: session['mac-address'],
        ipAddress: session.address,
        uptime: session.uptime,
        bytesIn: session.bytesIn,
        bytesOut: session.bytesOut
      }));
    } catch (error) {
      console.error('❌ Error getting active sessions:', error.message);
      return [];
    }
  }

  // ========== FIXED: Disconnect user with validation ==========
  async disconnectUser(macAddress) {
    try {
      // ✅ Validate MAC address
      if (!this.validateMacAddress(macAddress)) {
        console.error('❌ Invalid MAC address format:', macAddress);
        return { success: false, error: 'Invalid MAC address' };
      }

      const normalizedMac = this.normalizeMacAddress(macAddress);
      
      const connected = await this.connect();
      if (!connected) {
        return { success: false, error: 'Router connection failed' };
      }
      
      const active = await this.connection.write('/ip/hotspot/active/print', [
        `?mac-address=${normalizedMac}`
      ]);
      
      if (active && active.length > 0) {
        await this.connection.write('/ip/hotspot/active/remove', [
          `=.id=${active[0]['.id']}`
        ]);
        console.log('✅ User disconnected:', normalizedMac);
        return { success: true, message: 'User disconnected' };
      }
      
      return { success: false, error: 'User not found' };
    } catch (error) {
      console.error('❌ Error disconnecting user:', error.message);
      return { success: false, error: error.message };
    }
  }

  // ✅ NEW: Get user data usage from router
  async getUserDataUsage(username) {
    try {
      const connected = await this.connect();
      if (!connected) {
        return { success: false, error: 'Router connection failed' };
      }
      
      const user = await this.connection.write('/ip/hotspot/user/print', [
        `?name=${username}`
      ]);
      
      if (user && user.length > 0) {
        const bytesIn = parseInt(user[0]['bytes-in'] || 0);
        const bytesOut = parseInt(user[0]['bytes-out'] || 0);
        const totalBytes = bytesIn + bytesOut;
        const totalMB = totalBytes / (1024 * 1024);
        
        return {
          success: true,
          bytesIn: bytesIn,
          bytesOut: bytesOut,
          totalBytes: totalBytes,
          totalMB: totalMB
        };
      }
      
      return { success: false, error: 'User not found' };
    } catch (error) {
      console.error('Error getting user data usage:', error.message);
      return { success: false, error: error.message };
    }
  }

  // ✅ NEW: Health check method
  async healthCheck() {
    try {
      const connected = await this.connect();
      if (!connected) return false;
      await this.connection.write('/system/identity/print');
      return true;
    } catch (error) {
      return false;
    }
  }

  // ✅ NEW: Graceful disconnect
  async disconnect() {
    if (this.connection) {
      try {
        await this.connection.close();
        console.log('✅ Disconnected from MikroTik router');
      } catch (error) {
        console.error('Error disconnecting:', error.message);
      }
      this.connection = null;
    }
  }
}

module.exports = new RouterService();