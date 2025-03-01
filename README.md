# Browser Console Capture

A browser extension that captures tab information and sends it to a server for monitoring and tracking purposes.

## Components

This project consists of two main components:

1. **Browser Extension**: Captures tab information from the browser and sends it to the server
2. **Server**: Receives tab information from the browser extension and provides an API for accessing it

## Features

- Real-time tab tracking with status indicators
- WebSocket communication for instant updates
- Simple UI with connection status indicator (green/red dot)
- Tab information includes title, URL, and favicon

## Installation

### Server Setup

1. Clone this repository
2. Navigate to the server directory:
   ```
   cd cursor-console-server
   ```
3. Install dependencies:
   ```
   npm install
   ```
4. Start the server:
   ```
   npm start
   ```
   The server will run on http://localhost:3000

### Browser Extension Setup

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in the top-right corner)
3. Click "Load unpacked" and select the `browser-console-capture` directory
4. Click the extension icon in your browser toolbar
5. Enter the server URL (default: `ws://localhost:3000`) and click "Connect"
6. The status indicator will turn green when connected

## Usage

1. Connect the browser extension to the server
2. The extension will automatically send tab information to the server
3. You can manually send tab information by clicking the "Send Tabs" button
4. The connection status is indicated by a green (connected) or red (disconnected) dot

## License

MIT
