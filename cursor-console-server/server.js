const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

class ConsoleServer {
  constructor(options = {}) {
    this.port = options.port || 49152;
    this.maxLogs = options.maxLogs || 1000;
    this.logs = [];
    this.browserClients = new Set();
    this.cursorClients = new Set();
    this.viewerClients = new Set();
    this.pingInterval = null;
    this.serverStatus = 'online';
    this.observers = new Set();
    this.latestTabs = [];
    this.startTime = Date.now();
    
    // Enhanced logging
    this.verbose = true; // Set to true for detailed logging
    
    this.setupServer();
    
    // Log initial state
    console.log(`[SERVER] Server initialized with verbose logging: ${this.verbose}`);
    console.log(`[SERVER] Max logs: ${this.maxLogs}`);
  }

  // Add a log to the logs array
  addLog(log) {
    console.log(`[ADD LOG] Adding log to logs array:`, JSON.stringify(log).substring(0, 200));
    
    // Validate the log object
    if (!log) {
      console.error('[ADD LOG] Error: Attempted to add null or undefined log');
      return;
    }
    
    // Ensure the log has required fields
    if (!log.type) {
      console.warn('[ADD LOG] Warning: Log missing type field, adding default');
      log.type = 'log';
    }
    
    if (!log.timestamp) {
      console.warn('[ADD LOG] Warning: Log missing timestamp field, adding current time');
      log.timestamp = new Date().toISOString();
    }
    
    if (!log.message) {
      console.warn('[ADD LOG] Warning: Log missing message field, adding default');
      log.message = '[No message]';
    }
    
    // Add log to the logs array
    this.logs.push(log);
    
    // Limit the number of logs to maxLogs
    if (this.logs.length > this.maxLogs) {
      this.logs.shift(); // Remove oldest log
    }
    
    console.log(`[ADD LOG] Total logs after adding: ${this.logs.length}`);
    this.log(`Added log to logs array. Total logs: ${this.logs.length}`, 'debug');
    
    // Debug: Print the first few logs to verify they're stored correctly
    if (this.logs.length <= 5) {
      console.log('[ADD LOG] Current logs:');
      this.logs.forEach((l, i) => {
        console.log(`  Log #${i+1}: ${l.type} - ${l.message.substring(0, 50)}`);
      });
    }
  }

