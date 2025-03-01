const http = require('http');

// Make a request to the server's API endpoint for logs
http.get('http://localhost:3000/api/logs', (res) => {
  let data = '';
  
  // A chunk of data has been received
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  // The whole response has been received
  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      
      console.log(`Total logs: ${response.logs ? response.logs.length : 0}`);
      
      if (response.logs && response.logs.length > 0) {
        console.log('\nMost recent logs:');
        
        // Show the 5 most recent logs
        const recentLogs = response.logs.slice(-5);
        
        recentLogs.forEach((log, index) => {
          console.log(`\nLog #${response.logs.length - 5 + index + 1}:`);
          console.log(`Type: ${log.type}`);
          console.log(`Message: ${log.message}`);
          console.log(`URL: ${log.url}`);
          console.log(`Tab ID: ${log.tabId}`);
          console.log(`Timestamp: ${log.timestamp}`);
        });
      } else {
        console.log('No logs found');
      }
    } catch (error) {
      console.error('Error parsing response:', error);
      console.log('Raw response:', data);
    }
  });
}).on('error', (error) => {
  console.error('Error making request:', error);
}); 