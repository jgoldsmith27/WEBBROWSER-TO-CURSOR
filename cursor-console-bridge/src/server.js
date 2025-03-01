const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const os = require('os');
const pty = require('node-pty');
const path = require('path');

class ConsoleServer {
  constructor(options = {}) {
    this.port = options.port || 3000;
    this.terminalRows = options.rows || 24;
    this.terminalCols = options.cols || 80;
    this.shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
    this.clients = new Set();
    this.terminals = new Map();
    this.setupServer();
  }

  setupServer() {
    // Create Express app
    this.app = express();
    this.server = http.createServer(this.app);
    
    // Serve static files
    this.app.use(express.static(path.join(__dirname, '../public')));
    
    // Setup WebSocket server
    this.wss = new WebSocket.Server({ server: this.server });
    
    // Handle WebSocket connections
    this.wss.on('connection', (ws) => {
      console.log('Client connected');
      this.handleConnection(ws);
    });
    
    // API routes
    this.app.get('/api/status', (req, res) => {
      res.json({
        status: 'running',
        clients: this.clients.size,
        terminals: this.terminals.size
      });
    });
  }

  handleConnection(ws) {
    // Add client to the set
    this.clients.add(ws);
    
    // Create a new terminal instance for this client
    const terminal = pty.spawn(this.shell, [], {
      name: 'xterm-color',
      cols: this.terminalCols,
      rows: this.terminalRows,
      cwd: process.env.HOME,
      env: process.env
    });
    
    // Generate a unique ID for this terminal
    const terminalId = Date.now().toString();
    this.terminals.set(terminalId, terminal);
    
    // Send terminal ID to the client
    ws.send(JSON.stringify({ type: 'terminal_id', id: terminalId }));
    
    // Forward terminal output to the client
    terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'terminal_output', data }));
      }
    });
    
    // Handle client messages
    ws.on('message', (message) => {
      try {
        const parsedMessage = JSON.parse(message);
        
        if (parsedMessage.type === 'terminal_input') {
          // Forward client input to the terminal
          terminal.write(parsedMessage.data);
        } else if (parsedMessage.type === 'resize_terminal') {
          // Resize the terminal
          terminal.resize(parsedMessage.cols, parsedMessage.rows);
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    });
    
    // Handle client disconnection
    ws.on('close', () => {
      console.log('Client disconnected');
      this.clients.delete(ws);
      
      // Kill the terminal process
      if (this.terminals.has(terminalId)) {
        const term = this.terminals.get(terminalId);
        term.kill();
        this.terminals.delete(terminalId);
      }
    });
  }

  start() {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`Console Bridge Server running on http://localhost:${this.port}`);
        resolve(this.port);
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      // Kill all terminal processes
      for (const terminal of this.terminals.values()) {
        terminal.kill();
      }
      this.terminals.clear();
      
      // Close all WebSocket connections
      for (const client of this.clients) {
        client.terminate();
      }
      this.clients.clear();
      
      // Close the server
      this.server.close(() => {
        console.log('Console Bridge Server stopped');
        resolve();
      });
    });
  }
}

module.exports = ConsoleServer;
