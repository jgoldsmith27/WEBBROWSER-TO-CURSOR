const ConsoleServer = require('./server');

// Get port from environment variable or use default
const port = process.env.PORT || 3000;

// Create and start server
const server = new ConsoleServer({
  port,
  maxLogs: 1000
});

// Handle process termination
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  await server.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down server...');
  await server.stop();
  process.exit(0);
});

// Start server
server.start().then((port) => {
  console.log(`
=======================================================
🚀 Cursor Console Server is running!

Server URL: http://localhost:${port}
WebSocket URL: ws://localhost:${port}

Browser clients should connect to:
ws://localhost:${port}?clientType=browser

Cursor IDE clients should connect to:
ws://localhost:${port}?clientType=cursor

API Endpoints:
- GET /api/status - Server status
- GET /api/logs - All captured logs
=======================================================
`);
}); 