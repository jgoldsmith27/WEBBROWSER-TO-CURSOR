const vscode = require('vscode');
const WebSocket = require('ws');

// Store extension state
let context;
let webSocket;
let isConnected = false;
let logs = [];
let statusBarItem;
let logsProvider;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectDelay = 2000; // 2 seconds

// Log types and their colors
const logTypeColors = {
  log: '#FFFFFF',
  info: '#64B5F6',
  warn: '#FFD54F',
  error: '#E57373',
  debug: '#81C784',
  uncaught: '#E57373',
  unhandledrejection: '#E57373'
};

// TreeDataProvider for console logs
class ConsoleLogsProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren() {
    if (logs.length === 0) {
      return [new vscode.TreeItem('No logs available')];
    }
    
    return logs.map((log, index) => {
      const treeItem = new vscode.TreeItem(this.formatLogMessage(log));
      treeItem.id = `log-${index}`;
      treeItem.tooltip = this.formatLogTooltip(log);
      treeItem.command = {
        command: 'cursor-console-viewer.showLogDetails',
        title: 'Show Log Details',
        arguments: [log]
      };
      
      // Set icon based on log type
      treeItem.iconPath = new vscode.ThemeIcon(this.getIconForLogType(log.type));
      
      return treeItem;
    });
  }

  formatLogMessage(log) {
    // Truncate message if it's too long
    const maxLength = 100;
    let message = log.message || '';
    if (message.length > maxLength) {
      message = message.substring(0, maxLength) + '...';
    }
    
    return `[${log.type}] ${message}`;
  }

  formatLogTooltip(log) {
    return `Type: ${log.type}
Timestamp: ${log.timestamp}
URL: ${log.url}
Message: ${log.message}`;
  }

  getIconForLogType(type) {
    switch (type) {
      case 'error':
      case 'uncaught':
      case 'unhandledrejection':
        return 'error';
      case 'warn':
        return 'warning';
      case 'info':
        return 'info';
      case 'debug':
        return 'debug';
      default:
        return 'output';
    }
  }
}

// Connect to WebSocket server
function connectToServer() {
  const config = vscode.workspace.getConfiguration('cursor-console-viewer');
  const serverUrl = config.get('serverUrl');
  
  if (!serverUrl) {
    vscode.window.showErrorMessage('Server URL is not configured');
    return;
  }
  
  // Add clientType parameter to URL
  const url = new URL(serverUrl);
  url.searchParams.set('clientType', 'cursor');
  const fullUrl = url.toString();
  
  try {
    if (webSocket) {
      webSocket.close();
    }
    
    webSocket = new WebSocket(fullUrl);
    
    updateStatusBar('Connecting...');
    
    webSocket.on('open', () => {
      isConnected = true;
      reconnectAttempts = 0;
      updateStatusBar('Connected');
      vscode.window.showInformationMessage('Connected to console server');
    });
    
    webSocket.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        
        if (message.type === 'welcome') {
          vscode.window.showInformationMessage(message.message);
        } else if (message.type === 'logs') {
          logs = message.data;
          logsProvider.refresh();
        } else if (message.type === 'console_log') {
          logs.push(message.data);
          logsProvider.refresh();
        } else if (message.type === 'logs_cleared') {
          logs = [];
          logsProvider.refresh();
          vscode.window.showInformationMessage('Console logs cleared');
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    });
    
    webSocket.on('close', () => {
      isConnected = false;
      updateStatusBar('Disconnected');
      
      // Try to reconnect
      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        updateStatusBar(`Reconnecting (${reconnectAttempts}/${maxReconnectAttempts})...`);
        
        setTimeout(() => {
          connectToServer();
        }, reconnectDelay);
      }
    });
    
    webSocket.on('error', (error) => {
      console.error('WebSocket error:', error);
      isConnected = false;
      updateStatusBar('Error');
      vscode.window.showErrorMessage(`Failed to connect to console server: ${error.message}`);
    });
  } catch (error) {
    console.error('Error connecting to server:', error);
    isConnected = false;
    updateStatusBar('Error');
    vscode.window.showErrorMessage(`Failed to connect to console server: ${error.message}`);
  }
}

