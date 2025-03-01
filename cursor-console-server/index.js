const ConsoleServer = require('./server');
const fs = require('fs');
const path = require('path');
const net = require('net');

// Function to find an available port
function findAvailablePort(startPort, callback) {
  const server = net.createServer();
  server.listen(startPort, () => {
    const port = server.address().port;
    server.close(() => callback(port));
  });
  
  server.on('error', () => {
    // Port is in use, try the next one
    findAvailablePort(startPort + 1, callback);
  });
}

// Use a port that's unlikely to be in use
const PORT = process.env.PORT || 3000;

// Create console server - this will create its own HTTP and WebSocket servers
const consoleServer = new ConsoleServer({
  port: PORT,
  maxLogs: 1000
});

// Start the server
consoleServer.start();

console.log(`
=======================================================
🚀 Browser Console Capture Server running on port ${PORT}
=======================================================
`);

// Handle process termination
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  consoleServer.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  consoleServer.stop();
  process.exit(0);
}); 