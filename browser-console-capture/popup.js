// DOM Elements
let statusDot;
let connectionStatus;
let serverUrlInput;
let connectBtn;
let sendTabsBtn;
let trackingModeToggle;
let debugInfo;

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
  // Get DOM elements
  statusDot = document.getElementById('statusDot');
  connectionStatus = document.getElementById('connectionStatus');
  serverUrlInput = document.getElementById('serverUrl');
  connectBtn = document.getElementById('connectBtn');
  sendTabsBtn = document.getElementById('sendTabsBtn');
  trackingModeToggle = document.getElementById('trackingModeToggle');
  debugInfo = document.getElementById('debugInfo');
  
  // Load saved server URL and tracking mode
  chrome.storage.local.get(['serverUrl', 'isConnected', 'trackingMode'], (result) => {
    if (result.serverUrl) {
      serverUrlInput.value = result.serverUrl;
    }
    
    // Update connection status
    updateConnectionStatus(result.isConnected || false);
    
    // Update tracking mode toggle
    if (trackingModeToggle) {
      trackingModeToggle.checked = result.trackingMode === 'all';
      trackingModeToggle.addEventListener('change', handleTrackingModeChange);
    }
    
    // Display debug info
    updateDebugInfo();
  });
  
  // Add event listeners
  connectBtn.addEventListener('click', handleConnectClick);
  sendTabsBtn.addEventListener('click', sendTabs);
  
  // Add test log button event listener
  document.getElementById('sendTestLogBtn').addEventListener('click', sendTestLog);
  
  // Add force reconnect button event listener
  document.getElementById('forceReconnectBtn').addEventListener('click', forceReconnect);
  
  // Check connection status when popup opens
  chrome.runtime.sendMessage({ action: 'getConnectionStatus' }, (response) => {
    if (response && response.isConnected !== undefined) {
      updateConnectionStatus(response.isConnected);
      console.log('Current connection status:', response.isConnected ? 'Connected' : 'Disconnected');
    }
  });
  
  // Add debug button event listener
  document.getElementById('debugBtn').addEventListener('click', () => {
    updateDebugInfo();
  });
});

// Handle tracking mode change
function handleTrackingModeChange() {
  const trackingMode = trackingModeToggle.checked ? 'all' : 'selected';
  console.log('Changing tracking mode to:', trackingMode);
  
  chrome.runtime.sendMessage({ 
    action: 'updateTrackingMode', 
    trackingMode 
  }, (response) => {
    if (response && response.success) {
      console.log('Tracking mode updated successfully');
    } else {
      console.error('Failed to update tracking mode');
    }
  });
}

// Handle connect/disconnect button click
function handleConnectClick() {
  chrome.storage.local.get(['isConnected'], (result) => {
    const isConnected = result.isConnected || false;
    
    if (isConnected) {
      // Disconnect
      chrome.runtime.sendMessage({ action: 'disconnect' }, (response) => {
        updateConnectionStatus(false);
        console.log('Disconnected from server');
      });
    } else {
      // Connect
      const serverUrl = serverUrlInput.value.trim();
      if (!serverUrl) {
        alert('Please enter a server URL');
        return;
      }
      
      // Save server URL
      chrome.storage.local.set({ serverUrl });
      
      // Send connect message to background script
      chrome.runtime.sendMessage({ 
        action: 'connect', 
        serverUrl 
      }, (response) => {
        if (response && response.success) {
          updateConnectionStatus(true);
          console.log('Connected to server:', serverUrl);
        } else {
          updateConnectionStatus(false);
          console.error('Failed to connect:', response?.error || 'Unknown error');
        }
      });
    }
  });
}

// Send tabs to server manually
function sendTabs() {
  console.log('Manually sending tabs to server');
  chrome.runtime.sendMessage({ action: 'sendTabs' }, (response) => {
    if (response && response.success) {
      console.log('Tabs sent successfully');
    } else {
      console.error('Failed to send tabs:', response?.error || 'Unknown error');
    }
  });
}

