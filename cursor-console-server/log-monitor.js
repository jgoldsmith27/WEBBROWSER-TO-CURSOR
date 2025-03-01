const WebSocket = require('ws');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  underscore: '\x1b[4m',
  blink: '\x1b[5m',
  reverse: '\x1b[7m',
  hidden: '\x1b[8m',
  
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m'
};

// Create WebSocket connection
const ws = new WebSocket('ws://localhost:3000?clientType=viewer');

// Connection opened
ws.on('open', function() {
  console.log(colors.green + 'Connected to server as viewer' + colors.reset);
  
  // Request status
  ws.send(JSON.stringify({
    type: 'request_status'
  }));
  
  console.log('Sent status request');
  
  // Keep the connection open to receive logs
  console.log('Waiting for logs...');
  console.log('Press Ctrl+C to exit');
});

// Function to format log messages based on type
function formatLogMessage(log) {
  const timestamp = new Date(log.timestamp).toLocaleTimeString();
  const prefix = `[${timestamp}] [${log.type.toUpperCase()}]`;
  
  switch(log.type) {
    case 'error':
      return colors.red + prefix + ' ' + log.message + colors.reset;
    case 'warn':
      return colors.yellow + prefix + ' ' + log.message + colors.reset;
    case 'info':
      return colors.blue + prefix + ' ' + log.message + colors.reset;
    case 'debug':
      return colors.dim + prefix + ' ' + log.message + colors.reset;
    case 'uncaught-exception':
      return colors.bgRed + colors.white + prefix + ' UNCAUGHT EXCEPTION: ' + log.message + colors.reset;
    case 'unhandled-rejection':
      return colors.bgMagenta + colors.white + prefix + ' UNHANDLED REJECTION: ' + log.message + colors.reset;
    case 'trace':
      return colors.cyan + prefix + ' TRACE: ' + log.message + colors.reset;
    case 'assert':
      return colors.magenta + prefix + ' ASSERTION: ' + log.message + colors.reset;
    default:
      return prefix + ' ' + log.message;
  }
}

// Listen for messages
ws.on('message', function(data) {
  try {
    const message = JSON.parse(data);
    
    if (message.type === 'welcome') {
      console.log(colors.green + 'Received welcome message: ' + message.message + colors.reset);
    } else if (message.type === 'status_update') {
      console.log('\n=== SERVER STATUS ===');
      console.log(`Browser clients: ${message.browserClients}`);
      console.log(`Cursor clients: ${message.cursorClients}`);
      console.log(`Viewer clients: ${message.viewerClients}`);
      console.log(`Server status: ${message.serverStatus}`);
      console.log(`Uptime: ${message.uptime} seconds`);
      console.log(`Timestamp: ${message.timestamp}`);
      console.log('====================\n');
    } else if (message.type === 'console_log') {
      const log = message.data;
      console.log(formatLogMessage(log));
      
      // For errors and exceptions, also show the stack trace if available
      if ((log.type === 'error' || log.type === 'uncaught-exception' || log.type === 'unhandled-rejection') && log.stackTrace) {
        console.log(colors.dim + log.stackTrace + colors.reset);
      }
      
      // Show URL for context
      console.log(colors.dim + `URL: ${log.url}` + colors.reset);
      console.log(''); // Empty line for better readability
    } else if (message.type === 'logs') {
      console.log(`\nReceived ${message.logs.length} existing logs`);
      
      if (message.logs.length > 0) {
        message.logs.forEach(log => {
          console.log(formatLogMessage(log));
          
          // For errors and exceptions, also show the stack trace if available
          if ((log.type === 'error' || log.type === 'uncaught-exception' || log.type === 'unhandled-rejection') && log.stackTrace) {
            console.log(colors.dim + log.stackTrace + colors.reset);
          }
          
          // Show URL for context
          console.log(colors.dim + `URL: ${log.url}` + colors.reset);
          console.log(''); // Empty line for better readability
        });
      }
    } else if (message.type === 'tabs_update') {
      console.log(`\nReceived tabs update with ${message.tabs ? message.tabs.length : 0} tabs`);
      
      if (message.tabs && message.tabs.length > 0) {
        console.log('\n=== TABS ===');
        message.tabs.forEach(tab => {
          console.log(`ID: ${tab.id}, Title: ${tab.title.substring(0, 30)}${tab.title.length > 30 ? '...' : ''}`);
          console.log(`URL: ${tab.url.substring(0, 50)}${tab.url.length > 50 ? '...' : ''}`);
          console.log(`Tracked: ${tab.isTracked ? 'Yes' : 'No'}`);
          console.log('------------');
        });
      }
    } else {
      console.log('Received message:', message.type);
    }
  } catch (e) {
    console.log('Received non-JSON message:', data);
  }
});

// Connection error
ws.on('error', function(error) {
  console.error(colors.red + 'WebSocket error: ' + error + colors.reset);
});

// Connection closed
ws.on('close', function(code, reason) {
  console.log(colors.yellow + `Connection closed: ${code} - ${reason}` + colors.reset);
  process.exit(0);
});

// Handle Ctrl+C
process.on('SIGINT', function() {
  console.log(colors.yellow + 'Closing connection...' + colors.reset);
  ws.close();
  process.exit(0);
}); 