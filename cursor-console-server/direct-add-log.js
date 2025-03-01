const http = require('http');
const WebSocket = require('ws');

// Create a test log
const testLog = {
  type: 'log',
  timestamp: new Date().toISOString(),
  message: 'This is a direct test log message',
  stackTrace: 'Direct test stack trace',
  url: 'direct-test://test',
  tabId: 888
};

// Function to make a GET request to the API
function makeApiRequest(endpoint) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: endpoint,
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve(jsonData);
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error.message}`));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(new Error(`Request failed: ${error.message}`));
    });
    
    req.end();
  });
}

// Connect to the server and directly call handleConsoleLog
async function directAddLog() {
  return new Promise((resolve, reject) => {
    // Connect to the server
    const ws = new WebSocket('ws://localhost:3000?clientType=browser');
    
    ws.on('open', () => {
      console.log('Connected to server as browser client');
      
      // Send a console_log message
      const message = {
        type: 'console_log',
        data: testLog
      };
      
      ws.send(JSON.stringify(message));
      console.log('Sent direct console_log message');
      
      // Wait a moment for the server to process
      setTimeout(() => {
        ws.close();
        console.log('Connection closed');
        resolve();
      }, 2000);
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      reject(error);
    });
  });
}

// Check if the log was stored
async function checkLogs() {
  try {
    console.log('Checking logs endpoint...');
    const logsData = await makeApiRequest('/api/logs');
    console.log('Logs response:', JSON.stringify(logsData, null, 2));
    
    if (logsData.logs && logsData.logs.length > 0) {
      console.log('\nFound logs:');
      logsData.logs.forEach((log, index) => {
        console.log(`\nLog #${index + 1}:`);
        console.log(`Type: ${log.type}`);
        console.log(`Message: ${log.message}`);
        console.log(`URL: ${log.url}`);
      });
    } else {
      console.log('No logs found');
    }
    
    return logsData;
  } catch (error) {
    console.error('Error checking logs:', error.message);
  }
}

// Run the test
async function runTest() {
  try {
    // First check current logs
    console.log('Checking logs before adding...');
    await checkLogs();
    
    // Add a log directly
    console.log('\nAdding a direct log...');
    await directAddLog();
    
    // Check logs again
    console.log('\nChecking logs after adding...');
    await checkLogs();
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

runTest(); 