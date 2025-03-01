// Store original console methods
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.debug
};

// Array to store captured logs
let capturedLogs = [];

// Tab tracking settings
let trackingMode = 'all'; // 'all' or 'selected'
let isTabTracked = true;  // Whether this specific tab is tracked

// Flag to control capturing
let isCapturing = true;

// Tab navigation history
let navigationHistory = [];
const MAX_HISTORY_LENGTH = 10;

// Function to capture timestamp
function getTimestamp() {
  const now = new Date();
  return now.toISOString();
}

// Function to get stack trace
function getStackTrace() {
  try {
    throw new Error();
  } catch (error) {
    return error.stack.split('\n').slice(2).join('\n');
  }
}

// Function to check if this tab should be captured
function shouldCaptureTab() {
  // If capturing is disabled globally, don't capture
  if (!isCapturing) return false;
  
  // If tracking mode is 'all', capture all tabs
  if (trackingMode === 'all') return true;
  
  // If tracking mode is 'selected', only capture if this tab is tracked
  return isTabTracked;
}

// Function to record navigation
function recordNavigation(url) {
  // Add to navigation history
  navigationHistory.unshift({
    url,
    timestamp: getTimestamp()
  });
  
  // Limit history length
  if (navigationHistory.length > MAX_HISTORY_LENGTH) {
    navigationHistory.pop();
  }
  
  // Send navigation event to background script
  chrome.runtime.sendMessage({
    action: 'navigationEvent',
    url,
    tabId: chrome.runtime.id, // This is not the tab ID, but it helps identify the context
    timestamp: getTimestamp()
  }).catch(() => {
    // Ignore errors
  });
}

// Function to capture console logs
function captureConsole(type, args) {
  // Skip if this tab should not be captured
  if (!shouldCaptureTab()) return;
  
  // Skip our own debug messages to avoid infinite loops
  if (args[0] === '[DEBUG]') return;
  
  const timestamp = getTimestamp();
  const stackTrace = getStackTrace();
  
  // Convert arguments to array and handle circular references
  const serializedArgs = Array.from(args).map(arg => {
    try {
      if (typeof arg === 'object' && arg !== null) {
        return JSON.stringify(arg);
      }
      return String(arg);
    } catch (e) {
      return `[Object with circular reference or non-serializable content]`;
    }
  });

  // Create log entry
  const logEntry = {
    type,
    timestamp,
    message: serializedArgs.join(' '),
    stackTrace,
    url: window.location.href,
    navigationHistory: navigationHistory.slice(0, 3) // Include recent navigation history
  };

  // Add to captured logs
  capturedLogs.push(logEntry);
  
  // Debug: Log that we captured something
  originalConsole.log('[DEBUG] Captured a', type, 'message:', serializedArgs.join(' ').substring(0, 50) + (serializedArgs.join(' ').length > 50 ? '...' : ''));
  
  // Send to background script
  chrome.runtime.sendMessage({
    action: 'capturedLog',
    log: logEntry
  }, response => {
    if (chrome.runtime.lastError) {
      originalConsole.error('[DEBUG] Error sending log to background script:', chrome.runtime.lastError);
    } else if (response && response.success) {
      originalConsole.log('[DEBUG] Successfully sent log to background script');
    }
  });
}

// Override console methods
console.log = function() {
  captureConsole('log', arguments);
  originalConsole.log.apply(console, arguments);
};

console.error = function() {
  captureConsole('error', arguments);
  originalConsole.error.apply(console, arguments);
};

console.warn = function() {
  captureConsole('warn', arguments);
  originalConsole.warn.apply(console, arguments);
};

console.info = function() {
  captureConsole('info', arguments);
  originalConsole.info.apply(console, arguments);
};

console.debug = function() {
  captureConsole('debug', arguments);
  originalConsole.debug.apply(console, arguments);
};

// Load tab tracking settings
function loadTabTrackingSettings() {
  chrome.storage.local.get(['trackingMode', 'trackedTabs', 'isCapturing'], (result) => {
    trackingMode = result.trackingMode || 'all';
    isCapturing = result.isCapturing !== false;
    
    // Check if this tab is tracked
    if (result.trackedTabs) {
      // We need to get the current tab ID
      chrome.runtime.sendMessage({ action: 'getCurrentTabId' }, (response) => {
        if (response && response.tabId) {
          isTabTracked = result.trackedTabs[response.tabId] !== false;
          
          originalConsole.log('[DEBUG] Tab tracking settings loaded:', 
            'mode =', trackingMode, 
            'tabId =', response.tabId,
            'isTracked =', isTabTracked,
            'isCapturing =', isCapturing);
        }
      });
    } else {
      isTabTracked = true;
    }
  });
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getLogs') {
    sendResponse({ logs: capturedLogs });
  } else if (message.action === 'clearLogs') {
    capturedLogs = [];
    sendResponse({ success: true });
  } else if (message.action === 'startCapturing') {
    isCapturing = true;
    sendResponse({ success: true });
  } else if (message.action === 'stopCapturing') {
    isCapturing = false;
    sendResponse({ success: true });
  } else if (message.action === 'updateTabTracking') {
    isTabTracked = message.isTracked;
    sendResponse({ success: true });
  } else if (message.action === 'updateTrackingMode') {
    trackingMode = message.trackingMode;
    sendResponse({ success: true });
  }
  return true; // Required for async response
});

// Capture uncaught errors
window.addEventListener('error', function(event) {
  captureConsole('uncaught', [
    `Uncaught ${event.error?.name || 'Error'}: ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`
  ]);
});

// Capture unhandled promise rejections
window.addEventListener('unhandledrejection', function(event) {
  let message = 'Unhandled Promise Rejection';
  if (event.reason) {
    if (typeof event.reason === 'string') {
      message += ': ' + event.reason;
    } else if (event.reason.message) {
      message += ': ' + event.reason.message;
    }
  }
  captureConsole('unhandledrejection', [message]);
});

// Track page navigations
if (window.history && window.history.pushState) {
  // Record initial page load
  recordNavigation(window.location.href);
  
  // Override history.pushState
  const originalPushState = window.history.pushState;
  window.history.pushState = function() {
    originalPushState.apply(this, arguments);
    recordNavigation(window.location.href);
  };
  
  // Override history.replaceState
  const originalReplaceState = window.history.replaceState;
  window.history.replaceState = function() {
    originalReplaceState.apply(this, arguments);
    recordNavigation(window.location.href);
  };
  
  // Listen for popstate events
  window.addEventListener('popstate', function() {
    recordNavigation(window.location.href);
  });
}

// Listen for hashchange events
window.addEventListener('hashchange', function() {
  recordNavigation(window.location.href);
});

// Load tab tracking settings when content script is loaded
loadTabTrackingSettings();

// Notify that the content script is loaded
console.log('%c[Browser Console Capture] Content script loaded and capturing console logs', 'color: #4CAF50; font-weight: bold');
