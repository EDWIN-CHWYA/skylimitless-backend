require('dotenv').config();

module.exports = {
  consumerKey: process.env.MPESA_CONSUMER_KEY,
  consumerSecret: process.env.MPESA_CONSUMER_SECRET,
  passkey: process.env.MPESA_PASSKEY,
  shortCode: process.env.MPESA_SHORTCODE,
  environment: process.env.MPESA_ENVIRONMENT || 'sandbox',
  
  // URLs
  callbackUrl: process.env.MPESA_CALLBACK_URL,
  
  // API URLs (sandbox vs production)
  getAuthUrl: function() {
    return this.environment === 'production'
      ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
      : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';
  },
  
  getStkPushUrl: function() {
    return this.environment === 'production'
      ? 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
      : 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';
  },
  
  getQueryUrl: function() {
    return this.environment === 'production'
      ? 'https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query'
      : 'https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query';
  }
};