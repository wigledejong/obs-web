#!/usr/bin/env node

/**
 * Test script to demonstrate mock functionality
 * Run with: node test-mocks.js
 */

const baseUrl = 'http://localhost:8081';

async function testEndpoint(name, url, method = 'GET', data = null) {
  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    
    if (data) {
      options.body = JSON.stringify(data);
    }
    
    const response = await fetch(url, options);
    const result = await response.text();
    
    console.log(`✅ ${name}: ${result.substring(0, 100)}${result.length > 100 ? '...' : ''}`);
    return true;
  } catch (error) {
    console.log(`❌ ${name}: ${error.message}`);
    return false;
  }
}

async function getStreamingStatus() {
  try {
    const response = await fetch(`${baseUrl}/getStatus`);
    const data = await response.json();
    return data.statusStream;
  } catch (error) {
    console.log(`❌ Failed to get streaming status: ${error.message}`);
    return null;
  }
}

async function testStreamingStateChanges() {
  console.log('   🔍 Initial state check...');
  const initialState = await getStreamingStatus();
  console.log(`   📊 Initial streaming status: ${initialState}`);
  
  // Test starting stream
  console.log('   🚀 Starting stream...');
  await testEndpoint('Start Stream', `${baseUrl}/startStreamen`);
  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for state to update
  
  const afterStart = await getStreamingStatus();
  console.log(`   📊 After start - streaming status: ${afterStart}`);
  
  if (afterStart === true) {
    console.log('   ✅ Stream started successfully!');
  } else {
    console.log('   ❌ Stream failed to start!');
  }
  
  // Test stopping stream
  console.log('   🛑 Stopping stream...');
  await testEndpoint('Stop Stream', `${baseUrl}/stopStreamen`);
  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for state to update
  
  const afterStop = await getStreamingStatus();
  console.log(`   📊 After stop - streaming status: ${afterStop}`);
  
  if (afterStop === false) {
    console.log('   ✅ Stream stopped successfully!');
  } else {
    console.log('   ❌ Stream failed to stop!');
  }
  
  // Test multiple start/stop cycles
  console.log('   🔄 Testing multiple start/stop cycles...');
  for (let i = 1; i <= 3; i++) {
    console.log(`   🔄 Cycle ${i}/3:`);
    
    // Start
    await testEndpoint(`Start Stream (Cycle ${i})`, `${baseUrl}/startStreamen`);
    await new Promise(resolve => setTimeout(resolve, 500));
    const statusAfterStart = await getStreamingStatus();
    console.log(`      📊 After start: ${statusAfterStart}`);
    
    // Stop
    await testEndpoint(`Stop Stream (Cycle ${i})`, `${baseUrl}/stopStreamen`);
    await new Promise(resolve => setTimeout(resolve, 500));
    const statusAfterStop = await getStreamingStatus();
    console.log(`      📊 After stop: ${statusAfterStop}`);
    
    if (statusAfterStart === true && statusAfterStop === false) {
      console.log(`      ✅ Cycle ${i} successful!`);
    } else {
      console.log(`      ❌ Cycle ${i} failed!`);
    }
  }
  
  // Test rapid start/stop (stress test)
  console.log('   ⚡ Testing rapid start/stop (stress test)...');
  const rapidTests = [];
  for (let i = 0; i < 5; i++) {
    rapidTests.push(testEndpoint(`Rapid Start ${i}`, `${baseUrl}/startStreamen`));
  }
  await Promise.all(rapidTests);
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  const rapidStatus = await getStreamingStatus();
  console.log(`   📊 After rapid starts - streaming status: ${rapidStatus}`);
  
  // Clean up - stop the stream
  await testEndpoint('Cleanup Stop', `${baseUrl}/stopStreamen`);
  await new Promise(resolve => setTimeout(resolve, 500));
  const finalStatus = await getStreamingStatus();
  console.log(`   📊 Final status: ${finalStatus}`);
  
  console.log('   🎯 Streaming state change tests completed!');
}

async function runTests() {
  console.log('🧪 Testing OBS Web Mock System');
  console.log('================================\n');
  
  // Test basic connectivity
  console.log('📡 Testing Basic Connectivity:');
  await testEndpoint('Config API', `${baseUrl}/config`);
  await testEndpoint('Server Status', `${baseUrl}/getStatus`);
  console.log('');
  
  // Test camera operations
  console.log('📹 Testing Camera Operations:');
  await testEndpoint('Camera Status', `${baseUrl}/getCameraStatus`);
  await testEndpoint('Turn On Cameras', `${baseUrl}/camerasOn`);
  await testEndpoint('Turn Off Cameras', `${baseUrl}/camerasOff`);
  console.log('');
  
  // Test streamer operations
  console.log('📺 Testing Streamer Operations:');
  await testEndpoint('Stream Status', `${baseUrl}/streamStatus`);
  await testEndpoint('Record Status', `${baseUrl}/recordStatus`);
  await testEndpoint('Start Stream', `${baseUrl}/startStreamen`);
  await testEndpoint('Stop Stream', `${baseUrl}/stopStreamen`);
  await testEndpoint('Start Recording', `${baseUrl}/startRecording`);
  await testEndpoint('Stop Recording', `${baseUrl}/stopRecording`);
  console.log('');
  
  // Test streaming state changes
  console.log('🔄 Testing Streaming State Changes:');
  await testStreamingStateChanges();
  console.log('');
  
  // Test ATEM operations (via WebSocket would be tested in browser)
  console.log('🎛️  ATEM Operations:');
  console.log('   Note: ATEM operations are tested via WebSocket in the browser');
  console.log('   Open http://localhost:8081 to test ATEM controls');
  console.log('');
  
  // Test admin panel
  console.log('⚙️  Admin Panel:');
  await testEndpoint('Admin Panel', `${baseUrl}/admin.html`);
  console.log('');
  
  console.log('🎉 Mock testing completed!');
  console.log('\n📱 Open these URLs in your browser:');
  console.log('   Main App:     http://localhost:8081');
  console.log('   Admin Panel:  http://localhost:8081/admin.html');
  console.log('   Test Dashboard: http://localhost:8081/test.html');
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
    console.log('✅ Server is running, starting tests...\n');
    await runTests();
  } else {
    console.log('❌ Server is not running!');
    console.log('   Please start the server with: node src/server.js --test');
    process.exit(1);
  }
}

main().catch(console.error);
