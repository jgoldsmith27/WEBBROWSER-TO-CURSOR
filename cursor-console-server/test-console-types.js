const WebSocket = require('ws');

// Create WebSocket connection
const ws = new WebSocket('ws://localhost:3000?clientType=browser');

// Connection opened
ws.on('open', function() {
  console.log('Connected to server as browser client');
  
  // Send various types of console logs
  sendTestLogs();
  
  // Keep the connection open for a few seconds
  setTimeout(() => {
    ws.close();
    console.log('Connection closed');
    process.exit(0);
  }, 5000);
});

// Function to send test logs
function sendTestLogs() {
  // Regular log
  sendLog('log', 'This is a regular log message');
  
  // Error
  sendLog('error', 'This is an error message');
  
  // Warning
  sendLog('warn', 'This is a warning message');
  
  // Info
  sendLog('info', 'This is an info message');
  
  // Debug
  sendLog('debug', 'This is a debug message');
  
  // Trace
  sendLog('trace', 'This is a trace message');
  
  // Assert
  sendLog('assert', 'This is an assertion message');
  
  // Object with circular reference
  const circularObj = { name: 'Circular Object' };
  circularObj.self = circularObj;
  sendLog('log', 'Object with circular reference:', circularObj);
  
  // Error object
  const error = new Error('This is an Error object');
  sendLog('error', 'Error object:', error);
  
  // Uncaught exception
  sendLog('uncaught-exception', {
    message: 'Uncaught SyntaxError: Unexpected token',
    filename: 'test-script.js',
    lineno: 42,
    colno: 10,
    error: new SyntaxError('Unexpected token')
  });
  
  // Unhandled promise rejection
  sendLog('unhandled-rejection', {
    reason: new Error('Promise was rejected'),
    promise: 'Promise rejection'
  });
  
  // Console table
  sendLog('table', [
    { name: 'John', age: 30 },
    { name: 'Jane', age: 25 }
  ]);
  
  console.log('Sent all test logs');
}

// Function to send a log to the server
function sendLog(type, ...args) {
  try {
    // Convert arguments to array and handle circular references
    const serializedArgs = args.map(arg => {
      try {
        if (typeof arg === 'object' && arg !== null) {
          if (arg instanceof Error) {
            return `${arg.name}: ${arg.message}\n${arg.stack || ''}`;
          }
          return JSON.stringify(arg, (key, value) => {
            if (key === 'self') return '[Circular]';
            if (value instanceof Error) {
              return {
                name: value.name,
                message: value.message,
                stack: value.stack
              };
            }
            return value;
          }, 2);
        }
        return String(arg);
      } catch (e) {
        return `[Object with circular reference or non-serializable content]`;
      }
    });

    // Create log entry
    const logEntry = {
      type,
      timestamp: new Date().toISOString(),
      message: serializedArgs.join(' '),
      stackTrace: new Error().stack,
      url: 'test-console-types://test',
      tabId: 999
    };

    // Send to server
    ws.send(JSON.stringify({
      type: 'console_log',
      data: logEntry
    }));
    
    console.log(`Sent ${type} message to server`);
  } catch (error) {
    console.error('Error sending log:', error);
  }
}

// Listen for messages
ws.on('message', function(data) {
  try {
    const message = JSON.parse(data);
    console.log('Received message:', message.type);
  } catch (e) {
    console.log('Received non-JSON message:', data);
  }
});

// Connection error
ws.on('error', function(error) {
  console.error('WebSocket error:', error);
  process.exit(1);
});

// Connection closed
ws.on('close', function(code, reason) {
  console.log(`Connection closed: ${code} - ${reason}`);
  process.exit(0);
});

console.log('Connecting to WebSocket server...'); 