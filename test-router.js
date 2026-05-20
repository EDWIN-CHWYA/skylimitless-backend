const routerService = require('./src/services/routerService');
require('dotenv').config();

async function testRouter() {
    console.log('🔌 Testing router connection...');
    console.log('Router IP:', process.env.ROUTER_IP);
    console.log('Router Port:', process.env.ROUTER_API_PORT);
    console.log('Router User:', process.env.ROUTER_USER);
    
    try {
        // Test connection
        console.log('\n📡 Attempting to connect...');
        const connected = await routerService.connect();
        console.log(`Connection: ${connected ? '✅ SUCCESS' : '❌ FAILED'}`);
        
        if (connected) {
            // Get router identity
            if (routerService.connection) {
                try {
                    const identity = await routerService.connection.write('/system/identity/print');
                    console.log(`Router Name: ${identity[0]?.name || 'Unknown'}`);
                } catch (err) {
                    console.log('Could not get router identity:', err.message);
                }
            }
            
            // Get active sessions
            console.log('\n📊 Getting active sessions...');
            const active = await routerService.getActiveSessions();
            console.log(`Active sessions: ${active.length}`);
            
            // Try to add a test user
            console.log('\n👤 Testing user creation...');
            const result = await routerService.addHotspotUser(
                '0712345678',
                '00:11:22:33:44:55',  // Test MAC (valid format)
                1  // 1 hour
            );
            console.log('User creation result:', result);
            
            if (result.success) {
                console.log(`✅ Test user created: ${result.username}`);
                console.log(`   Password: ${result.password}`);
                console.log(`   Duration: ${result.duration} hours`);
            } else {
                console.log(`❌ Failed: ${result.error}`);
            }
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Stack:', error.stack);
    }
    
    console.log('\n✨ Test completed');
}

testRouter();