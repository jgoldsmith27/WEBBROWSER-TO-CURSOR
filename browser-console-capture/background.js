// Store connection status
let isConnected = false;
let webSocket = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectInterval = 5000; // 5 seconds
let intentionalDisconnect = false; // Flag to track if disconnect was intentional
let reconnectTimer = null;
let connectionInProgress = false; // Flag to prevent multiple connection attempts
let currentServerUrl = null; // Store the current server URL

// Tab tracking settings
let trackingMode = 'all'; // 'all' or 'selected'
let trackedTabs = {}; // Object mapping tab IDs to tracking status

// Store logs that couldn't be sent due to connection issues
let pendingLogs = [];

// Server URL configuration
const SERVER_URLS = {
  development: 'ws://localhost:3000',
  production: 'wss://your-production-server.com' // Replace with your actual production server URL
};

// Default to development environment
const DEFAULT_ENV = 'development';
const defaultServerUrl = SERVER_URLS[DEFAULT_ENV];

// Add debug mode
let debugMode = true;

// Function to log debug messages
function debugLog(...args) {
  if (debugMode) {
    console.log('[Browser Console Capture]', ...args);
  }
}

// Enable debug mode
chrome.storage.local.get(['debugMode'], (result) => {
  debugMode = result.debugMode || false;
  debugLog('Debug mode:', debugMode ? 'enabled' : 'disabled');
});

// Load tab tracking settings
function loadTabTrackingSettings() {
  chrome.storage.local.get(['trackingMode', 'trackedTabs'], (result) => {
    trackingMode = result.trackingMode || 'all';
    trackedTabs = result.trackedTabs || {};
    debugLog('Loaded tab tracking settings:', trackingMode, trackedTabs);
  });
}

// Initialize tab tracking settings
loadTabTrackingSettings();

// Get the appropriate server URL based on environment
function getServerUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['serverUrl', 'environment'], (result) => {
      // If a custom server URL is set, use that
      if (result.serverUrl) {
        resolve(result.serverUrl);
        return;
      }
      
      // Otherwise use the environment-specific URL
      const env = result.environment || DEFAULT_ENV;
      resolve(SERVER_URLS[env] || SERVER_URLS[DEFAULT_ENV]);
    });
  });
}

// Generate a unique client ID
function generateClientId() {
  return 'browser-' + Math.random().toString(36).substring(2, 15);
}

// Connect to the WebSocket server
function connectToServer() {
  console.log('Connecting to server:', currentServerUrl);
  
  try {
    // Close existing socket if any
    if (webSocket) {
      webSocket.close();
    }
    
    // Create new WebSocket connection
    webSocket = new WebSocket(currentServerUrl + '?clientType=browser');
    
    // Connection opened
    webSocket.addEventListener('open', (event) => {
      console.log('Connected to server');
      isConnected = true;
      reconnectAttempts = 0;
      
      // Wait for handshake request from server
      // The server will initiate the handshake
    });
    
    // Listen for messages
    webSocket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('Received message from server:', message.type);
        
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
          
          sendToServer(handshakeResponse);
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
              message: 'Test log from browser extension',
              stackTrace: 'Test stack trace',
              url: 'browser-extension://test',
              tabId: -1
            }
          };
          
          sendToServer(testLog);
          
          // Send test log response
          const testLogResponse = {
            type: 'test_log_response',
            requestId: message.requestId,
            success: true
          };
          
          sendToServer(testLogResponse);
          console.log('Sent test log and response to server');
        }
        // Handle request_tabs
        else if (message.type === 'request_tabs') {
          console.log('Received request for tabs');
          sendTabs();
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    });
    
    // Connection closed
    webSocket.addEventListener('close', (event) => {
      console.log('Connection closed:', event.code, event.reason);
      isConnected = false;
      handshakeComplete = false;
      
      // Attempt to reconnect
      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        console.log(`Reconnecting (attempt ${reconnectAttempts}/${maxReconnectAttempts})...`);
        
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
        }
        
        reconnectTimer = setTimeout(connectToServer, reconnectInterval);
      } else {
        console.error('Max reconnect attempts reached. Giving up.');
      }
      
      // Update connection status
      updateConnectionStatus();
    });
    
    // Connection error
    webSocket.addEventListener('error', (error) => {
      console.error('WebSocket error:', error);
    });
    
  } catch (error) {
    console.error('Error connecting to server:', error);
  }
}

// Send message to server
function sendToServer(message) {
  if (webSocket && webSocket.readyState === WebSocket.OPEN) {
    try {
      webSocket.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Error sending message to server:', error);
      return false;
    }
  } else {
    console.warn('Cannot send message, socket is not open');
    return false;
  }
}