// Disconnect from WebSocket server
function disconnectFromServer() {
  if (webSocket) {
    webSocket.close();
  }
  
  isConnected = false;
  updateStatusBar('Disconnected');
  vscode.window.showInformationMessage('Disconnected from console server');
}

// Update status bar
function updateStatusBar(text) {
  if (statusBarItem) {
    statusBarItem.text = `$(globe) Console: ${text}`;
    statusBarItem.show();
  }
}

// Show log details in a new editor
function showLogDetails(log) {
  const panel = vscode.window.createWebviewPanel(
    'consoleLogDetails',
    'Console Log Details',
    vscode.ViewColumn.One,
    {
      enableScripts: true
    }
  );
  
  panel.webview.html = getLogDetailsHtml(log);
}

// Generate HTML for log details
function getLogDetailsHtml(log) {
  const color = logTypeColors[log.type] || '#FFFFFF';
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Console Log Details</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      color: var(--vscode-foreground);
    }
    
    h1 {
      font-size: 1.5em;
      margin-bottom: 20px;
      color: ${color};
    }
    
    .log-property {
      margin-bottom: 15px;
    }
    
    .property-name {
      font-weight: bold;
      margin-bottom: 5px;
    }
    
    .property-value {
      padding: 10px;
      background-color: var(--vscode-editor-background);
      border-radius: 3px;
      overflow-x: auto;
      white-space: pre-wrap;
    }
    
    .timestamp {
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
    }
    
    .stack-trace {
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      white-space: pre;
    }
  </style>
</head>
<body>
  <h1>[${log.type}] Console Log Details</h1>
  
  <div class="log-property">
    <div class="property-name">Message</div>
    <div class="property-value">${escapeHtml(log.message)}</div>
  </div>
  
  <div class="log-property">
    <div class="property-name">Timestamp</div>
    <div class="property-value timestamp">${log.timestamp}</div>
  </div>
  
  <div class="log-property">
    <div class="property-name">URL</div>
    <div class="property-value">${log.url}</div>
  </div>
  
  <div class="log-property">
    <div class="property-name">Stack Trace</div>
    <div class="property-value stack-trace">${escapeHtml(log.stackTrace || 'Not available')}</div>
  </div>
</body>
</html>`;
}

// Escape HTML
function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') {
    return '';
  }
  
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Clear logs
function clearLogs() {
  if (isConnected && webSocket) {
    webSocket.send(JSON.stringify({
      type: 'clear_logs'
    }));
  } else {
    logs = [];
    logsProvider.refresh();
    vscode.window.showInformationMessage('Console logs cleared');
  }
}

// Activate extension
function activate(extensionContext) {
  context = extensionContext;
  
  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'cursor-console-viewer.openConsoleViewer';
  context.subscriptions.push(statusBarItem);
  updateStatusBar('Disconnected');
  
  // Create logs provider
  logsProvider = new ConsoleLogsProvider();
  const treeView = vscode.window.createTreeView('cursor-console-logs', {
    treeDataProvider: logsProvider
  });
  context.subscriptions.push(treeView);
  
  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('cursor-console-viewer.openConsoleViewer', () => {
      vscode.commands.executeCommand('workbench.view.extension.cursor-console-viewer');
    }),
    
    vscode.commands.registerCommand('cursor-console-viewer.connect', () => {
      connectToServer();
    }),
    
    vscode.commands.registerCommand('cursor-console-viewer.disconnect', () => {
      disconnectFromServer();
    }),
    
    vscode.commands.registerCommand('cursor-console-viewer.clearLogs', () => {
      clearLogs();
    }),
    
    vscode.commands.registerCommand('cursor-console-viewer.showLogDetails', (log) => {
      showLogDetails(log);
    })
  );
  
  // Auto-connect if enabled
  const config = vscode.workspace.getConfiguration('cursor-console-viewer');
  if (config.get('autoConnect')) {
    connectToServer();
  }
}

// Deactivate extension
function deactivate() {
  if (webSocket) {
    webSocket.close();
  }
  
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}

module.exports = {
  activate,
  deactivate
}; 