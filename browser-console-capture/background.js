// Store connection status
let isConnected = false;
let webSocket = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 3;
const reconnectDelay = 2000; // 2 seconds
let intentionalDisconnect = false; // Flag to track if disconnect was intentional
let reconnectTimer = null; // Timer for reconnection attempts
let connectionInProgress = false; // Flag to prevent multiple connection attempts
let currentServerUrl = null; // Store the current server URL

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

// Connect to WebSocket server
function connectToServer(serverUrl) {
  return new Promise((resolve, reject) => {
    // If already connected, disconnect first
    if (isConnected) {
      disconnectFromServer();
    }
    
    // Reset intentional disconnect flag
    intentionalDisconnect = false;
    
    try {
      // Add clientType parameter to URL if not already present
      let fullUrl = serverUrl;
      if (!fullUrl.includes('clientType=')) {
        const separator = fullUrl.includes('?') ? '&' : '?';
        fullUrl = `${fullUrl}${separator}clientType=browser`;
      }
      
      debugLog('Connecting to server at:', fullUrl);
      
      // Create the WebSocket connection
      webSocket = new WebSocket(fullUrl);
      
      // Set a connection timeout
      const connectionTimeout = setTimeout(() => {
        if (webSocket && webSocket.readyState !== WebSocket.OPEN) {
          debugLog('Connection timeout, closing socket');
          webSocket.close();
          reject(new Error('Connection timeout'));
        }
      }, 5000); // 5 second timeout
      
      webSocket.onopen = () => {
        debugLog('Connected to server successfully');
        clearTimeout(connectionTimeout);
        isConnected = true;
        reconnectAttempts = 0;
        
        // Update connection status
        chrome.storage.local.set({ isConnected: true });
        
        // Send initial tab information after connecting
        setTimeout(sendTabsToServer, 500);
        
        resolve();
      };
      
      webSocket.onclose = (event) => {
        debugLog('WebSocket closed with code:', event.code, 'reason:', event.reason);
        clearTimeout(connectionTimeout);
        isConnected = false;
        
        // Update connection status
        chrome.storage.local.set({ isConnected: false });
        
        // Only try to reconnect if it wasn't an intentional disconnect
        if (!intentionalDisconnect && reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          debugLog('Attempting to reconnect, attempt', reconnectAttempts, 'of', maxReconnectAttempts);
          
          setTimeout(() => {
            connectToServer(serverUrl).catch((error) => {
              debugLog('Reconnection attempt failed:', error.message);
            });
          }, reconnectDelay * reconnectAttempts);
          
          reject(new Error('Connection closed, attempting to reconnect'));
        } else {
          reject(new Error('Connection closed'));
        }
      };
      
      webSocket.onerror = (error) => {
        debugLog('WebSocket error:', error);
        // Error handling is done in onclose
      };
      
      webSocket.onmessage = (event) => {
        try {
          debugLog('Received message from server:', event.data);
          const message = JSON.parse(event.data);
          
          // Handle messages from the server
          if (message.type === 'ping') {
            // Respond to ping
            if (webSocket && webSocket.readyState === WebSocket.OPEN) {
              webSocket.send(JSON.stringify({ type: 'pong' }));
            }
          } else if (message.type === 'get_tabs') {
            // Respond with current tabs
            sendTabsToServer();
          }
        } catch (error) {
          debugLog('Error processing message from server:', error);
        }
      };
    } catch (error) {
      debugLog('Error connecting to server:', error);
      isConnected = false;
      
      // Update connection status
      chrome.storage.local.set({ isConnected: false });
      
      reject(error);
    }
  });
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

// Send log to server
function sendLogToServer(log) {
  if (isConnected && webSocket && webSocket.readyState === WebSocket.OPEN) {
    try {
      const message = JSON.stringify({
        type: 'console_log',
        data: log
      });
      console.log('Sending log to server:', message.substring(0, 100) + (message.length > 100 ? '...' : ''));
      webSocket.send(message);
      return true;
    } catch (error) {
      console.error('Error sending log to server:', error);
      pendingLogs.push(log);
      return false;
    }
  } else {
    console.log('Not connected to server, adding log to pending logs');
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
        favIconUrl: tab.favIconUrl || 'default-favicon.png'
      }));
      
      debugLog('Sending tabs to server:', formattedTabs.length, 'tabs');
      
      const message = {
        type: 'tabs_response',
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
    
    // Send log to server
    sendLogToServer(message.log);
    
    sendResponse({ success: true });
  } else if (message.action === 'connect') {
    connectToServer(message.serverUrl)
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
    return true;
  } else if (message.action === 'navigationEvent') {
    // Store navigation event
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId) {
      console.log('Navigation event in tab', tabId, ':', message.url);
      
      // You could store navigation history here if needed
      // For now, we just log it
    }
    sendResponse({ success: true });
    return true;
  } else if (message.action === 'checkConnection') {
    // Check if we're connected and reconnect if not
    if (!isConnected && !connectionInProgress && !reconnectTimer) {
      console.log('Connection check requested, reconnecting...');
      getServerUrl().then(serverUrl => {
        connectToServer(serverUrl);
      });
    }
    sendResponse({ isConnected, connectionInProgress, reconnectAttempts });
    return true;
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
    console.log('Periodic connection check, reconnecting...');
    getServerUrl().then(serverUrl => {
      connectToServer(serverUrl);
    });
  }
}, 60000); // Check every minute

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message:', message);
  
  if (message.action === 'connect') {
    connectToServer(message.serverUrl)
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
  }
});