// Keep-alive ping interval
let pingInterval = null;

function startPingInterval() {
  // Clear any existing interval
  if (pingInterval) {
    clearInterval(pingInterval);
  }
  
  // Set up new interval
  pingInterval = setInterval(() => {
    if (isConnected && webSocket && webSocket.readyState === WebSocket.OPEN) {
      try {
        webSocket.send(JSON.stringify({ type: 'ping' }));
      } catch (error) {
        debugLog('Error sending ping:', error);
      }
    } else {
      // Stop interval if not connected
      clearInterval(pingInterval);
      pingInterval = null;
    }
  }, 30000); // 30 seconds
}

// Send pending logs to server
function sendPendingLogs() {
  if (pendingLogs.length === 0) return;
  
  debugLog(`Sending ${pendingLogs.length} pending logs to server`);
  
  // Create a copy of the pending logs
  const logsToSend = [...pendingLogs];
  
  // Clear the pending logs array
  pendingLogs = [];
  
  // Send each log
  logsToSend.forEach(log => {
    sendLogToServer(log);
  });
}

// Send log to server
function sendLogToServer(log) {
  if (isConnected && webSocket && webSocket.readyState === WebSocket.OPEN) {
    try {
      // Check if this tab should be tracked
      const tabId = log.tabId;
      
      // If tracking mode is 'selected' and this tab is not tracked, don't send the log
      if (trackingMode === 'selected' && tabId && trackedTabs[tabId] === false) {
        debugLog('Skipping log from untracked tab:', tabId);
        return false;
      }
      
      const message = JSON.stringify({
        type: 'console_log',
        data: log
      });
      
      debugLog('Sending log to server:', message.substring(0, 100) + (message.length > 100 ? '...' : ''));
      webSocket.send(message);
      return true;
    } catch (error) {
      console.error('Error sending log to server:', error);
      pendingLogs.push(log);
      return false;
    }
  } else {
    debugLog('Not connected to server, adding log to pending logs');
    pendingLogs.push(log);
    
    // Limit the number of pending logs to prevent memory issues
    if (pendingLogs.length > 1000) {
      pendingLogs = pendingLogs.slice(-1000); // Keep only the most recent 1000 logs
    }
    
    return false;
  }
}

// Function to send tabs to server
function sendTabsToServer() {
  if (!isConnected || !webSocket || webSocket.readyState !== WebSocket.OPEN) {
    debugLog('Cannot send tabs: WebSocket not open');
    return false;
  }
  
  chrome.tabs.query({}, (tabs) => {
    try {
      // Format tabs to include only necessary information
      const formattedTabs = tabs.map(tab => ({
        id: tab.id,
        title: tab.title || 'Untitled Tab',
        url: tab.url || '',
        favIconUrl: tab.favIconUrl || 'default-favicon.png',
        isTracked: trackingMode === 'all' || trackedTabs[tab.id] !== false
      }));
      
      debugLog('Sending tabs to server:', formattedTabs.length, 'tabs');
      
      const message = {
        type: 'tabs_update',
        tabs: formattedTabs
      };
      
      webSocket.send(JSON.stringify(message));
      
      return true;
    } catch (error) {
      debugLog('Error sending tabs to server:', error);
      return false;
    }
  });
}

// Listen for tab updates to keep server in sync
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (isConnected && webSocket && webSocket.readyState === WebSocket.OPEN) {
    // Only send updates when the tab is fully loaded
    if (changeInfo.status === 'complete') {
      // Add a small delay to ensure tab information is fully updated
      setTimeout(sendTabsToServer, 500);
    }
  }
});

// Listen for tab removals to keep server in sync
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (isConnected && webSocket && webSocket.readyState === WebSocket.OPEN) {
    // Remove the tab from tracked tabs if it exists
    if (trackedTabs[tabId] !== undefined) {
      delete trackedTabs[tabId];
      chrome.storage.local.set({ trackedTabs });
    }
    
    // Add a small delay to ensure tab information is fully updated
    setTimeout(sendTabsToServer, 500);
  }
});

// Listen for tab creation to keep server in sync
chrome.tabs.onCreated.addListener((tab) => {
  if (isConnected && webSocket && webSocket.readyState === WebSocket.OPEN) {
    // Add a small delay to ensure tab information is fully updated
    setTimeout(sendTabsToServer, 500);
  }
});

// Initialize connection
chrome.runtime.onInstalled.addListener(() => {
  console.log('Browser Console Capture extension installed');
  chrome.storage.local.set({ isConnected: false });
});