  // Enhanced logging method
  log(message, level = 'info') {
    if (!this.verbose && level === 'debug') return;
    
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    
    switch(level) {
      case 'error':
        console.error(`${prefix} ${message}`);
        break;
      case 'warn':
        console.warn(`${prefix} ${message}`);
        break;
      case 'debug':
        console.debug(`${prefix} ${message}`);
        break;
      default:
        console.log(`${prefix} ${message}`);
    }
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
      const url = new URL(req.url, `http://${req.headers.host}`);
      const clientType = url.searchParams.get('clientType');
      const clientId = crypto.randomUUID();
      
      ws.id = clientId;
      ws.clientType = clientType;
      ws.isAlive = true;
      
      this.log(`New WebSocket connection: ${clientType} (ID: ${clientId})`, 'info');

      // Set up pong event for heartbeat
      ws.on('pong', () => {
        ws.isAlive = true;
        this.log(`Received pong from ${clientType} client (ID: ${clientId})`, 'debug');
      });

      // Route to appropriate handler based on client type
      if (clientType === 'browser') {
        this.handleBrowserConnection(ws);
      } else if (clientType === 'cursor') {
        this.handleCursorConnection(ws);
      } else if (clientType === 'viewer') {
        this.handleViewerConnection(ws);
      } else {
        this.log(`Unknown client type: ${clientType}`, 'warn');
        ws.close(1008, 'Unknown client type');
      }
    });
    
    // Set up heartbeat interval (30 seconds)
    this.pingInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          this.log(`Terminating inactive ${ws.clientType} connection (ID: ${ws.id})`, 'warn');
          return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping();
        this.log(`Sent ping to ${ws.clientType} client (ID: ${ws.id})`, 'debug');
      });
    }, 30000);
    
    // API routes
    this.app.get('/api/status', (req, res) => {
      console.log('[API] Received request for /api/status');
      res.json({
        status: 'running',
        serverStatus: this.serverStatus,
        browserClients: this.browserClients.size,
        cursorClients: this.cursorClients.size,
        viewerClients: this.viewerClients.size,
        logs: this.logs.length,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      });
    });
    
    this.app.get('/api/logs', (req, res) => {
      console.log('[API] Received request for /api/logs');
      console.log(`[API] Current logs: ${this.logs.length}`);
      res.json({
        logs: this.logs
      });
    });
    
    // Add endpoint to clear logs
    this.app.post('/api/logs/clear', (req, res) => {
      console.log('[API] Received request to clear logs');
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
    
    // Start the server
    this.server.listen(this.port, () => {
      console.log(`\n=======================================================`);
      console.log(`🚀 Browser Console Capture Server running on port ${this.port}`);
      console.log(`=======================================================\n`);
    });
  }

  handleBrowserConnection(ws) {
    const clientId = ws.id;
    this.browserClients.add(ws);
    
    this.log(`Browser client connected (ID: ${clientId}). Total browser clients: ${this.browserClients.size}`, 'info');
    console.log(`[BROWSER CONNECTION] Browser client connected (ID: ${clientId}). Total browser clients: ${this.browserClients.size}`);
    
    // Send welcome message with handshake request
    this.sendToClient(ws, {
      type: 'handshake_request',
      message: 'Connected to Cursor Console Server',
      serverId: 'cursor-console-server',
      serverVersion: '1.0',
      timestamp: new Date().toISOString(),
      capabilities: {
        logCapture: true,
        tabTracking: true
      }
    });
    console.log(`[BROWSER CONNECTION] Sent handshake request to browser client (ID: ${clientId})`);
    
    // Notify all clients of the status change
    this.notifyStatusChange();
    
    // Set up a periodic tab refresh every 10 seconds
    const tabRefreshInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        this.log(`Requesting tabs from browser client (ID: ${clientId})`, 'debug');
        console.log(`[BROWSER CONNECTION] Requesting tabs from browser client (ID: ${clientId})`);
        this.sendToClient(ws, { type: 'request_tabs' });
      }
    }, 10000);
    
    // Handle messages from browser client
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        this.log(`Received message from browser client (ID: ${clientId}): ${message.type}`, 'debug');
        console.log(`[BROWSER MESSAGE] Received message from browser client (ID: ${clientId}): ${message.type}`, JSON.stringify(message).substring(0, 200));
        
        // Handle handshake response
        if (message.type === 'handshake_response') {
          console.log(`[HANDSHAKE] Received handshake response from browser client (ID: ${clientId}):`, JSON.stringify(message).substring(0, 200));
          
          // Store client capabilities and info
          ws.clientInfo = {
            clientId: message.clientId || clientId,
            clientVersion: message.clientVersion || 'unknown',
            capabilities: message.capabilities || {},
            handshakeComplete: true,
            connectedAt: new Date().toISOString()
          };
          
          // Send a test log to verify log handling
          this.sendToClient(ws, {
            type: 'test_log_request',
            requestId: Date.now().toString()
          });
          
          console.log(`[HANDSHAKE] Handshake completed with browser client (ID: ${clientId}). Sent test log request.`);
        }
        // Handle test log response
        else if (message.type === 'test_log_response') {
          console.log(`[TEST LOG] Received test log response from browser client (ID: ${clientId})`);
          
          // Mark client as fully verified
          if (ws.clientInfo) {
            ws.clientInfo.logVerified = true;
          }
          
          console.log(`[TEST LOG] Log verification completed for browser client (ID: ${clientId})`);
        }
        else if (message.type === 'console_log') {
          // Add log to the logs array
          this.addLog(message.data);
          console.log(`[CONSOLE LOG] Received console log: ${message.data.type}, from: ${message.data.url.substring(0, 50)}`);
          console.log(`[CONSOLE LOG] Message: ${message.data.message.substring(0, 100)}`);
          
          // Broadcast to all cursor clients and viewers
          this.broadcastToCursor({
            type: 'console_log',
            data: message.data
          });
          
          this.broadcastToViewers({
            type: 'console_log',
            data: message.data
          });
          
          this.log(`Broadcasted console log to ${this.cursorClients.size} cursor clients and ${this.viewerClients.size} viewer clients`, 'debug');
        } else if (message.type === 'tabs_update' || message.type === 'tabs_response') {
          // Accept both tabs_update and tabs_response for compatibility
          // Store the latest tabs
          this.latestTabs = message.tabs;
          console.log(`[TABS UPDATE] Received tabs update with ${message.tabs ? message.tabs.length : 0} tabs`);
          
          // Broadcast to all viewers
          this.broadcastToViewers({
            type: 'tabs_update',
            tabs: message.tabs
          });
          
          this.log(`Received tabs update from browser (ID: ${clientId}): ${message.tabs ? message.tabs.length : 0} tabs. Broadcasted to ${this.viewerClients.size} viewers.`, 'debug');
        } else if (message.type === 'tab_updated' || 
                   message.type === 'tab_created' || 
                   message.type === 'tab_removed' || 
                   message.type === 'tab_activated' || 
                   message.type === 'tab_moved' || 
                   message.type === 'tab_highlighted') {
          // Request fresh tab data immediately on tab state changes
          this.log(`Tab state changed (${message.type}), requesting fresh tabs from browser (ID: ${clientId})`, 'debug');
          this.sendToClient(ws, { type: 'request_tabs' });
        } else if (message.type === 'ping' || message.type === 'pong') {
          // Handle ping/pong for connection health
          this.log(`Received ${message.type} from browser client (ID: ${clientId})`, 'debug');
        } else {
          // Log unknown message types
          console.log(`[UNKNOWN MESSAGE] Received unknown message type from browser client (ID: ${clientId}): ${message.type}`);
        }
      } catch (error) {
        this.log(`Error processing message from browser client (ID: ${clientId}): ${error.message}`, 'error');
        console.error(`[ERROR] Error processing message from browser client (ID: ${clientId}): ${error.message}`, error);
      }
    });
    
    // Handle client disconnection
    ws.on('close', (code, reason) => {
      this.browserClients.delete(ws);
      clearInterval(tabRefreshInterval);
      
      this.log(`Browser client disconnected (ID: ${clientId}). Code: ${code}, Reason: ${reason || 'No reason'}. Remaining browser clients: ${this.browserClients.size}`, 'info');
      console.log(`[BROWSER DISCONNECTION] Browser client disconnected (ID: ${clientId}). Code: ${code}, Reason: ${reason || 'No reason'}. Remaining browser clients: ${this.browserClients.size}`);
      
      // Notify all clients of the status change
      this.notifyStatusChange();
    });
    
    // Handle errors
    ws.on('error', (error) => {
      this.log(`Error with browser client (ID: ${clientId}): ${error.message}`, 'error');
      console.error(`[BROWSER ERROR] Error with browser client (ID: ${clientId}): ${error.message}`, error);
      
      // Clean up on error
      this.browserClients.delete(ws);
      clearInterval(tabRefreshInterval);
      
      // Notify all clients of the status change
      this.notifyStatusChange();
    });
  }

  handleCursorConnection(ws) {
    const clientId = ws.id;
    this.cursorClients.add(ws);
    this.observers.add(ws);
    
    this.log(`Cursor client connected (ID: ${clientId}). Total cursor clients: ${this.cursorClients.size}`, 'info');
    
    // Send welcome message
    this.sendToClient(ws, {
      type: 'welcome',
      message: 'Connected to Cursor Console Server'
    });
    
    // Send existing logs
    if (this.logs.length > 0) {
      this.sendToClient(ws, {
        type: 'logs',
        logs: this.logs
      });
      this.log(`Sent ${this.logs.length} existing logs to cursor client (ID: ${clientId})`, 'debug');
    }
    
    // Notify all clients of the status change
    this.notifyStatusChange();
    
    // Handle messages from cursor client
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        this.log(`Received message from cursor client (ID: ${clientId}): ${message.type}`, 'debug');
        
        if (message.type === 'clear_logs') {
          // Clear logs
          this.logs = [];
          
          // Notify all clients that logs were cleared
          this.broadcastToCursor({
            type: 'logs_cleared'
          });
          
          this.broadcastToViewers({
            type: 'logs_cleared'
          });
          
          this.log(`Logs cleared by cursor client (ID: ${clientId}). Notified all clients.`, 'info');
        }
      } catch (error) {
        this.log(`Error processing message from cursor client (ID: ${clientId}): ${error.message}`, 'error');
      }
    });
    
    // Handle client disconnection
    ws.on('close', (code, reason) => {
      this.cursorClients.delete(ws);
      this.observers.delete(ws);
      
      this.log(`Cursor client disconnected (ID: ${clientId}). Code: ${code}, Reason: ${reason || 'No reason'}. Remaining cursor clients: ${this.cursorClients.size}`, 'info');
      
      // Notify all clients of the status change
      this.notifyStatusChange();
    });
    
    // Handle errors
    ws.on('error', (error) => {
      this.log(`Error with cursor client (ID: ${clientId}): ${error.message}`, 'error');
      
      // Clean up on error
      this.cursorClients.delete(ws);
      this.observers.delete(ws);
      
      // Notify all clients of the status change
      this.notifyStatusChange();
    });
  }
  
  // Handle viewer connections (web UI)
  handleViewerConnection(ws) {
    const clientId = ws.id;
    this.viewerClients.add(ws);
    this.observers.add(ws);
    
    this.log(`Viewer client connected (ID: ${clientId}). Total viewer clients: ${this.viewerClients.size}`, 'info');
    
    // Send welcome message
    this.sendToClient(ws, {
      type: 'welcome',
      message: 'Connected to Cursor Console Server'
    });
    
    // Send existing logs
    if (this.logs.length > 0) {
      this.sendToClient(ws, {
        type: 'logs',
        logs: this.logs
      });
      this.log(`Sent ${this.logs.length} existing logs to viewer client (ID: ${clientId})`, 'debug');
    }
    
    // Send current tabs if available
    if (this.latestTabs && this.latestTabs.length > 0) {
      this.sendToClient(ws, {
        type: 'tabs_update',
        tabs: this.latestTabs
      });
      this.log(`Sent ${this.latestTabs.length} tabs to viewer client (ID: ${clientId})`, 'debug');
    } else if (this.browserClients.size > 0) {
      // Request tabs from the first available browser client
      for (const browserClient of this.browserClients) {
        if (browserClient.readyState === WebSocket.OPEN) {
          this.log(`Requesting tabs from browser client for new viewer (ID: ${clientId})`, 'debug');
          this.sendToClient(browserClient, { type: 'request_tabs' });
          break;
        }
      }
    }
    
    // Notify all clients of the status change
    this.notifyStatusChange();
    
    // Handle messages from viewer client
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        this.log(`Received message from viewer client (ID: ${clientId}): ${message.type}`, 'debug');
        
        if (message.type === 'clear_logs') {
          // Clear logs
          this.logs = [];
          
          // Notify all clients that logs were cleared
          this.broadcastToCursor({
            type: 'logs_cleared'
          });
          
          this.broadcastToViewers({
            type: 'logs_cleared'
          });
          
          this.log(`Logs cleared by viewer client (ID: ${clientId}). Notified all clients.`, 'info');
        } else if (message.type === 'request_tabs') {
          // Request tabs from all browser clients
          if (this.browserClients.size > 0) {
            this.log(`Tabs requested by viewer client (ID: ${clientId}). Requesting from browser clients.`, 'debug');
            this.broadcastToBrowser({ type: 'request_tabs' });
          } else if (this.latestTabs && this.latestTabs.length > 0) {
            // Send cached tabs if available
            this.sendToClient(ws, {
              type: 'tabs_update',
              tabs: this.latestTabs
            });
            this.log(`Sent cached tabs to viewer client (ID: ${clientId})`, 'debug');
          }
        } else if (message.type === 'request_status') {
          // Send current status to the requesting client
          this.log(`Status requested by viewer client (ID: ${clientId})`, 'debug');
          this.sendStatusToClient(ws);
        }
      } catch (error) {
        this.log(`Error processing message from viewer client (ID: ${clientId}): ${error.message}`, 'error');
      }
    });
    
    // Handle client disconnection
    ws.on('close', (code, reason) => {
      this.viewerClients.delete(ws);
      this.observers.delete(ws);
      
      this.log(`Viewer client disconnected (ID: ${clientId}). Code: ${code}, Reason: ${reason || 'No reason'}. Remaining viewer clients: ${this.viewerClients.size}`, 'info');
      
      // Notify all clients of the status change
      this.notifyStatusChange();
    });
    
    // Handle errors
    ws.on('error', (error) => {
      this.log(`Error with viewer client (ID: ${clientId}): ${error.message}`, 'error');
      
      // Clean up on error
      this.viewerClients.delete(ws);
      this.observers.delete(ws);
      
      // Notify all clients of the status change
      this.notifyStatusChange();
    });
  }

  sendToClient(client, message) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        const messageStr = JSON.stringify(message);
        client.send(messageStr);
        this.log(`Sent ${message.type} message to ${client.clientType} client (ID: ${client.id})`, 'debug');
        console.log(`[SEND] Sent ${message.type} message to ${client.clientType} client (ID: ${client.id}). Message length: ${messageStr.length}`);
        return true;
      } catch (error) {
        this.log(`Error sending message to ${client.clientType} client (ID: ${client.id}): ${error.message}`, 'error');
        console.error(`[SEND ERROR] Error sending message to ${client.clientType} client (ID: ${client.id}): ${error.message}`);
        return false;
      }
    } else {
      console.log(`[SEND FAILED] Client ${client.clientType} (ID: ${client.id}) is not in OPEN state. Current state: ${client.readyState}`);
      return false;
    }
  }

  broadcastToBrowser(message) {
    let sentCount = 0;
    this.browserClients.forEach((client) => {
      if (this.sendToClient(client, message)) {
        sentCount++;
      }
    });
    this.log(`Broadcasted ${message.type} to ${sentCount}/${this.browserClients.size} browser clients`, 'debug');
    return sentCount;
  }

  broadcastToCursor(message) {
    let sentCount = 0;
    this.cursorClients.forEach((client) => {
      if (this.sendToClient(client, message)) {
        sentCount++;
      }
    });
    this.log(`Broadcasted ${message.type} to ${sentCount}/${this.cursorClients.size} cursor clients`, 'debug');
    return sentCount;
  }
  
  broadcastToViewers(message) {
    let sentCount = 0;
    this.viewerClients.forEach((client) => {
      if (this.sendToClient(client, message)) {
        sentCount++;
      }
    });
    this.log(`Broadcasted ${message.type} to ${sentCount}/${this.viewerClients.size} viewer clients`, 'debug');
    return sentCount;
  }
  
  broadcastStatusToViewers() {
    // This is now handled by the observer pattern
    this.notifyStatusChange();
  }

  handleConsoleLog(log) {
    console.log(`[LOG] Received console log: ${log.type}, from: ${log.url.substring(0, 50)}${log.url.length > 50 ? '...' : ''}`);
    console.log(`[LOG] Message: ${log.message.substring(0, 100)}${log.message.length > 100 ? '...' : ''}`);
    
    // Add log to the logs array
    this.addLog(log);
    
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
  }

  start() {
    // Check if server is already running
    if (this.server) {
      this.log('Server is already running', 'info');
      return;
    }
    
    // Create HTTP server
    this.server = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });

    // Create WebSocket server
    this.wss = new WebSocket.Server({ server: this.server });

    // Start the server
    this.server.listen(this.port, () => {
      this.log(`Server running on port ${this.port}`, 'info');
    });
    
    // Set up error handling
    this.server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        this.log(`Port ${this.port} is already in use. Please choose a different port.`, 'error');
        process.exit(1);
      } else {
        this.log(`Server error: ${err.message}`, 'error');
      }
    });
  }

  stop() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.server) {
      this.server.close();
      this.server = null;
    }

    this.log('Server stopped', 'info');
  }

  handleHttpRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    this.log(`HTTP ${req.method} request: ${pathname}`, 'debug');

    // Handle API endpoints
    if (pathname === '/api/status') {
      this.handleStatusRequest(req, res);
    } else if (pathname === '/api/logs') {
      this.handleLogsRequest(req, res);
    } else if (pathname === '/api/logs/clear') {
      this.handleClearLogsRequest(req, res);
    } else if (pathname === '/api/tabs') {
      this.handleTabsRequest(req, res);
    } else {
      // Serve static files
      this.serveStaticFiles(req, res);
    }
  }

  handleStatusRequest(req, res) {
    const status = {
      serverStatus: 'online',
      browserClients: this.browserClients.size,
      cursorClients: this.cursorClients.size,
      viewerClients: this.viewerClients.size,
      uptime: Date.now() - this.startTime,
      logs: this.logs.length
    };
    
    this.sendJsonResponse(res, status);
    this.log('Handled HTTP status request', 'debug');
  }

  handleLogsRequest(req, res) {
    res.json({
      logs: this.logs
    });
    this.log('Handled HTTP logs request', 'debug');
  }

  handleClearLogsRequest(req, res) {
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
    this.log('Handled HTTP clear logs request', 'debug');
  }

  handleTabsRequest(req, res) {
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
  }

  handleApiRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    // Handle API routes
    if (path === '/api/tabs') {
      // Return list of tabs
      const tabs = [];
      this.browserClients.forEach(client => {
        if (client.tabs) {
          tabs.push(...client.tabs);
        }
      });
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tabs }));
      return true;
    } 
    else if (path === '/api/logs') {
      // Return logs
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ logs: this.logs }));
      return true;
    }
    else if (path === '/api/tabs/settings') {
      // Handle tab tracking settings
      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        
        req.on('end', () => {
          try {
            const settings = JSON.parse(body);
            console.log('Received tab tracking settings:', settings);
            
            // Broadcast settings to all browser clients
            this.browserClients.forEach(client => {
              if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify({
                  type: 'settings',
                  trackingMode: settings.trackingMode,
                  trackedTabs: settings.trackedTabs || {}
                }));
              }
            });
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } catch (error) {
            console.error('Error processing tab tracking settings:', error);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: false, 
              message: 'Invalid request format' 
            }));
          }
        });
        
        return true;
      }
      
      // GET request for current settings
      if (req.method === 'GET') {
        // For now, we don't store settings on the server
        // Just return a default
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          trackingMode: 'all',
          trackedTabs: {}
        }));
        return true;
      }
    }
    else if (path === '/api/status') {
      // Return server status
      const status = {
        browserClients: this.browserClients.length,
        cursorClients: this.cursorClients.length,
        totalLogs: this.totalLogs
      };
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return true;
    }
    
    return false;
  }

  // Observer pattern methods
  notifyStatusChange() {
    const statusUpdate = {
      type: 'status_update',
      browserClients: this.browserClients.size,
      cursorClients: this.cursorClients.size,
      viewerClients: this.viewerClients.size,
      serverStatus: this.serverStatus,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
    
    this.log(`Status change: Browser: ${statusUpdate.browserClients}, Cursor: ${statusUpdate.cursorClients}, Viewer: ${statusUpdate.viewerClients}`, 'info');
    
    // Send to all observers
    let sentCount = 0;
    this.observers.forEach((client) => {
      if (this.sendToClient(client, statusUpdate)) {
        sentCount++;
      }
    });
    
    this.log(`Sent status update to ${sentCount}/${this.observers.size} observers`, 'debug');
  }
  
  sendStatusToClient(client) {
    const statusUpdate = {
      type: 'status_update',
      browserClients: this.browserClients.size,
      cursorClients: this.cursorClients.size,
      viewerClients: this.viewerClients.size,
      serverStatus: this.serverStatus,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
    
    this.sendToClient(client, statusUpdate);
  }
}

module.exports = ConsoleServer; 