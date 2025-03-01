// Store original console methods
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.debug,
  trace: console.trace,
  assert: console.assert,
  dir: console.dir,
  dirxml: console.dirxml,
  group: console.group,
  groupCollapsed: console.groupCollapsed,
  groupEnd: console.groupEnd,
  time: console.time,
  timeEnd: console.timeEnd,
  timeLog: console.timeLog,
  table: console.table,
  count: console.count,
  countReset: console.countReset,
  clear: console.clear
};

// Array to store captured logs
let capturedLogs = [];

// Tab tracking settings - initialize with default values
let trackingMode = 'all'; // 'all' or 'selected'
let isTabTracked = true;  // Whether this specific tab is tracked
let currentTabId = null;  // Store the current tab ID
let isCapturing = true;   // Flag to control capturing
let settingsLoaded = false; // Flag to track if settings have been loaded

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
  if (!isCapturing) {
    originalConsole.log('[DEBUG] Not capturing because global capturing is disabled');
    return false;
  }
  
  // Only capture locally hosted websites
  try {
    const url = window.location.href;
    const parsedUrl = new URL(url);
    const isLocalUrl = parsedUrl.hostname === 'localhost' || 
                       parsedUrl.hostname === '127.0.0.1' || 
                       parsedUrl.hostname.endsWith('.local') ||
                       parsedUrl.hostname.endsWith('.localhost');
    
    if (!isLocalUrl) {
      originalConsole.log('[DEBUG] Not capturing because this is not a locally hosted website:', parsedUrl.hostname);
      return false;
    }
  } catch (e) {
    originalConsole.log('[DEBUG] Error parsing URL:', e);
    return false;
  }
  
  // If tracking mode is 'all', capture all tabs
  if (trackingMode === 'all') {
    originalConsole.log('[DEBUG] Capturing because tracking mode is "all"');
    return true;
  }
  
  // If tracking mode is 'selected', only capture if this tab is tracked
  originalConsole.log('[DEBUG] Tracking mode is "selected", isTabTracked =', isTabTracked);
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
    timestamp: getTimestamp()
  }).catch(() => {
    // Ignore errors
  });
}

// Function to capture console logs
function captureConsole(type, args) {
  // Skip if this tab should not be captured
  if (!shouldCaptureTab()) {
    originalConsole.log('[DEBUG] Skipping capture for this tab - not tracked, URL =', window.location.href);
    return;
  }
  
  // Skip our own debug messages to avoid infinite loops
  if (args.length > 0 && args[0] === '[DEBUG]') return;
  
  const timestamp = getTimestamp();
  const stackTrace = getStackTrace();
  
  // Convert arguments to serializable format
  const serializedArgs = [];
  for (let i = 0; i < args.length; i++) {
    try {
      if (args[i] === undefined) {
        serializedArgs.push('undefined');
      } else if (args[i] === null) {
        serializedArgs.push('null');
      } else if (typeof args[i] === 'function') {
        serializedArgs.push(`function ${args[i].name || 'anonymous'}() {...}`);
      } else if (typeof args[i] === 'object') {
        try {
          serializedArgs.push(JSON.stringify(args[i]));
        } catch (e) {
          serializedArgs.push(`[Object ${args[i].constructor.name}]`);
        }
      } else {
        serializedArgs.push(String(args[i]));
      }
    } catch (e) {
      serializedArgs.push(`[Error serializing argument: ${e.message}]`);
    }
  }
  
  // Create log entry
  const logEntry = {
    type,
    timestamp,
    message: serializedArgs.join(' '),
    stackTrace,
    url: window.location.href,
    tabId: currentTabId
  };
  
  // Debug: Log that we captured something
  originalConsole.log('[DEBUG] Captured a', type, 'message:', serializedArgs.join(' ').substring(0, 50) + (serializedArgs.join(' ').length > 50 ? '...' : ''), 'URL =', window.location.href);
  
  // Send to background script with retry mechanism
  sendLogToBackground(logEntry);
}