// Disconnect from server
function disconnectFromServer() {
  return new Promise((resolve, reject) => {
    if (!isConnected || !webSocket) {
      resolve();
      return;
    }
    
    debugLog('Disconnecting from server');
    
    // Set intentional disconnect flag
    intentionalDisconnect = true;
    
    try {
      webSocket.close();
      isConnected = false;
      
      // Update connection status
      chrome.storage.local.set({ isConnected: false });
      
      resolve();
    } catch (error) {
      debugLog('Error disconnecting from server:', error);
      reject(error);
    }
  });
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'capturedLog') {
    // Store log in local storage
    chrome.storage.local.get(['logs'], (result) => {
      const logs = result.logs || [];
      logs.push(message.log);
      
      // Limit the number of stored logs to prevent excessive storage usage
      if (logs.length > 1000) {
        logs.shift(); // Remove oldest log
      }
      
      chrome.storage.local.set({ logs });
    });
    
    // Add tab ID to the log if not already present
    if (!message.log.tabId && sender.tab) {
      message.log.tabId = sender.tab.id;
    }
    
    // Send log to server
    sendLogToServer(message.log);
    
    sendResponse({ success: true });
  } else if (message.action === 'connect') {
    connectToServer()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Indicates async response
  } else if (message.action === 'disconnect') {
    disconnectFromServer()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Indicates async response
  } else if (message.action === 'getConnectionStatus') {
    sendResponse({ isConnected });
    return false; // Synchronous response
  } else if (message.action === 'getFilterSettings') {
    chrome.storage.local.get(['domainFilterMode', 'domainFilterList'], (result) => {
      sendResponse({
        domainFilterMode: result.domainFilterMode || 'disabled',
        domainFilterList: result.domainFilterList || []
      });
    });
    return true; // Required for async response
  } else if (message.action === 'getCurrentTabId') {
    // Return the tab ID of the sender
    if (sender.tab && sender.tab.id) {
      sendResponse({ tabId: sender.tab.id });
    } else {
      sendResponse({ tabId: null });
    }
    return false; // Synchronous response
  } else if (message.action === 'navigationEvent') {
    // Store navigation event
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId) {
      debugLog('Navigation event in tab', tabId, ':', message.url);
    }
    sendResponse({ success: true });
    return false; // Synchronous response
  } else if (message.action === 'checkConnection') {
    // Check if we're connected and reconnect if not
    if (!isConnected && !connectionInProgress && !reconnectTimer) {
      debugLog('Connection check requested, reconnecting...');
      getServerUrl().then(serverUrl => {
        connectToServer();
      });
    }
    
    // Check actual WebSocket state
    let wsState = 'No WebSocket';
    let wsStateText = 'No WebSocket';
    
    if (webSocket) {
      wsState = webSocket.readyState;
      switch(wsState) {
        case WebSocket.CONNECTING:
          wsStateText = 'CONNECTING';
          break;
        case WebSocket.OPEN:
          wsStateText = 'OPEN';
          break;
        case WebSocket.CLOSING:
          wsStateText = 'CLOSING';
          break;
        case WebSocket.CLOSED:
          wsStateText = 'CLOSED';
          break;
        default:
          wsStateText = 'UNKNOWN';
      }
    }
    
    sendResponse({ 
      isConnected, 
      connectionInProgress, 
      reconnectAttempts,
      wsState,
      wsStateText,
      serverUrl: currentServerUrl
    });
    return false; // Synchronous response
  } else if (message.action === 'setDebugMode') {
    debugMode = message.debugMode;
    chrome.storage.local.set({ debugMode });
    sendResponse({ success: true });
    return false; // Synchronous response
  } else if (message.action === 'sendTabs') {
    if (isConnected && webSocket && webSocket.readyState === WebSocket.OPEN) {
      sendTabsToServer();
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Not connected to server' });
    }
    return false; // Synchronous response
  } else if (message.action === 'updateTabTracking') {
    const { tabId, isTracked } = message;
    
    if (tabId) {
      trackedTabs[tabId] = isTracked;
      chrome.storage.local.set({ trackedTabs });
      
      // Notify the content script in this tab
      chrome.tabs.sendMessage(tabId, { 
        action: 'updateTabTracking', 
        isTracked 
      }).catch(() => {
        // Ignore errors
      });
      
      // Update server with new tabs
      if (isConnected) {
        sendTabsToServer();
      }
      
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'No tab ID provided' });
    }
    
    return false; // Synchronous response
  } else if (message.action === 'updateTrackingMode') {
    trackingMode = message.trackingMode;
    chrome.storage.local.set({ trackingMode });
    
    // Notify all content scripts
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { 
          action: 'updateTrackingMode', 
          trackingMode 
        }).catch(() => {
          // Ignore errors
        });
      });
    });
    
    // Update server with new tabs
    if (isConnected) {
      sendTabsToServer();
    }
    
    sendResponse({ success: true });
    return false; // Synchronous response
  } else if (message.action === 'getStatus') {
    // Return current connection status
    sendResponse({
      isConnected: isConnected,
      serverUrl: currentServerUrl || 'Not connected'
    });
  } else if (message.action === 'forceReconnect') {
    forceReconnect()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Async response
  } else if (message.action === 'sendTestLog') {
    const result = sendTestLog();
    sendResponse({ success: result });
    return true;
  } else if (message.action === 'getDebugInfo') {
    sendResponse({
      isConnected: isConnected,
      webSocketState: webSocket ? webSocket.readyState : -1,
      serverUrl: currentServerUrl,
      reconnectAttempts: reconnectAttempts,
      maxReconnectAttempts: maxReconnectAttempts,
      trackingMode: trackingMode,
      debugMode: debugMode,
      pendingLogs: pendingLogs.length,
      connectionInProgress: connectionInProgress,
      intentionalDisconnect: intentionalDisconnect
    });
    return true; // Async response
  }
  
  return true; // Required for async response
});

