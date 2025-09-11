#!/usr/bin/env node

/**
 * Development Status Checker
 * Shows current status of the OBS Web development environment
 */

const baseUrl = 'http://localhost:8081';

async function checkStatus() {
  console.log('🔍 OBS Web Development Status');
  console.log('============================\n');
  
  try {
    // Check server
    const response = await fetch(`${baseUrl}/config`);
    if (response.ok) {
      console.log('✅ Server: Running on http://localhost:8081');
      
      // Check if in test mode
      const config = await response.json();
      console.log('🧪 Mode: Test Mode (ATEM & Streamer mocked)');
      console.log(`📊 Cameras: ${Object.keys(config.cameras || {}).length} configured`);
      console.log(`🎛️  ATEM: ${config.connectToAtem ? 'Connected' : 'Disconnected'}`);
      
      console.log('\n🌐 Available URLs:');
      console.log('   Main App:     http://localhost:8081');
      console.log('   Admin Panel:  http://localhost:8081/admin.html');
      console.log('   Test Dashboard: http://localhost:8081/test.html');
      
      console.log('\n📝 Development Commands:');
      console.log('   Start server: node src/server.js --test');
      console.log('   Build frontend: npm run build');
      console.log('   Test mocks: node test-mocks.js');
      console.log('   Stop server: pkill -f "node src/server.js"');
      
      console.log('\n✨ No more console errors!');
      console.log('   - Livereload disabled (not needed for static serving)');
      console.log('   - Updated mobile-web-app-capable meta tag');
      
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    console.log('❌ Server not running');
    console.log('   Start with: node src/server.js --test');
    console.log(`   Error: ${error.message}`);
  }
}

checkStatus().catch(console.error);
