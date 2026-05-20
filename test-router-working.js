const routerService = require('./src/services/routerService');

async function test() {
    console.log('🔌 Testing router connection...');
    
    // Test connection
    const connected = await routerService.connect();
    console.log(`Connected: ${connected ? '✅' : '❌'}`);
    
    if (connected) {
        // Test adding a user
        const result = await routerService.addHotspotUser(
            '0712345678',
            '00:00:00:00:00:00',
            1
        );
        console.log('Add user result:', result);
        
        // Get active sessions
        const active = await routerService.getActiveSessions();
        console.log('Active sessions:', active.length);
    }
}

test();