const axios = require('axios');
const mpesaConfig = require('../config/mpesa');
const Transaction = require('../models/Transaction');
const crypto = require('crypto');

class MpesaService {
  constructor() {
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  // ✅ NEW: Verify callback source IP
  isSafaricomCallback(ip) {
    // In development, allow all (for testing with ngrok)
    if (process.env.NODE_ENV === 'development') {
      console.log(`⚠️ Development mode: Allowing callback from ${ip}`);
      return true;
    }
    
    // Safaricom IP ranges (production)
    const isSafaricom = ip.startsWith('197.248.') || 
                        ip.startsWith('196.201.') ||
                        ip.startsWith('52.');
    
    if (!isSafaricom) {
      console.error(`❌ Rejected callback from unauthorized IP: ${ip}`);
    }
    
    return isSafaricom;
  }

  // Generate access token
  async getAccessToken() {
    try {
      // Check if token is still valid
      if (this.accessToken && this.tokenExpiry > Date.now()) {
        return this.accessToken;
      }

      const auth = Buffer.from(
        `${mpesaConfig.consumerKey}:${mpesaConfig.consumerSecret}`
      ).toString('base64');

      const response = await axios.get(mpesaConfig.getAuthUrl(), {
        headers: {
          Authorization: `Basic ${auth}`
        },
        timeout: 30000
      });

      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000; // Subtract 1 minute for safety
      
      return this.accessToken;
    } catch (error) {
      console.error('Error getting access token:', error.response?.data || error.message);
      throw new Error('Failed to get M-Pesa access token');
    }
  }

  // Generate password for STK push
  generatePassword(timestamp) {
    const businessShortCode = mpesaConfig.shortCode;
    const passkey = mpesaConfig.passkey;
    const data = businessShortCode + passkey + timestamp;
    return Buffer.from(data).toString('base64');
  }

  // Helper function to format phone number for M-Pesa
  formatPhoneForMpesa(phone) {
    // Remove any non-digit characters
    let cleaned = phone.replace(/\D/g, '');
    
    console.log(`Formatting phone: ${phone} -> cleaned: ${cleaned}`);
    
    // If it starts with 0, replace with 254
    if (cleaned.startsWith('0')) {
      cleaned = '254' + cleaned.slice(1);
    }
    // If it doesn't start with 0 or 254, assume it's a local number without 0
    else if (!cleaned.startsWith('254')) {
      cleaned = '254' + cleaned;
    }
    
    console.log(`Final formatted phone: ${cleaned}`);
    return cleaned;
  }

  // Initiate STK Push
  async stkPush(phone, amount, accountReference, transactionDesc, packageName, durationHours) {
    try {
      const token = await this.getAccessToken();
      
      // Format phone number for M-Pesa (must be 254XXXXXXXXX)
      const formattedPhone = this.formatPhoneForMpesa(phone);
      
      const timestamp = this.getTimestamp();
      const password = this.generatePassword(timestamp);
      
      const payload = {
        BusinessShortCode: mpesaConfig.shortCode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: amount,
        PartyA: formattedPhone,
        PartyB: mpesaConfig.shortCode,
        PhoneNumber: formattedPhone,
        CallBackURL: mpesaConfig.callbackUrl,
        AccountReference: accountReference || 'SKYLIMITLESS',
        TransactionDesc: transactionDesc || 'WiFi Access'
      };

      console.log(`Sending STK Push to phone: ${formattedPhone}`);

      const response = await axios.post(mpesaConfig.getStkPushUrl(), payload, {
        headers: {
          Authorization: `Bearer ${token}`
        },
        timeout: 30000
      });

      if (response.data.ResponseCode === '0') {
        // Create transaction record - store the original phone number
        const transaction = await Transaction.create({
          phone: phone,
          amount: amount,
          package_name: packageName,
          duration_hours: durationHours,
          merchant_request_id: response.data.MerchantRequestID,
          checkout_request_id: response.data.CheckoutRequestID,
          status: 'pending'
        });

        return {
          success: true,
          message: 'STK Push sent successfully',
          data: response.data,
          transactionId: transaction.id
        };
      } else {
        throw new Error(response.data.ResponseDescription || 'STK Push failed');
      }
    } catch (error) {
      console.error('STK Push Error:', error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.ResponseDescription || error.message
      };
    }
  }

  // ========== FIXED: Handle M-Pesa callback with source verification ==========
  async handleCallback(callbackData, clientIp) {
    try {
      console.log('📞 [DEBUG] Raw callback received');
      
      // ✅ NEW: Verify callback source IP
      if (clientIp && !this.isSafaricomCallback(clientIp)) {
        console.error('❌ Callback rejected - unauthorized IP');
        throw new Error('Unauthorized callback source');
      }
      
      console.log('📞 [DEBUG] Callback data structure:', JSON.stringify(callbackData, null, 2));
      
      // Handle different callback formats
      let stkCallback = null;
      
      // Format 1: { Body: { stkCallback: {...} } }
      if (callbackData.Body && callbackData.Body.stkCallback) {
        stkCallback = callbackData.Body.stkCallback;
        console.log('✅ Found callback in Body.stkCallback format');
      }
      // Format 2: { stkCallback: {...} }
      else if (callbackData.stkCallback) {
        stkCallback = callbackData.stkCallback;
        console.log('✅ Found callback in stkCallback format');
      }
      // Format 3: The callback is the stkCallback itself
      else if (callbackData.ResultCode !== undefined) {
        stkCallback = callbackData;
        console.log('✅ Callback is directly the stkCallback');
      }
      
      if (!stkCallback) {
        console.error('❌ Could not find stkCallback in:', JSON.stringify(callbackData, null, 2));
        throw new Error('Invalid callback structure');
      }

      const { 
        MerchantRequestID, 
        CheckoutRequestID, 
        ResultCode, 
        ResultDesc, 
        CallbackMetadata 
      } = stkCallback;

      console.log(`📊 ResultCode: ${ResultCode}`);
      console.log(`📊 ResultDesc: ${ResultDesc}`);
      console.log(`📊 CheckoutRequestID: ${CheckoutRequestID}`);

      // Find transaction using the checkout_request_id
      const transaction = await Transaction.findOne({
        where: { checkout_request_id: CheckoutRequestID }
      });

      if (!transaction) {
        console.error(`❌ Transaction not found for ID: ${CheckoutRequestID}`);
        throw new Error(`Transaction not found: ${CheckoutRequestID}`);
      }

      // ✅ NEW: Prevent duplicate processing
      if (transaction.status !== 'pending') {
        console.log(`⚠️ Transaction ${transaction.id} already processed (status: ${transaction.status})`);
        return {
          success: transaction.status === 'completed',
          alreadyProcessed: true,
          transaction: transaction
        };
      }

      console.log(`✅ Found transaction ID: ${transaction.id}, current status: ${transaction.status}`);

      // Update transaction based on ResultCode
      if (ResultCode === 0) {
        transaction.status = 'completed';
        console.log(`✅ Payment SUCCESSFUL`);
        
        // Get M-Pesa receipt number if available
        if (CallbackMetadata && CallbackMetadata.Item) {
          const metadataArray = CallbackMetadata.Item;
          for (const item of metadataArray) {
            if (item.Name === 'MpesaReceiptNumber') {
              transaction.mpesa_receipt = item.Value;
              console.log(`📝 Receipt Number: ${item.Value}`);
            }
            if (item.Name === 'Amount') {
              console.log(`💰 Amount: ${item.Value}`);
            }
          }
        } else {
          console.log(`⚠️ No CallbackMetadata - sandbox may be sending incomplete data`);
          // For sandbox testing, generate a fake receipt number
          transaction.mpesa_receipt = `SANDBOX_${Date.now()}`;
          console.log(`📝 Generated sandbox receipt: ${transaction.mpesa_receipt}`);
        }
      } else {
        transaction.status = 'failed';
        console.log(`❌ Payment FAILED: ${ResultDesc}`);
      }
      
      transaction.result_code = ResultCode;
      transaction.result_desc = ResultDesc;
      transaction.user_id = transaction.user_id || null;
      
      await transaction.save();
      console.log(`✅ Transaction ${transaction.id} updated to ${transaction.status}`);

      return {
        success: ResultCode === 0,
        transaction: transaction
      };
    } catch (error) {
      console.error('❌ Callback error:', error);
      throw error;
    }
  }

  // Query transaction status
  async queryStatus(checkoutRequestId) {
    try {
      const token = await this.getAccessToken();
      const timestamp = this.getTimestamp();
      const password = this.generatePassword(timestamp);

      const payload = {
        BusinessShortCode: mpesaConfig.shortCode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId
      };

      const response = await axios.post(mpesaConfig.getQueryUrl(), payload, {
        headers: {
          Authorization: `Bearer ${token}`
        },
        timeout: 30000
      });

      return response.data;
    } catch (error) {
      console.error('Query status error:', error);
      throw error;
    }
  }

  // Helper to get timestamp in required format
  getTimestamp() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
  }
}

module.exports = new MpesaService();