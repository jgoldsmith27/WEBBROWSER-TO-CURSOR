// This is a simple wrapper to start the console server
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

console.log('Starting Browser Console Capture Server...');

// Check if server is already running
function checkServerRunning(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}`, (res) => {
      // Server is running
      resolve(true);
    });
    
    req.on('error', (err) => {
      // Server is not running
      resolve(false);
    });
    
    // Set a timeout
    req.setTimeout(1000, () => {
      req.abort();
      resolve(false);
    });
  });
}

// Start the server
async function startServer() {
  const port = 3000; // Default port
  
  // Check if server is already running
  const isRunning = await checkServerRunning(port);
  
  if (isRunning) {
    console.log(`
=======================================================
✅ Server is already running on port ${port}
=======================================================
    `);
    return;
  }
  
  // Path to the server directory
  const serverDir = path.join(__dirname, 'cursor-console-server');
  const serverScript = path.join(serverDir, 'index.js');
  
  // Spawn the server process
  const server = spawn('node', [serverScript], {
    cwd: serverDir,
    stdio: 'inherit' // Pipe the child process's stdio to the parent
  });
  
  // Handle server process events
  server.on('error', (err) => {
    console.error('Failed to start server:', err);
  });
  
  server.on('exit', (code, signal) => {
    if (code !== 0) {
      console.error(`Server process exited with code ${code}`);
    }
    if (signal) {
      console.error(`Server process was killed with signal ${signal}`);
    }
  });
  
  // Handle process termination
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    server.kill('SIGINT');
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    server.kill('SIGTERM');
    process.exit(0);
  });
}

// Start the server
startServer(); 