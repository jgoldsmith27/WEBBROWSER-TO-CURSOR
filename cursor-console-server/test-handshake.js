const WebSocket = require('ws');

// Generate a unique client ID
function generateClientId() {
  return 'test-client-' + Math.random().toString(36).substring(2, 15);
}

// Connect to the server and perform handshake
async function testHandshake() {
  return new Promise((resolve, reject) => {
    console.log('Connecting to server...');
    
    // Create WebSocket connection
    const ws = new WebSocket('ws://localhost:3000?clientType=browser');
    const clientId = generateClientId();
    let handshakeComplete = false;
    let testLogSent = false;
    
    // Connection opened
    ws.on('open', () => {
      console.log('Connected to server as browser client');
      
      // If the server doesn't send a handshake request, we'll initiate one ourselves after a delay
      setTimeout(() => {
        if (!handshakeComplete) {
          console.log('No handshake request received from server, sending a test log directly');
          
          // Send a test log directly
          const testLog = {
            type: 'console_log',
            data: {
              type: 'log',
              timestamp: new Date().toISOString(),
              message: 'Test log from handshake test script (direct)',
              stackTrace: 'Test stack trace',
              url: 'test-script://handshake-test-direct',
              tabId: -1
            }
          };
          
          ws.send(JSON.stringify(testLog));
          console.log('Sent direct test log to server');
          testLogSent = true;
          
          // Wait a bit and then check if the log was stored
          setTimeout(() => {
            checkLogs().then(() => {
              ws.close();
              resolve({ success: true, handshakeComplete: false, testLogSent: true });
            });
          }, 2000);
        }
      }, 3000);
    });
    
    // Listen for messages
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        console.log('Received message:', message.type);
        console.log('Message content:', JSON.stringify(message).substring(0, 200));
        
        // Handle handshake request
        if (message.type === 'handshake_request') {
          console.log('Received handshake request from server');
          
          // Send handshake response
          const handshakeResponse = {
            type: 'handshake_response',
            clientId: clientId,
            clientVersion: '1.0',
            timestamp: new Date().toISOString(),
            capabilities: {
              logCapture: true,
              tabTracking: true
            }
          };
          
          ws.send(JSON.stringify(handshakeResponse));
          console.log('Sent handshake response to server');
          handshakeComplete = true;
        }
        // Handle test log request
        else if (message.type === 'test_log_request') {
          console.log('Received test log request from server');
          
          // Send a test log
          const testLog = {
            type: 'console_log',
            data: {
              type: 'log',
              timestamp: new Date().toISOString(),
              message: 'Test log from handshake test script',
              stackTrace: 'Test stack trace',
              url: 'test-script://handshake-test',
              tabId: -1
            }
          };
          
          ws.send(JSON.stringify(testLog));
          console.log('Sent test log to server');
          
          // Send test log response
          const testLogResponse = {
            type: 'test_log_response',
            requestId: message.requestId,
            success: true
          };
          
          ws.send(JSON.stringify(testLogResponse));
          console.log('Sent test log response to server');
          testLogSent = true;
          
          // Wait a bit and then check if the log was stored
          setTimeout(() => {
            checkLogs().then(() => {
              ws.close();
              resolve({ success: true, handshakeComplete, testLogSent });
            });
          }, 2000);
        }
        // Handle welcome message (old protocol)
        else if (message.type === 'welcome') {
          console.log('Received welcome message (old protocol)');
          
          // Send a test log directly
          const testLog = {
            type: 'console_log',
            data: {
              type: 'log',
              timestamp: new Date().toISOString(),
              message: 'Test log from handshake test script (after welcome)',
              stackTrace: 'Test stack trace',
              url: 'test-script://handshake-test-welcome',
              tabId: -1
            }
          };
          
          ws.send(JSON.stringify(testLog));
          console.log('Sent test log to server after welcome');
          testLogSent = true;
          
          // Wait a bit and then check if the log was stored
          setTimeout(() => {
            checkLogs().then(() => {
              ws.close();
              resolve({ success: true, handshakeComplete: false, testLogSent: true });
            });
          }, 2000);
        }
      } catch (e) {
        console.log('Received non-JSON message:', data);
      }
    });
    
    // Connection error
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      reject(error);
    });
    
    // Connection closed
    ws.on('close', (code, reason) => {
      console.log(`Connection closed: ${code} - ${reason}`);
      if (!testLogSent) {
        reject(new Error('Connection closed before test log was sent'));
      }
    });
    
    // Set a timeout for the entire test
    setTimeout(() => {
      if (!testLogSent) {
        ws.close();
        reject(new Error('Test timed out'));
      }
    }, 10000);
  });
}

// Function to check if logs were stored
async function checkLogs() {
  const http = require('http');
  
  return new Promise((resolve, reject) => {
    console.log('Checking if logs were stored...');
    
    http.get('http://localhost:3000/api/logs', (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          
          console.log(`Total logs: ${response.logs ? response.logs.length : 0}`);
          
          if (response.logs && response.logs.length > 0) {
            console.log('\nFound logs:');
            response.logs.forEach((log, index) => {
              console.log(`\nLog #${index + 1}:`);
              console.log(`Type: ${log.type}`);
              console.log(`Message: ${log.message}`);
              console.log(`URL: ${log.url}`);
            });
            resolve(true);
          } else {
            console.log('No logs found');
            resolve(false);
          }
        } catch (error) {
          console.error('Error parsing response:', error);
          reject(error);
        }
      });
    }).on('error', (error) => {
      console.error('Error making request:', error);
      reject(error);
    });
  });
}

// Run the test
async function runTest() {
  try {
    const result = await testHandshake();
    console.log('Test completed:', result);
  } catch (error) {
    console.error('Test failed:', error);
  }
}

runTest(); 