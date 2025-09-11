#!/bin/bash

echo "🚀 Starting OBS Web Test Environment"
echo "====================================="

# Check if port 8081 is already in use
if lsof -i :8081 > /dev/null 2>&1; then
    echo "⚠️  Port 8081 is already in use. Stopping existing processes..."
    lsof -i :8081 | awk 'NR>1 {print $2}' | xargs kill -9 2>/dev/null || true
    sleep 2
fi

# Start the server in test mode
echo "📡 Starting server in test mode..."
node src/server.js --test &
SERVER_PID=$!

# Wait for server to start
echo "⏳ Waiting for server to start..."
sleep 3

# Check if server is running
if curl -s http://localhost:8081/config > /dev/null; then
    echo "✅ Server is running successfully!"
    echo ""
    echo "🌐 Available URLs:"
    echo "   Main App:     http://localhost:8081"
    echo "   Admin Panel:  http://localhost:8081/admin.html"
    echo "   Test Page:    http://localhost:8081/test.html"
    echo "   Config API:   http://localhost:8081/config"
    echo ""
    echo "📝 To stop the server, run: kill $SERVER_PID"
    echo "   Or press Ctrl+C in the terminal where the server is running"
    echo ""
    echo "🔧 Server is running in test mode with host: 0.0.0.0:8081"
else
    echo "❌ Failed to start server. Check the logs above."
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi
