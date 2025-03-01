// DOM Elements
let statusDot;
let connectionStatus;
let serverUrlInput;
let connectBtn;
let sendTabsBtn;

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
  // Get DOM elements
  statusDot = document.getElementById('statusDot');
  connectionStatus = document.getElementById('connectionStatus');
  serverUrlInput = document.getElementById('serverUrl');
  connectBtn = document.getElementById('connectBtn');
  sendTabsBtn = document.getElementById('sendTabsBtn');
  
  // Load saved server URL
  chrome.storage.local.get(['serverUrl', 'isConnected'], (result) => {
    if (result.serverUrl) {
      serverUrlInput.value = result.serverUrl;
    }
    
    // Update connection status
    updateConnectionStatus(result.isConnected || false);
  });
  
  // Add event listeners
  connectBtn.addEventListener('click', handleConnectClick);
  sendTabsBtn.addEventListener('click', sendTabs);
  
  // Check connection status when popup opens
  chrome.runtime.sendMessage({ action: 'getConnectionStatus' }, (response) => {
    if (response && response.isConnected !== undefined) {
      updateConnectionStatus(response.isConnected);
    }
  });
});

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

// Update connection status UI
function updateConnectionStatus(isConnected) {
  if (isConnected) {
    statusDot.classList.add('connected');
    connectionStatus.textContent = 'Connected';
    connectBtn.textContent = 'Disconnect';
    sendTabsBtn.disabled = false;
  } else {
    statusDot.classList.remove('connected');
    connectionStatus.textContent = 'Disconnected';
    connectBtn.textContent = 'Connect';
    sendTabsBtn.disabled = true;
  }
  
  // Save connection status
  chrome.storage.local.set({ isConnected });
}
