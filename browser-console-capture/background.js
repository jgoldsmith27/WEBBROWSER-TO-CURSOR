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

// Initialize client ID
const clientId = generateClientId();

// Initialize handshake status
let handshakeComplete = false;

// Cache for tab IDs to avoid repeated queries
let tabIdCache = {};

// Function to get tab ID for a sender
function getTabIdForSender(sender) {
  if (sender.tab && sender.tab.id) {
    return Promise.resolve(sender.tab.id);
  }
  
  // Try to find the tab by URL if available
  if (sender.url) {
    return new Promise((resolve) => {
      chrome.tabs.query({}, (tabs) => {
        const matchingTab = tabs.find(tab => tab.url === sender.url);
        if (matchingTab) {
          // Cache the result
          tabIdCache[sender.url] = matchingTab.id;
          resolve(matchingTab.id);
        } else {
          // Get active tab as fallback
          chrome.tabs.query({active: true, currentWindow: true}, (activeTabs) => {
            if (activeTabs && activeTabs.length > 0) {
              resolve(activeTabs[0].id);
            } else {
              resolve(null);
            }
          });
        }
      });
    });
  }
  
  // Get active tab as fallback
  return new Promise((resolve) => {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs && tabs.length > 0) {
        resolve(tabs[0].id);
      } else {
        resolve(null);
      }
    });
  });
}

