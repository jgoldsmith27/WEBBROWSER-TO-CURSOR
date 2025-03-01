const http = require('http');

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

// Test the status endpoint
async function testStatusEndpoint() {
  try {
    console.log('Testing /api/status endpoint...');
    const statusData = await makeApiRequest('/api/status');
    console.log('Status response:', JSON.stringify(statusData, null, 2));
    return statusData;
  } catch (error) {
    console.error('Error testing status endpoint:', error.message);
  }
}

// Test the logs endpoint
async function testLogsEndpoint() {
  try {
    console.log('Testing /api/logs endpoint...');
    const logsData = await makeApiRequest('/api/logs');
    console.log('Logs response:', JSON.stringify(logsData, null, 2));
    return logsData;
  } catch (error) {
    console.error('Error testing logs endpoint:', error.message);
  }
}

// Run the tests
async function runTests() {
  const statusData = await testStatusEndpoint();
  const logsData = await testLogsEndpoint();
  
  if (statusData && logsData) {
    console.log('\nSummary:');
    console.log(`- Server status: ${statusData.status}`);
    console.log(`- Browser clients: ${statusData.browserClients}`);
    console.log(`- Cursor clients: ${statusData.cursorClients}`);
    console.log(`- Viewer clients: ${statusData.viewerClients}`);
    console.log(`- Logs count from status: ${statusData.logs}`);
    console.log(`- Logs count from logs endpoint: ${logsData.logs ? logsData.logs.length : 0}`);
    
    if (statusData.logs !== (logsData.logs ? logsData.logs.length : 0)) {
      console.log('\nWARNING: Log count mismatch between status and logs endpoints!');
    }
  }
}

runTests(); 