// Function to send log to background script with retry
function sendLogToBackground(logEntry, retryCount = 0) {
  const maxRetries = 3;
  
  originalConsole.log('[DEBUG] Attempting to send log to background script, URL =', window.location.href, 'type =', logEntry.type);
  
  chrome.runtime.sendMessage({
    action: 'capturedLog',
    log: logEntry
  }, response => {
    if (chrome.runtime.lastError) {
      originalConsole.error('[DEBUG] Error sending log to background script:', chrome.runtime.lastError, 'URL =', window.location.href);
      
      // Retry a few times with exponential backoff
      if (retryCount < maxRetries) {
        originalConsole.log('[DEBUG] Retrying send log, attempt', retryCount + 1, 'of', maxRetries);
        setTimeout(() => {
          sendLogToBackground(logEntry, retryCount + 1);
        }, Math.pow(2, retryCount) * 500); // 500ms, 1s, 2s
      }
    } else if (response && response.success) {
      originalConsole.log('[DEBUG] Successfully sent log to background script, URL =', window.location.href);
    } else {
      originalConsole.error('[DEBUG] Received unsuccessful response from background script:', response);
    }
  });
}

// Override console methods immediately to ensure we capture everything
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

console.trace = function() {
  captureConsole('trace', arguments);
  originalConsole.trace.apply(console, arguments);
};

console.assert = function() {
  captureConsole('assert', arguments);
  originalConsole.assert.apply(console, arguments);
};

console.dir = function() {
  captureConsole('dir', arguments);
  originalConsole.dir.apply(console, arguments);
};

console.dirxml = function() {
  captureConsole('dirxml', arguments);
  originalConsole.dirxml.apply(console, arguments);
};

console.group = function() {
  captureConsole('group', arguments);
  originalConsole.group.apply(console, arguments);
};

console.groupCollapsed = function() {
  captureConsole('groupCollapsed', arguments);
  originalConsole.groupCollapsed.apply(console, arguments);
};

console.groupEnd = function() {
  captureConsole('groupEnd', arguments);
  originalConsole.groupEnd.apply(console, arguments);
};

console.time = function() {
  captureConsole('time', arguments);
  originalConsole.time.apply(console, arguments);
};

console.timeEnd = function() {
  captureConsole('timeEnd', arguments);
  originalConsole.timeEnd.apply(console, arguments);
};

console.timeLog = function() {
  captureConsole('timeLog', arguments);
  originalConsole.timeLog.apply(console, arguments);
};

console.table = function() {
  captureConsole('table', arguments);
  originalConsole.table.apply(console, arguments);
};

console.count = function() {
  captureConsole('count', arguments);
  originalConsole.count.apply(console, arguments);
};

console.countReset = function() {
  captureConsole('countReset', arguments);
  originalConsole.countReset.apply(console, arguments);
};

console.clear = function() {
  captureConsole('clear', arguments);
  originalConsole.clear.apply(console, arguments);
};

