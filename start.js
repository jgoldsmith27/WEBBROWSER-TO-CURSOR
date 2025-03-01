#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Paths to components
const serverPath = path.join(__dirname, 'cursor-console-server');

// Check if server directory exists
if (!fs.existsSync(serverPath)) {
  console.error(`Server directory not found: ${serverPath}`);
  process.exit(1);
}

// Start server
console.log('Starting Console Server...');
const server = spawn('npm', ['start'], {
  cwd: serverPath,
  stdio: 'inherit',
  shell: true
});

// Handle server process events
server.on('error', (error) => {
  console.error(`Failed to start server: ${error.message}`);
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

// Print instructions
console.log(`
=======================================================
🚀 Browser Console to Cursor Bridge

Server is running. Now you need to:

1. Install the browser extension:
   - Open Chrome and go to chrome://extensions/
   - Enable "Developer mode"
   - Click "Load unpacked" and select the browser-console-capture directory

2. Install the Cursor extension:
   - Copy the cursor-extension directory to ~/.vscode/extensions/
   - Restart Cursor IDE

3. Connect the components:
   - Click the browser extension icon and connect to the server
   - In Cursor IDE, click the Browser Console icon in the Activity Bar
   - Click "Connect" to connect to the server

4. Navigate to your website (e.g., https://lovable.dev/projects/05c5e171-ffa1-4ae8-95dd-d33e68ee88b5)
   and console logs will be captured and displayed in Cursor IDE

Press Ctrl+C to stop the server
=======================================================
`); 