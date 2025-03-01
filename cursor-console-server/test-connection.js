const WebSocket = require('ws');

// Create WebSocket connection
const ws = new WebSocket('ws://localhost:3000?clientType=browser');

// Connection opened
ws.on('open', function() {
  console.log('Connected to server');
  
  // Send a test tab update
  const tabsMessage = {
    type: 'tabs_update',
    tabs: [
      {
        id: 1,
        title: 'Test Tab',
        url: 'https://example.com',
        favIconUrl: 'https://example.com/favicon.ico',
        isTracked: true
      }
    ]
  };
  
  ws.send(JSON.stringify(tabsMessage));
  console.log('Sent tabs update');
  
  // Send a test log message
  const logMessage = {
    type: 'console_log',
    data: {
      type: 'log',
      timestamp: new Date().toISOString(),
      message: 'This is a test log message from the test script',
      stackTrace: 'Test stack trace',
      url: 'https://example.com',
      tabId: 1
    }
  };
  
  ws.send(JSON.stringify(logMessage));
  console.log('Sent log message');
  
  // Keep the connection open for a few seconds to receive responses
  setTimeout(() => {
    ws.close();
    console.log('Connection closed');
    process.exit(0);
  }, 5000);
});

// Listen for messages
ws.on('message', function(data) {
  try {
    const message = JSON.parse(data);
    console.log('Received message:', message.type);
    console.log(JSON.stringify(message, null, 2));
  } catch (e) {
    console.log('Received non-JSON message:', data);
  }
});

// Connection error
ws.on('error', function(error) {
  console.error('WebSocket error:', error);
});

// Connection closed
ws.on('close', function(code, reason) {
  console.log(`Connection closed: ${code} - ${reason}`);
});

console.log('Connecting to WebSocket server...'); 