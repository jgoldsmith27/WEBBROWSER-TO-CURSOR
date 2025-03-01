const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;

const server = http.createServer((req, res) => {
  console.log(`Request received: ${req.url}`);
  
  // Serve the test-local.html file for any request
  const filePath = path.join(__dirname, 'test-local.html');
  
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500);
      res.end(`Error loading file: ${err.message}`);
      return;
    }
    
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`
=======================================================
🌐 Test server running at http://localhost:${PORT}
=======================================================
  `);
}); 