# Browser Console Capture Extension

This extension captures browser console logs from locally hosted websites (localhost, 127.0.0.1) and sends them to a WebSocket server for viewing in Cursor IDE.

## Recent Fixes

- **Restricted extension to only locally hosted websites**: Updated manifest.json to only inject content scripts into localhost URLs
- Modified extension to only capture logs from locally hosted websites
- Added filtering for tabs to only show locally hosted websites
- Fixed server startup with a root-level index.js file
- Fixed issue with tab tracking settings timeout
- Added retry mechanism for sending logs to background script
- Improved message handling between content scripts and background script
- Added fallback for getting tab IDs when sender tab is not available
- Added proper async response handling for all message types
- Added ANSI color support for log-monitor.js (replacing chalk dependency)

## Components

### Browser Extension
- **background.js**: Manages WebSocket connection and communication with the server
- **content.js**: Captures console logs from web pages
- **popup.html/js**: User interface for controlling the extension

### Server
- **server.js**: WebSocket server that receives logs from the browser
- **log-monitor.js**: Command-line tool to view logs in real-time
- **test-console-types.js**: Test script to generate various console message types

## Testing

1. Start the WebSocket server from the root directory:
   ```
   node index.js
   ```

2. Open the log monitor in a separate terminal:
   ```
   cd cursor-console-server
   node log-monitor.js
   ```

3. Load the extension in Chrome:
   - Go to chrome://extensions/
   - Enable Developer mode
   - Click "Load unpacked" and select the browser-console-capture folder

4. Test with the provided test page:
   - Open test-console-errors.html in Chrome
   - Click the various buttons to generate different types of console messages

## Troubleshooting

### "Failed to fetch tab tracking settings"
This error occurs when the content script cannot communicate with the background script. The extension now includes:
- Timeout handling with fallback to default settings
- Retry mechanism for sending logs
- Improved async message handling

### Only capturing logs from localhost
The extension is designed to only capture logs from locally hosted websites (localhost, 127.0.0.1, etc.). This is intentional to focus on development environments.

## Development

To modify the extension:
1. Edit the files in the browser-console-capture folder
2. Reload the extension in chrome://extensions/
3. Test your changes

To modify the server:
1. Edit the files in the cursor-console-server folder
2. Restart the server and log monitor
3. Test your changes

## Features

- Captures console logs from locally hosted websites
- Captures open local tabs from your browser
- Sends tab information to a local server
- Displays tab information in a user-friendly interface
- Provides real-time connection status indicators

## Installation

### Server

1. Clone this repository
2. Navigate to the project directory
3. Install dependencies:
   ```
   npm install
   ```
4. Start the server:
   ```
   node index.js
   ```

### Browser Extension

1. Open your browser's extension management page
   - Chrome: `chrome://extensions/`
   - Firefox: `about:addons`
2. Enable Developer Mode
3. Click "Load unpacked" (Chrome) or "Load Temporary Add-on" (Firefox)
4. Select the `browser-console-capture` directory from this repository

## Usage

1. Start the server using `node index.js` from the root directory
2. Click on the browser extension icon to open the popup
3. Verify that the connection status shows "Connected"
4. Use the "Send Tabs" button to manually send tab information to the server
5. View your tabs in the web interface at `http://localhost:3000`

## Configuration

- Server port can be configured in `cursor-console-server/server.js`
- Connection settings can be adjusted in the extension popup

## License

MIT