// Connect when Chrome starts
chrome.runtime.onStartup.addListener(() => {
  // Connect to server using the appropriate URL
  setTimeout(() => {
    getServerUrl().then(serverUrl => {
      connectToServer();
    });
  }, 2000); // Delay connection to ensure browser is fully started
});

// Periodically check connection status and reconnect if needed
setInterval(() => {
  if (!isConnected && !connectionInProgress && !reconnectTimer && reconnectAttempts < maxReconnectAttempts) {
    debugLog('Periodic connection check, reconnecting...');
    getServerUrl().then(serverUrl => {
      connectToServer();
    });
  }
}, 60000); // Check every minute

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message:', message);
  
  if (message.action === 'connect') {
    connectToServer()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  } else if (message.action === 'disconnect') {
    // Disconnect from server
    disconnectFromServer()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  } else if (message.action === 'getStatus') {
    // Return current connection status
    sendResponse({
      isConnected: isConnected,
      serverUrl: currentServerUrl || 'Not connected'
    });
  } else if (message.action === 'forceReconnect') {
    // Force reconnection to the server
    debugLog('Forcing reconnection to server');
    console.log('Forcing reconnection to server');
    
    // First disconnect if connected
    if (isConnected) {
      disconnectFromServer();
    }
    
    // Reset connection state
    isConnected = false;
    connectionInProgress = false;
    reconnectAttempts = 0;
    
    // Get server URL and connect
    getServerUrl().then(serverUrl => {
      connectToServer();
    });
    
    return true; // Async response
  } else if (message.action === 'sendTestLog') {
    const result = sendTestLog();
    sendResponse({ success: result });
    return true;
  }
});

// Add a test function to send a log message
function sendTestLog() {
  debugLog('Sending test log message');
  
  if (!isConnected || !webSocket || webSocket.readyState !== WebSocket.OPEN) {
    debugLog('Cannot send test log: WebSocket not connected');
    return false;
  }
  
  const testLog = {
    type: 'console_log',
    data: {
      type: 'log',
      timestamp: new Date().toISOString(),
      message: 'This is a test log message from the extension background script',
      stackTrace: 'Test stack trace',
      url: 'background-script://test',
      tabId: -1
    }
  };
  
  try {
    webSocket.send(JSON.stringify(testLog));
    debugLog('Test log sent successfully');
    return true;
  } catch (error) {
    debugLog('Error sending test log:', error.message);
    return false;
  }
}

// Force reconnect to server
function forceReconnect() {
  debugLog('Force reconnecting to server');
  
  // Disconnect if connected
  if (isConnected && webSocket) {
    intentionalDisconnect = true;
    webSocket.close();
    isConnected = false;
  }
  
  // Reset connection state
  reconnectAttempts = 0;
  connectionInProgress = false;
  intentionalDisconnect = false;
  
  // Clear any reconnect timer
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  
  // Get server URL and connect
  return getServerUrl().then(serverUrl => {
    debugLog('Force reconnecting to:', serverUrl);
    return connectToServer();
  }).catch(error => {
    debugLog('Force reconnect failed:', error.message);
    throw error;
  });
}
