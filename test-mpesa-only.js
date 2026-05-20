const axios = require('axios');
require('dotenv').config();

async function testMpesa() {
    console.log('🔍 Testing M-Pesa Sandbox Connection...');
    console.log('Consumer Key (first 20 chars):', process.env.MPESA_CONSUMER_KEY?.substring(0, 20));
    console.log('Consumer Secret (first 20 chars):', process.env.MPESA_CONSUMER_SECRET?.substring(0, 20));
    
    const auth = Buffer.from(
        `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
    ).toString('base64');
    
    try {
        const response = await axios.get(
            'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
            {
                headers: {
                    Authorization: `Basic ${auth}`
                },
                timeout: 30000
            }
        );
        console.log('✅ SUCCESS!');
        console.log('Access Token:', response.data.access_token?.substring(0, 50) + '...');
        console.log('Expires In:', response.data.expires_in, 'seconds');
    } catch (error) {
        console.error('❌ FAILED:');
        console.error('Status:', error.response?.status);
        console.error('Error:', error.response?.data || error.message);
    }
}

testMpesa();