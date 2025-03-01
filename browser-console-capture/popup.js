// DOM Elements
let statusDot;
let connectionStatus;
let serverUrlInput;
let connectBtn;
let sendTabsBtn;
let trackingModeToggle;
let debugInfo;
let tabsList;
let refreshTabsBtn;

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
  tabsList = document.getElementById('tabsList');
  refreshTabsBtn = document.getElementById('refreshTabsBtn');
  
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
    
    // Load tabs
    loadTabs();
  });
  
  // Add event listeners
  connectBtn.addEventListener('click', handleConnectClick);
  sendTabsBtn.addEventListener('click', sendTabs);
  refreshTabsBtn.addEventListener('click', loadTabs);
  
  // Add test log button event listener
  document.getElementById('sendTestLogBtn').addEventListener('click', sendTestLog);
  
  // Add force reconnect button event listener
  document.getElementById('forceReconnectBtn').addEventListener('click', forceReconnect);
  
  // Add debug refresh button event listener
  document.getElementById('debugBtn').addEventListener('click', updateDebugInfo);
  
  // Check connection status when popup opens
  checkConnection();
});

// Handle tracking mode change
function handleTrackingModeChange() {
  const newMode = trackingModeToggle.checked ? 'all' : 'selected';
  console.log('Changing tracking mode to:', newMode);
  
  chrome.runtime.sendMessage({ 
    action: 'updateTrackingMode', 
    trackingMode: newMode 
  }, (response) => {
    if (response && response.success) {
      console.log('Tracking mode updated successfully');
      
      // Reload tabs to update UI
      loadTabs();
    } else {
      console.error('Failed to update tracking mode');
    }
  });
}

// Check connection status
function checkConnection() {
  chrome.runtime.sendMessage({ action: 'checkConnection' }, (response) => {
    if (response) {
      updateConnectionStatus(response.isConnected);
    }
  });
}

// Handle connect/disconnect button click
function handleConnectClick() {
  chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
    const isConnected = response && response.isConnected;
    
    if (isConnected) {
      // Disconnect from server
      chrome.runtime.sendMessage({ action: 'disconnect' }, (response) => {
        if (response && response.success) {
          updateConnectionStatus(false);
          console.log('Disconnected from server');
        } else {
          console.error('Failed to disconnect:', response?.error || 'Unknown error');
        }
      });
    } else {
      // Connect to server
      const serverUrl = serverUrlInput.value.trim();
      if (!serverUrl) {
        console.error('Server URL is required');
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
          
          // Load tabs after connecting
          loadTabs();
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
      
      // Reload tabs after reconnecting
      loadTabs();
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
  chrome.runtime.sendMessage({ action: 'checkConnection' }, (response) => {
    if (response) {
      // Get tracking settings
      chrome.storage.local.get(['trackingMode', 'trackedTabs', 'isCapturing'], (result) => {
        const debugText = `
Connection Status: ${response.isConnected ? 'Connected' : 'Disconnected'}
Connection In Progress: ${response.connectionInProgress ? 'Yes' : 'No'}
Reconnect Attempts: ${response.reconnectAttempts}
WebSocket State: ${response.wsStateText} (${response.wsState})
Server URL: ${response.serverUrl || 'Not set'}
Tracking Mode: ${result.trackingMode || 'all'} (only local websites)
Is Capturing: ${result.isCapturing !== false ? 'Yes' : 'No'}
Tracked Local Tabs: ${JSON.stringify(result.trackedTabs || {})}
        `;
        
        debugInfo.textContent = debugText;
      });
    } else {
      debugInfo.textContent = 'Failed to get connection status';
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

// Load tabs
function loadTabs() {
  console.log('Loading tabs...');
  
  // Show loading state
  tabsList.innerHTML = '<div class="no-tabs">Loading tabs...</div>';
  
  // Query for tabs
  chrome.tabs.query({}, (tabs) => {
    // Filter for local tabs
    const localTabs = tabs.filter(tab => {
      if (!tab.url) return false;
      
      try {
        const url = new URL(tab.url);
        return url.hostname === 'localhost' || 
               url.hostname === '127.0.0.1' || 
               url.hostname.endsWith('.local') ||
               url.hostname.endsWith('.localhost');
      } catch (e) {
        return false;
      }
    });
    
    // Get tracking settings
    chrome.storage.local.get(['trackingMode', 'trackedTabs'], (result) => {
      const trackingMode = result.trackingMode || 'all';
      const trackedTabs = result.trackedTabs || {};
      
      if (localTabs.length === 0) {
        tabsList.innerHTML = '<div class="no-tabs">No local tabs found</div>';
        return;
      }
      
      // Clear the list
      tabsList.innerHTML = '';
      
      // Add each tab to the list
      localTabs.forEach(tab => {
        const tabItem = document.createElement('div');
        tabItem.className = 'tab-item';
        
        // Determine if this tab is tracked
        const isTracked = trackingMode === 'all' ? true : (trackedTabs[tab.id] !== false);
        
        // Create favicon
        const favicon = document.createElement('img');
        favicon.className = 'tab-favicon';
        favicon.src = tab.favIconUrl || 'images/icon.svg';
        favicon.onerror = () => { favicon.src = 'images/icon.svg'; };
        
        // Create title/url container
        const titleContainer = document.createElement('div');
        titleContainer.style.flexGrow = '1';
        
        // Create title
        const title = document.createElement('div');
        title.className = 'tab-title';
        title.textContent = tab.title || 'Untitled Tab';
        
        // Create URL
        const url = document.createElement('div');
        url.className = 'tab-url';
        url.textContent = tab.url;
        
        // Add title and URL to container
        titleContainer.appendChild(title);
        titleContainer.appendChild(url);
        
        // Create toggle switch
        const toggleContainer = document.createElement('label');
        toggleContainer.className = 'toggle-switch';
        toggleContainer.style.marginLeft = '8px';
        
        const toggleInput = document.createElement('input');
        toggleInput.type = 'checkbox';
        toggleInput.checked = isTracked;
        toggleInput.disabled = trackingMode === 'all'; // Disable if tracking all
        
        // Add event listener to toggle
        toggleInput.addEventListener('change', () => {
          updateTabTracking(tab.id, toggleInput.checked);
        });
        
        const toggleSlider = document.createElement('span');
        toggleSlider.className = 'toggle-slider';
        
        // Add elements to toggle container
        toggleContainer.appendChild(toggleInput);
        toggleContainer.appendChild(toggleSlider);
        
        // Add elements to tab item
        tabItem.appendChild(favicon);
        tabItem.appendChild(titleContainer);
        tabItem.appendChild(toggleContainer);
        
        // Add tab item to list
        tabsList.appendChild(tabItem);
      });
    });
  });
}

// Update tab tracking
function updateTabTracking(tabId, isTracked) {
  console.log('Updating tab tracking:', tabId, isTracked);
  
  chrome.runtime.sendMessage({ 
    action: 'updateTabTracking', 
    tabId, 
    isTracked 
  }, (response) => {
    if (response && response.success) {
      console.log('Tab tracking updated successfully');
    } else {
      console.error('Failed to update tab tracking:', response?.error || 'Unknown error');
    }
  });
}
