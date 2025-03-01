const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

class ConsoleServer {
  constructor(options = {}) {
    this.port = options.port || 3000;
    this.maxLogs = options.maxLogs || 1000;
    this.logs = [];
    this.browserClients = new Set();
    this.cursorClients = new Set();
    this.viewerClients = new Set();
    this.pingInterval = null;
    this.setupServer();
  }

  setupServer() {
    // Create Express app
    this.app = express();
    this.server = http.createServer(this.app);
    
    // Serve static files
    this.app.use(express.static(path.join(__dirname, 'public')));
    
    // Add JSON body parser
    this.app.use(express.json());
    
    // Setup WebSocket server
    this.wss = new WebSocket.Server({ 
      server: this.server,
      // Increase timeout values
      clientTracking: true,
      perMessageDeflate: {
        zlibDeflateOptions: {
          // See zlib defaults.
          chunkSize: 1024,
          memLevel: 7,
          level: 3
        },
        zlibInflateOptions: {
          chunkSize: 10 * 1024
        },
        // Other options settable:
        concurrencyLimit: 10, // Limits zlib concurrency for perf.
        threshold: 1024 // Size (in bytes) below which messages should not be compressed.
      }
    });
    
    // Handle WebSocket connections
    this.wss.on('connection', (ws, req) => {
      const clientType = new URL(req.url, 'http://localhost').searchParams.get('clientType');
      
      if (clientType === 'browser') {
        // Check if there's already a browser client connected
        const existingBrowserClients = [...this.wss.clients].filter(client => 
          client.clientType === 'browser' && client !== ws && client.readyState === WebSocket.OPEN
        );
        
        // If there's already a browser client connected, close this connection
        if (existingBrowserClients.length > 0) {
          console.log('Another browser client is already connected. Rejecting new connection.');
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Another browser client is already connected'
          }));
          ws.close();
          return;
        }
        
        // Set client type
        ws.clientType = 'browser';
        console.log('Browser client connected');
        
        // Send welcome message
        ws.send(JSON.stringify({
          type: 'welcome',
          message: 'Connected to Cursor Console Server'
        }));
        
        // Request tabs immediately
        ws.send(JSON.stringify({
          type: 'get_tabs'
        }));
      } else if (clientType === 'cursor') {
        this.handleCursorConnection(ws);
      } else if (clientType === 'viewer') {
        this.handleViewerConnection(ws);
      } else {
        // Unknown client type
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Unknown client type. Please specify clientType=browser, clientType=cursor, or clientType=viewer'
        }));
        ws.close();
      }
    });
    
    // Set up ping interval to keep connections alive
    this.pingInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          console.log('Client timed out, terminating connection');
          return ws.terminate();
        }
        
        ws.isAlive = false;
        ws.ping(() => {});
        
        // Also send a ping message that clients can respond to
        try {
          ws.send(JSON.stringify({ type: 'ping' }));
        } catch (e) {
          // Ignore errors
        }
      });
      
      // Send status updates to viewer clients
      this.broadcastStatusToViewers();
    }, 30000); // 30 seconds
    
    // API routes
    this.app.get('/api/status', (req, res) => {
      res.json({
        status: 'running',
        browserClients: this.browserClients.size,
        cursorClients: this.cursorClients.size,
        viewerClients: this.viewerClients.size,
        logs: this.logs.length,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      });
    });
    
    this.app.get('/api/logs', (req, res) => {
      res.json({
        logs: this.logs
      });
    });
    
    // Add endpoint to clear logs
    this.app.post('/api/logs/clear', (req, res) => {
      this.logs = [];
      
      // Notify all clients that logs have been cleared
      this.broadcastToBrowser({
        type: 'logs_cleared'
      });
      
      this.broadcastToCursor({
        type: 'logs_cleared'
      });
      
      this.broadcastToViewers({
        type: 'logs_cleared'
      });
      
      res.json({
        success: true,
        message: 'Logs cleared successfully'
      });
    });
    
    // Add endpoint to get tab tracking settings
    this.app.get('/api/tabs/settings', (req, res) => {
      // Forward the request to all browser clients and wait for the first response
      let hasResponded = false;
      const timeout = setTimeout(() => {
        if (!hasResponded) {
          res.status(408).json({
            success: false,
            message: 'Request timed out. No browser clients responded.'
          });
          hasResponded = true;
        }
      }, 5000); // 5 second timeout
      
      // Create a unique ID for this request
      const requestId = Date.now().toString();
      
      // Set up a one-time handler for the response
      const handleTabSettingsResponse = (message) => {
        if (message.type === 'tab_settings_response' && message.requestId === requestId) {
          if (!hasResponded) {
            clearTimeout(timeout);
            res.json({
              success: true,
              trackingMode: message.trackingMode,
              trackedTabs: message.trackedTabs
            });
            hasResponded = true;
          }
        }
      };
      
      // Register the handler for each browser client
      for (const client of this.browserClients) {
        if (client.readyState === WebSocket.OPEN) {
          // Set up a one-time message handler for this client
          const messageHandler = (data) => {
            try {
              const message = JSON.parse(data);
              handleTabSettingsResponse(message);
            } catch (error) {
              console.error('Error parsing message:', error);
            }
          };
          
          client.once('message', messageHandler);
          
          // Send the request to the client
          client.send(JSON.stringify({
            type: 'get_tab_settings',
            requestId
          }));
          
          // Clean up the handler after timeout
          setTimeout(() => {
            client.removeListener('message', messageHandler);
          }, 5000);
        }
      }
      
      // If no browser clients are connected, return an error
      if (this.browserClients.size === 0) {
        clearTimeout(timeout);
        res.status(503).json({
          success: false,
          message: 'No browser clients connected'
        });
        hasResponded = true;
      }
    });
    
    // Add endpoint to update tab tracking settings
    this.app.post('/api/tabs/settings', (req, res) => {
      const { trackingMode, trackedTabs } = req.body;
      
      // Validate the request
      if (!trackingMode || (trackingMode !== 'all' && trackingMode !== 'selected')) {
        return res.status(400).json({
          success: false,
          message: 'Invalid tracking mode'
        });
      }
      
      // Forward the settings to all browser clients
      this.broadcastToBrowser({
        type: 'update_tab_settings',
        trackingMode,
        trackedTabs
      });
      
      res.json({
        success: true,
        message: 'Tab tracking settings updated'
      });
    });
    
    // Add endpoint to get open tabs
    this.app.get('/api/tabs', (req, res) => {
      // If we have cached tabs and no browser clients are connected, return the cached tabs
      if (this.latestTabs && this.latestTabs.length > 0) {
        console.log('Returning cached tabs:', this.latestTabs.length);
        return res.json({
          success: true,
          tabs: this.latestTabs
        });
      }
      
      // If no browser clients are connected, return an empty array
      if (this.browserClients.size === 0) {
        console.log('No browser clients connected, returning empty tabs array');
        return res.json({
          success: true,
          tabs: []
        });
      }
      
      // Forward the request to all browser clients and wait for the first response
      let hasResponded = false;
      const timeout = setTimeout(() => {
        if (!hasResponded) {
          console.log('Tab request timed out, returning cached or empty tabs');
          // If we have cached tabs, return those instead of an error
          if (this.latestTabs && this.latestTabs.length > 0) {
            res.json({
              success: true,
              tabs: this.latestTabs
            });
          } else {
            res.json({
              success: true,
              tabs: []
            });
          }
          hasResponded = true;
        }
      }, 5000); // 5 second timeout (increased from 3 seconds)
      
      // Create a unique ID for this request
      const requestId = Date.now().toString();
      
      // Set up a one-time handler for the response
      const handleTabsResponse = (message) => {
        if (message.type === 'tabs_response' && message.requestId === requestId) {
          if (!hasResponded) {
            clearTimeout(timeout);
            
            // Store the latest tabs information
            this.latestTabs = message.tabs;
            console.log('Received tabs response with', message.tabs.length, 'tabs');
            
            res.json({
              success: true,
              tabs: message.tabs
            });
            hasResponded = true;
          }
        }
      };
      
      // Register the handler for each browser client
      let clientsRequested = 0;
      for (const client of this.browserClients) {
        if (client.readyState === WebSocket.OPEN) {
          clientsRequested++;
          // Set up a one-time message handler for this client
          const messageHandler = (data) => {
            try {
              const message = JSON.parse(data);
              handleTabsResponse(message);
            } catch (error) {
              console.error('Error parsing message:', error);
            }
          };
          
          client.once('message', messageHandler);
          
          // Send the request to the client
          client.send(JSON.stringify({
            type: 'get_tabs',
            requestId
          }));
          
          // Clean up the handler after timeout
          setTimeout(() => {
            client.removeListener('message', messageHandler);
          }, 5000);
        }
      }
      
      // If no clients were requested, return immediately
      if (clientsRequested === 0) {
        clearTimeout(timeout);
        res.json({
          success: true,
          tabs: this.latestTabs || []
        });
        hasResponded = true;
      }
    });
  }

  handleBrowserConnection(ws) {
    console.log('Browser client connected');
    this.browserClients.add(ws);
    
    // Send welcome message
    ws.send(JSON.stringify({
      type: 'welcome',
      message: 'Welcome to the Cursor Console Server!'
    }));
    
    // Request tabs immediately
    ws.send(JSON.stringify({
      type: 'get_tabs',
      requestId: 'initial'
    }));
    
    // Set up message handler
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        console.log('Received message from browser client:', data.type);
        
        if (data.type === 'console_log') {
          // Handle console log
          const log = data.data;
          this.logs.push(log);
          
          // Forward to all cursor clients
          this.broadcastToCursor({
            type: 'console_log',
            data: log
          });
          
          // Forward to all viewer clients
          this.broadcastToViewers({
            type: 'console_log',
            data: log
          });
        } else if (data.type === 'tabs_response') {
          console.log(`Received tabs response with ${data.tabs.length} tabs, requestId: ${data.requestId}`);
          
          // Log the first tab for debugging
          if (data.tabs.length > 0) {
            console.log('First tab example:', JSON.stringify(data.tabs[0]));
          }
          
          // Store the latest tabs information
          this.latestTabs = data.tabs;
          
          // Forward to all viewer clients
          this.broadcastToViewers({
            type: 'tabs_update',
            tabs: data.tabs
          });
        } else if (data.type === 'tab_settings_response') {
          console.log('Received tab settings response');
          
          // Store the latest tab settings
          this.latestTabSettings = {
            trackingMode: data.trackingMode,
            trackedTabs: data.trackedTabs
          };
          
          // Forward to all viewer clients
          this.broadcastToViewers({
            type: 'tab_settings_update',
            trackingMode: data.trackingMode,
            trackedTabs: data.trackedTabs
          });
        } else if (data.type === 'ping') {
          // Respond to ping
          ws.send(JSON.stringify({ type: 'pong' }));
        } else if (data.type === 'pong') {
          // Ignore pong responses
        } else {
          console.log('Unknown message type from browser client:', data.type);
        }
      } catch (error) {
        console.error('Error processing message from browser client:', error);
      }
    });
    
    // Handle disconnect
    ws.on('close', () => {
      console.log('Browser client disconnected');
      this.browserClients.delete(ws);
      
      // Update status for all viewer clients
      this.broadcastStatusToViewers();
    });
  }

  handleCursorConnection(ws) {
    console.log('Cursor client connected');
    this.cursorClients.add(ws);
    
    // Send welcome message
    ws.send(JSON.stringify({
      type: 'welcome',
      message: 'Connected to Cursor Console Server as Cursor IDE client'
    }));
    
    // Send all existing logs
    ws.send(JSON.stringify({
      type: 'logs',
      data: this.logs
    }));
    
    // Broadcast status update to viewers
    this.broadcastStatusToViewers();
    
    // Handle messages from Cursor
    ws.on('message', (message) => {
      try {
        const parsedMessage = JSON.parse(message);
        
        if (parsedMessage.type === 'clear_logs') {
          // Clear logs
          this.logs = [];
          
          // Notify all clients
          this.broadcastToBrowser({
            type: 'logs_cleared'
          });
          
          this.broadcastToCursor({
            type: 'logs_cleared'
          });
          
          this.broadcastToViewers({
            type: 'logs_cleared'
          });
        } else if (parsedMessage.type === 'ping') {
          // Respond to ping
          ws.send(JSON.stringify({ type: 'pong' }));
        } else if (parsedMessage.type === 'pong') {
          // Client responded to our ping
          ws.isAlive = true;
        }
      } catch (error) {
        console.error('Error processing message from Cursor:', error);
      }
    });
    
    // Handle disconnection
    ws.on('close', () => {
      console.log('Cursor client disconnected');
      this.cursorClients.delete(ws);
      
      // Broadcast status update to viewers
      this.broadcastStatusToViewers();
    });
    
    // Handle errors
    ws.on('error', (error) => {
      console.error('Cursor client error:', error);
      this.cursorClients.delete(ws);
      
      // Broadcast status update to viewers
      this.broadcastStatusToViewers();
    });
  }
  
  // Handle viewer connections (web UI)
  handleViewerConnection(ws) {
    console.log('Viewer client connected');
    this.viewerClients.add(ws);
    
    // Send welcome message
    ws.send(JSON.stringify({
      type: 'welcome',
      message: 'Connected to Cursor Console Server as viewer client'
    }));
    
    // Send all existing logs
    ws.send(JSON.stringify({
      type: 'logs',
      data: this.logs
    }));
    
    // Send current status
    ws.send(JSON.stringify({
      type: 'status_update',
      browserClients: this.browserClients.size,
      cursorClients: this.cursorClients.size,
      viewerClients: this.viewerClients.size,
      logs: this.logs.length,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    }));
    
    // Handle messages from viewer
    ws.on('message', (message) => {
      try {
        const parsedMessage = JSON.parse(message);
        
        if (parsedMessage.type === 'clear_logs') {
          // Clear logs
          this.logs = [];
          
          // Notify all clients
          this.broadcastToBrowser({
            type: 'logs_cleared'
          });
          
          this.broadcastToCursor({
            type: 'logs_cleared'
          });
          
          this.broadcastToViewers({
            type: 'logs_cleared'
          });
        } else if (parsedMessage.type === 'ping') {
          // Respond to ping
          ws.send(JSON.stringify({ type: 'pong' }));
        } else if (parsedMessage.type === 'pong') {
          // Client responded to our ping
          ws.isAlive = true;
        }
      } catch (error) {
        console.error('Error processing message from viewer:', error);
      }
    });
    
    // Handle disconnection
    ws.on('close', () => {
      console.log('Viewer client disconnected');
      this.viewerClients.delete(ws);
    });
    
    // Handle errors
    ws.on('error', (error) => {
      console.error('Viewer client error:', error);
      this.viewerClients.delete(ws);
    });
  }

  addLog(log) {
    // Add log to the logs array
    this.logs.push(log);
    
    // Limit the number of logs
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  broadcastToBrowser(message) {
    const messageString = JSON.stringify(message);
    
    for (const client of this.browserClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageString);
      }
    }
  }

  broadcastToCursor(message) {
    const messageString = JSON.stringify(message);
    
    for (const client of this.cursorClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageString);
      }
    }
  }
  
  broadcastToViewers(message) {
    const messageString = JSON.stringify(message);
    
    for (const client of this.viewerClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageString);
      }
    }
  }
  
  broadcastStatusToViewers() {
    const statusMessage = {
      type: 'status_update',
      browserClients: this.browserClients.size,
      cursorClients: this.cursorClients.size,
      viewerClients: this.viewerClients.size,
      logs: this.logs.length,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
    
    this.broadcastToViewers(statusMessage);
  }

  start() {
    return new Promise((resolve, reject) => {
      // Try to start the server on the specified port
      const serverInstance = this.server.listen(this.port, () => {
        console.log(`Cursor Console Server running on http://localhost:${this.port}`);
        console.log('=======================================================');
        console.log('🚀 Cursor Console Server is running!');
        console.log(`Server URL: http://localhost:${this.port}`);
        console.log(`WebSocket URL: ws://localhost:${this.port}`);
        console.log('Browser clients should connect to:');
        console.log(`ws://localhost:${this.port}?clientType=browser`);
        console.log('Cursor IDE clients should connect to:');
        console.log(`ws://localhost:${this.port}?clientType=cursor`);
        console.log('API Endpoints:');
        console.log('- GET /api/status - Server status');
        console.log('- GET /api/logs - All captured logs');
        console.log('- POST /api/logs/clear - Clear all logs');
        console.log('- GET /api/tabs - Get open tabs');
        console.log('- GET /api/tabs/settings - Get tab tracking settings');
        console.log('- POST /api/tabs/settings - Update tab tracking settings');
        console.log('=======================================================');
        resolve(this.port);
      });

      // Handle server errors
      serverInstance.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`Port ${this.port} is already in use, trying port ${this.port + 1}...`);
          
          // Close the server
          serverInstance.close();
          
          // Try the next port
          this.port += 1;
          
          // Retry with the new port
          this.server.listen(this.port, () => {
            console.log(`Cursor Console Server running on http://localhost:${this.port}`);
            console.log('=======================================================');
            console.log('🚀 Cursor Console Server is running!');
            console.log(`Server URL: http://localhost:${this.port}`);
            console.log(`WebSocket URL: ws://localhost:${this.port}`);
            console.log('Browser clients should connect to:');
            console.log(`ws://localhost:${this.port}?clientType=browser`);
            console.log('Cursor IDE clients should connect to:');
            console.log(`ws://localhost:${this.port}?clientType=cursor`);
            console.log('API Endpoints:');
            console.log('- GET /api/status - Server status');
            console.log('- GET /api/logs - All captured logs');
            console.log('- POST /api/logs/clear - Clear all logs');
            console.log('- GET /api/tabs - Get open tabs');
            console.log('- GET /api/tabs/settings - Get tab tracking settings');
            console.log('- POST /api/tabs/settings - Update tab tracking settings');
            console.log('=======================================================');
            resolve(this.port);
          }).on('error', (err) => {
            // If we still have an error, reject the promise
            reject(err);
          });
        } else {
          // For other errors, reject the promise
          reject(err);
        }
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      // Clear the ping interval
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }
      
      // Close all WebSocket connections
      for (const client of this.browserClients) {
        client.terminate();
      }
      this.browserClients.clear();
      
      for (const client of this.cursorClients) {
        client.terminate();
      }
      this.cursorClients.clear();
      
      for (const client of this.viewerClients) {
        client.terminate();
      }
      this.viewerClients.clear();
      
      // Close the server
      this.server.close(() => {
        console.log('Cursor Console Server stopped');
        resolve();
      });
    });
  }
}

module.exports = ConsoleServer; 