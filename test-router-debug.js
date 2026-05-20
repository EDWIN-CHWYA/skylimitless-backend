const routerService = require('./src/services/routerService');

async function test() {
    console.log('🔍 Testing router connection...');
    console.log('Router IP:', process.env.ROUTER_IP || '192.168.10.1');
    
    // Test connection
    const connected = await routerService.connect();
    console.log(`Connected: ${connected ? '✅' : '❌'}`);
    
    if (connected) {
        // Try to add a test user
        const result = await routerService.addHotspotUser(
            '0712345678',
            '00:00:00:00:00:00',
            1
        );
        console.log('Add user result:', result);
        
        // Get active sessions
        const active = await routerService.getActiveSessions();
        console.log('Active sessions count:', active.length);
    }
}

test();