// Send a test log
function sendTestLog() {
  console.log('Sending test log...');
  
  chrome.runtime.sendMessage({ action: 'sendTestLog' }, (response) => {
    if (response && response.success) {
      console.log('Test log sent successfully');
      
      // Update debug info to show the test log was sent
      const debugInfo = document.getElementById('debugInfo');
      if (debugInfo) {
        const timestamp = new Date().toISOString();
        debugInfo.textContent = `[${timestamp}] Test log sent successfully\n` + debugInfo.textContent;
      }
    } else {
      console.error('Failed to send test log');
      
      // Update debug info to show the test log failed
      const debugInfo = document.getElementById('debugInfo');
      if (debugInfo) {
        const timestamp = new Date().toISOString();
        debugInfo.textContent = `[${timestamp}] Failed to send test log\n` + debugInfo.textContent;
      }
    }
  });
}

// Force reconnect to server
function forceReconnect() {
  console.log('Forcing reconnection to server...');
  
  // Update UI to show reconnecting
  updateConnectionStatus(false, 'Reconnecting...');
  
  chrome.runtime.sendMessage({ action: 'forceReconnect' }, (response) => {
    if (response && response.success) {
      console.log('Reconnection successful');
      updateConnectionStatus(true);
      
      // Update debug info to show reconnection was successful
      const debugInfo = document.getElementById('debugInfo');
      if (debugInfo) {
        const timestamp = new Date().toISOString();
        debugInfo.textContent = `[${timestamp}] Reconnection successful\n` + debugInfo.textContent;
      }
    } else {
      console.error('Reconnection failed:', response ? response.error : 'Unknown error');
      updateConnectionStatus(false);
      
      // Update debug info to show reconnection failed
      const debugInfo = document.getElementById('debugInfo');
      if (debugInfo) {
        const timestamp = new Date().toISOString();
        debugInfo.textContent = `[${timestamp}] Reconnection failed: ${response ? response.error : 'Unknown error'}\n` + debugInfo.textContent;
      }
    }
    
    // Update debug info after reconnection attempt
    updateDebugInfo();
  });
}

// Update connection status with optional status text
function updateConnectionStatus(isConnected, statusText) {
  if (statusDot && connectionStatus) {
    if (isConnected) {
      statusDot.classList.add('connected');
      connectionStatus.textContent = statusText || 'Connected';
      connectBtn.textContent = 'Disconnect';
      sendTabsBtn.disabled = false;
    } else {
      statusDot.classList.remove('connected');
      connectionStatus.textContent = statusText || 'Disconnected';
      connectBtn.textContent = 'Connect';
      sendTabsBtn.disabled = true;
    }
  }
  
  // Save connection status
  chrome.storage.local.set({ isConnected });
}

// Update debug info
function updateDebugInfo() {
  chrome.runtime.sendMessage({ action: 'getDebugInfo' }, (response) => {
    if (response) {
      const debugInfo = document.getElementById('debugInfo');
      if (debugInfo) {
        const timestamp = new Date().toISOString();
        let info = `[${timestamp}] Debug Info:\n`;
        info += `Connected: ${response.isConnected}\n`;
        info += `WebSocket State: ${getWebSocketStateName(response.webSocketState)}\n`;
        info += `Server URL: ${response.serverUrl}\n`;
        info += `Reconnect Attempts: ${response.reconnectAttempts}/${response.maxReconnectAttempts}\n`;
        info += `Tracking Mode: ${response.trackingMode}\n`;
        info += `Debug Mode: ${response.debugMode}\n`;
        info += `Pending Logs: ${response.pendingLogs}\n`;
        
        debugInfo.textContent = info + debugInfo.textContent;
      }
    }
  });
}

// Get WebSocket state name
function getWebSocketStateName(state) {
  switch (state) {
    case 0: return 'CONNECTING';
    case 1: return 'OPEN';
    case 2: return 'CLOSING';
    case 3: return 'CLOSED';
    default: return `UNKNOWN (${state})`;
  }
}
