# Browser Console Capture

A browser extension that captures tab information and sends it to a server for display in Cursor IDE.

## Features

- Captures open tabs from your browser
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
   npm start
   ```

### Browser Extension

1. Open your browser's extension management page
   - Chrome: `chrome://extensions/`
   - Firefox: `about:addons`
2. Enable Developer Mode
3. Click "Load unpacked" (Chrome) or "Load Temporary Add-on" (Firefox)
4. Select the `browser-console-capture` directory from this repository

## Usage

1. Start the server using `npm start`
2. Click on the browser extension icon to open the popup
3. Verify that the connection status shows "Connected"
4. Use the "Send Tabs" button to manually send tab information to the server
5. View your tabs in the web interface at `http://localhost:3000`

## Configuration

- Server port can be configured in `server.js`
- Connection settings can be adjusted in the extension popup

## Development

This project consists of two main components:
- A Node.js server that receives and displays tab information
- A browser extension that captures tab data and sends it to the server

### Project Structure

- `/server.js` - The main server file
- `/browser-console-capture/` - Browser extension files
  - `manifest.json` - Extension configuration
  - `background.js` - Background script for tab tracking
  - `popup.html` - Extension popup UI
  - `popup.js` - Popup functionality

## License

MIT
