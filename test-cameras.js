#!/usr/bin/env node

/**
 * Camera Mock Testing Script
 * Demonstrates the enhanced camera mocking functionality
 */

const baseUrl = 'http://localhost:8081';

async function testCameraOperation(name, url) {
  try {
    console.log(`\n🔄 ${name}...`);
    const response = await fetch(url);
    const result = await response.json();
    
    // Show camera states
    result.forEach(camera => {
      const status = camera.status === 'ON' ? '🟢' : '🔴';
      console.log(`   ${status} ${camera.naam} (${camera.ip}): ${camera.status}`);
    });
    
    return true;
  } catch (error) {
    console.log(`❌ ${name}: ${error.message}`);
    return false;
  }
}

async function runCameraTests() {
  console.log('📹 Camera Mock Testing');
  console.log('======================\n');
  
  console.log('🧪 Testing Enhanced Camera Mocking:');
  console.log('   - Realistic state tracking per camera IP');
  console.log('   - Proper HTTP request/response simulation');
  console.log('   - State persistence during session\n');
  
  // Test initial status
  await testCameraOperation('Initial Camera Status', `${baseUrl}/getCameraStatus`);
  
  // Test turning cameras off
  await testCameraOperation('Turning Cameras OFF', `${baseUrl}/camerasOff`);
  await testCameraOperation('Status After Turn OFF', `${baseUrl}/getCameraStatus`);
  
  // Test turning cameras on
  await testCameraOperation('Turning Cameras ON', `${baseUrl}/camerasOn`);
  await testCameraOperation('Status After Turn ON', `${baseUrl}/getCameraStatus`);
  
  // Test multiple operations
  console.log('\n🔄 Testing Multiple Operations:');
  await testCameraOperation('Turn OFF Again', `${baseUrl}/camerasOff`);
  await testCameraOperation('Turn ON Again', `${baseUrl}/camerasOn`);
  await testCameraOperation('Final Status', `${baseUrl}/getCameraStatus`);
  
  console.log('\n✅ Camera Mock Testing Complete!');
  console.log('\n📋 What the mocks provide:');
  console.log('   • Realistic camera power state tracking');
  console.log('   • Proper HTTP request simulation');
  console.log('   • Individual camera state management');
  console.log('   • Error handling and logging');
  console.log('   • Network delay simulation');
  
  console.log('\n🌐 Test in browser:');
  console.log('   Main App: http://localhost:8081');
  console.log('   Admin Panel: http://localhost:8081/admin.html');
}

// Check if server is running
async function checkServer() {
  try {
    const response = await fetch(`${baseUrl}/config`);
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function main() {
  console.log('🔍 Checking if server is running...');
  
  if (await checkServer()) {
    console.log('✅ Server is running, starting camera tests...\n');
    await runCameraTests();
  } else {
    console.log('❌ Server is not running!');
    console.log('   Please start the server with: node src/server.js --test');
    process.exit(1);
  }
}

main().catch(console.error);