// Connect to the WebSocket server
function connectToServer(serverUrl) {
  // Set the current server URL if provided
  if (serverUrl) {
    currentServerUrl = serverUrl;
  }
  
  // If no server URL is set, we can't connect
  if (!currentServerUrl) {
    console.error('Cannot connect: No server URL provided');
    return Promise.reject(new Error('No server URL provided'));
  }
  
  console.log('Connecting to server:', currentServerUrl);
  connectionInProgress = true;
  
  return new Promise((resolve, reject) => {
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
        connectionInProgress = false;
        
        // Update connection status
        chrome.storage.local.set({ isConnected: true });
        
        // Start ping interval
        startPingInterval();
        
        // Resolve the promise
        resolve();
        
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
        connectionInProgress = false;
        
        // Attempt to reconnect
        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          console.log(`Reconnecting (attempt ${reconnectAttempts}/${maxReconnectAttempts})...`);
          
          if (reconnectTimer) {
            clearTimeout(reconnectTimer);
          }
          
          reconnectTimer = setTimeout(() => {
            getServerUrl().then(serverUrl => {
              connectToServer(serverUrl);
            });
          }, reconnectInterval);
        } else {
          console.error('Max reconnect attempts reached. Giving up.');
        }
        
        // Update connection status
        chrome.storage.local.set({ isConnected: false });
        
        // Reject the promise if this is the initial connection attempt
        if (connectionInProgress) {
          reject(new Error(`Connection closed: ${event.code} ${event.reason}`));
        }
      });
      
      // Connection error
      webSocket.addEventListener('error', (error) => {
        console.error('WebSocket error:', error);
        connectionInProgress = false;
        
        // Reject the promise
        reject(error);
      });
      
    } catch (error) {
      console.error('Error connecting to server:', error);
      connectionInProgress = false;
      reject(error);
    }
  });
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
      const url = log.url;
      
      // Only track locally hosted websites
      let isLocalUrl = false;
      
      if (url) {
        try {
          const parsedUrl = new URL(url);
          isLocalUrl = parsedUrl.hostname === 'localhost' || 
                       parsedUrl.hostname === '127.0.0.1' || 
                       parsedUrl.hostname.endsWith('.local') ||
                       parsedUrl.hostname.endsWith('.localhost');
        } catch (e) {
          // Invalid URL, skip
          console.log('[BACKGROUND] Skipping log with invalid URL:', url);
          return false;
        }
      }
      
      // Skip logs from non-local URLs
      if (!isLocalUrl) {
        console.log('[BACKGROUND] Skipping log from non-local URL:', url);
        return false;
      }
      
      // If tracking mode is 'selected' and this tab is not tracked, don't send the log
      if (trackingMode === 'selected' && tabId && trackedTabs[tabId] === false) {
        debugLog('Skipping log from untracked tab:', tabId);
        console.log('[BACKGROUND] Skipping log from untracked tab:', tabId, 'URL =', log.url);
        return false;
      }
      
      const message = JSON.stringify({
        type: 'console_log',
        data: log
      });
      
      debugLog('Sending log to server:', message.substring(0, 100) + (message.length > 100 ? '...' : ''));
      console.log('[BACKGROUND] Sending log to server, URL =', log.url, 'Type =', log.type);
      webSocket.send(message);
      return true;
    } catch (error) {
      console.error('[BACKGROUND] Error sending log to server:', error, 'URL =', log.url);
      pendingLogs.push(log);
      return false;
    }
  } else {
    debugLog('Not connected to server, adding log to pending logs');
    console.log('[BACKGROUND] Not connected to server, adding log to pending logs, URL =', log.url);
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
      // Filter tabs to only include locally hosted websites
      const localTabs = tabs.filter(tab => {
        if (!tab.url) return false;
        
        try {
          const url = new URL(tab.url);
          return url.hostname === 'localhost' || 
                 url.hostname === '127.0.0.1' || 
                 url.hostname.endsWith('.local') ||
                 url.hostname.endsWith('.localhost');
        } catch (e) {
          return false; // Invalid URL
        }
      });
      
      // Format tabs to include only necessary information
      const formattedTabs = localTabs.map(tab => ({
        id: tab.id,
        title: tab.title || 'Untitled Tab',
        url: tab.url || '',
        favIconUrl: tab.favIconUrl || 'default-favicon.png',
        isTracked: trackingMode === 'all' || trackedTabs[tab.id] !== false
      }));
      
      debugLog('Sending local tabs to server:', formattedTabs.length, 'tabs');
      
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
  debugLog('Received message from content script:', message.action);
  
  if (message.action === 'capturedLog') {
    // Log more details about the captured log
    console.log('[BACKGROUND] Received log from content script:', 
      'URL =', message.log.url, 
      'Type =', message.log.type,
      'TabId =', message.log.tabId,
      'Sender Tab ID =', sender.tab ? sender.tab.id : 'unknown');
    
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
      console.log('[BACKGROUND] Added tab ID to log:', sender.tab.id);
    }
    
    // Send log to server
    const sent = sendLogToServer(message.log);
    console.log('[BACKGROUND] Sent log to server:', sent ? 'success' : 'failed');
    
    sendResponse({ success: true });
    return true; // Required for async response
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
    return true; // Required for async response
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
    debugLog('Received getCurrentTabId request from content script');
    console.log('[BACKGROUND] Received getCurrentTabId request from content script, sender URL =', sender.url);
    
    // First check if we have the tab ID directly from sender
    if (sender.tab && sender.tab.id) {
      debugLog('Returning tab ID from sender:', sender.tab.id);
      console.log('[BACKGROUND] Returning tab ID from sender:', sender.tab.id, 'URL =', sender.tab ? sender.tab.url : 'unknown');
      sendResponse({ tabId: sender.tab.id });
      return true;
    }
    
    // Check if we have a cached tab ID for this URL
    if (sender.url && tabIdCache[sender.url]) {
      debugLog('Returning cached tab ID for URL:', tabIdCache[sender.url]);
      console.log('[BACKGROUND] Returning cached tab ID for URL:', tabIdCache[sender.url], 'URL =', sender.url);
      sendResponse({ tabId: tabIdCache[sender.url] });
      return true;
    }
    
    // Otherwise, we need to look it up
    debugLog('Looking up tab ID for sender');
    console.log('[BACKGROUND] Looking up tab ID for sender, URL =', sender.url);
    getTabIdForSender(sender).then(tabId => {
      debugLog('Found tab ID:', tabId);
      console.log('[BACKGROUND] Found tab ID:', tabId, 'for URL =', sender.url);
      sendResponse({ tabId: tabId });
    }).catch(error => {
      debugLog('Error getting tab ID:', error);
      console.error('[BACKGROUND] Error getting tab ID:', error, 'for URL =', sender.url);
      sendResponse({ tabId: null });
    });
    
    return true; // Required for async response
  } else if (message.action === 'navigationEvent') {
    // Store navigation event
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId) {
      debugLog('Navigation event in tab', tabId, ':', message.url);
      
      // Update the tab ID cache
      if (message.url) {
        tabIdCache[message.url] = tabId;
      }
    }
    sendResponse({ success: true });
    return true; // Required for async response
  } else if (message.action === 'checkConnection') {
    // Check if we're connected and reconnect if not
    if (!isConnected && !connectionInProgress && !reconnectTimer) {
      debugLog('Connection check requested, reconnecting...');
      getServerUrl().then(serverUrl => {
        connectToServer(serverUrl);
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
      connectToServer(serverUrl);
    });
  }, 2000); // Delay connection to ensure browser is fully started
});

// Periodically check connection status and reconnect if needed
setInterval(() => {
  if (!isConnected && !connectionInProgress && !reconnectTimer && reconnectAttempts < maxReconnectAttempts) {
    debugLog('Periodic connection check, reconnecting...');
    getServerUrl().then(serverUrl => {
      connectToServer(serverUrl);
    });
  }
}, 60000); // Check every minute

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message:', message);
  
  if (message.action === 'connect') {
    // If a server URL is provided in the message, use that
    const serverUrl = message.serverUrl || null;
    
    // Get the server URL if not provided
    (serverUrl ? Promise.resolve(serverUrl) : getServerUrl())
      .then(url => {
        connectToServer(url)
          .then(() => {
            sendResponse({ success: true });
          })
          .catch((error) => {
            sendResponse({ success: false, error: error.message });
          });
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
      connectToServer(serverUrl);
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
    return connectToServer(serverUrl);
  }).catch(error => {
    debugLog('Force reconnect failed:', error.message);
    throw error;
  });
}