// Function to load tab tracking settings
function loadTabTrackingSettings() {
  // If we've already tried to load settings, don't show the error again
  const showError = !settingsLoaded;
  
  originalConsole.log('[DEBUG] Loading tab tracking settings, current URL:', window.location.href);
  
  // Set a timeout for the message
  const messageTimeout = setTimeout(() => {
    if (showError) {
      originalConsole.error('[DEBUG] Failed to fetch tab tracking settings: Timeout');
    }
    // Use default settings as fallback if not already set
    if (!settingsLoaded) {
      currentTabId = currentTabId || -1;
      trackingMode = 'all';
      isCapturing = true;
      isTabTracked = true;
      settingsLoaded = true; // Mark as loaded with defaults
      originalConsole.log('[DEBUG] Using default settings due to timeout: trackingMode =', trackingMode, 'isTabTracked =', isTabTracked);
    }
  }, 3000); // 3 second timeout
  
  // First get the current tab ID
  chrome.runtime.sendMessage({ action: 'getCurrentTabId' }, (response) => {
    clearTimeout(messageTimeout);
    
    if (chrome.runtime.lastError) {
      if (showError) {
        originalConsole.error('[DEBUG] Error getting tab ID:', chrome.runtime.lastError);
      }
      // Use default settings as fallback if not already set
      if (!settingsLoaded) {
        currentTabId = currentTabId || -1;
        trackingMode = 'all';
        isCapturing = true;
        isTabTracked = true;
        settingsLoaded = true; // Mark as loaded with defaults
        originalConsole.log('[DEBUG] Using default settings due to error: trackingMode =', trackingMode, 'isTabTracked =', isTabTracked);
      }
      return;
    }
    
    if (response && response.tabId) {
      currentTabId = response.tabId;
      originalConsole.log('[DEBUG] Got tab ID:', currentTabId);
      
      // Now get the tracking settings
      chrome.storage.local.get(['trackingMode', 'trackedTabs', 'isCapturing'], (result) => {
        if (chrome.runtime.lastError) {
          if (showError) {
            originalConsole.error('[DEBUG] Error getting storage:', chrome.runtime.lastError);
          }
          // Use default settings as fallback if not already set
          if (!settingsLoaded) {
            trackingMode = 'all';
            isCapturing = true;
            isTabTracked = true;
            settingsLoaded = true; // Mark as loaded with defaults
            originalConsole.log('[DEBUG] Using default settings due to storage error: trackingMode =', trackingMode, 'isTabTracked =', isTabTracked);
          }
          return;
        }
        
        trackingMode = result.trackingMode || 'all';
        isCapturing = result.isCapturing !== false;
        
        // Check if this tab is tracked
        if (result.trackedTabs && currentTabId) {
          isTabTracked = result.trackedTabs[currentTabId] !== false;
          originalConsole.log('[DEBUG] Tab tracking status from storage:', result.trackedTabs[currentTabId]);
        } else {
          isTabTracked = true;
          originalConsole.log('[DEBUG] No specific tracking status for this tab, defaulting to tracked');
        }
        
        settingsLoaded = true; // Mark as successfully loaded
        
        originalConsole.log('[DEBUG] Tab tracking settings loaded:', 
          'mode =', trackingMode, 
          'tabId =', currentTabId,
          'isTracked =', isTabTracked,
          'isCapturing =', isCapturing,
          'URL =', window.location.href);
      });
    } else {
      if (showError) {
        originalConsole.error('[DEBUG] Could not get current tab ID');
      }
      // Use default settings as fallback if not already set
      if (!settingsLoaded) {
        currentTabId = currentTabId || -1;
        trackingMode = 'all';
        isCapturing = true;
        isTabTracked = true;
        settingsLoaded = true; // Mark as loaded with defaults
        originalConsole.log('[DEBUG] Using default settings due to missing tab ID: trackingMode =', trackingMode, 'isTabTracked =', isTabTracked);
      }
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
    originalConsole.log('[DEBUG] Tab tracking updated:', isTabTracked);
    sendResponse({ success: true });
  } else if (message.action === 'updateTrackingMode') {
    trackingMode = message.trackingMode;
    originalConsole.log('[DEBUG] Tracking mode updated:', trackingMode);
    sendResponse({ success: true });
  } else if (message.action === 'reloadSettings') {
    loadTabTrackingSettings();
    sendResponse({ success: true });
  }
  return true; // Required for async response
});

// Capture uncaught exceptions
window.addEventListener('error', function(event) {
  const errorObj = {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error
  };
  
  captureConsole('uncaught-exception', [errorObj]);
  
  // Don't prevent the default handling
  return false;
}, true);

// Capture unhandled promise rejections
window.addEventListener('unhandledrejection', function(event) {
  const rejectionObj = {
    reason: event.reason,
    promise: 'Promise rejection'
  };
  
  captureConsole('unhandled-rejection', [rejectionObj]);
  
  // Don't prevent the default handling
  return false;
}, true);

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

// Periodically check tab tracking settings (every 30 seconds)
setInterval(loadTabTrackingSettings, 30000);

// Notify that the content script is loaded
console.log('%c[Browser Console Capture] Content script loaded and capturing console logs', 'color: #4CAF50; font-weight: bold');
