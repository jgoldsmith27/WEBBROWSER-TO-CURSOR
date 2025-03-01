# Cursor Console Bridge

A bridge application that connects to Cursor IDE and allows it to view the console output.

## Overview

Cursor Console Bridge is a standalone application that creates a bridge between your terminal/console and Cursor IDE. It captures console output and makes it available to Cursor through a local server, allowing Cursor to access and analyze console logs in real-time.

## How It Works

1. The application starts a local server that listens for connections from Cursor IDE.
2. It captures console output from your terminal using node-pty.
3. The captured output is sent to Cursor IDE through a WebSocket connection.
4. Cursor can then access and analyze the console output in real-time.

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/cursor-console-bridge.git

# Navigate to the project directory
cd cursor-console-bridge

# Install dependencies
npm install

# Start the application
npm start
```

## Usage

1. Start the Cursor Console Bridge application:
   ```bash
   npm start
   ```

2. The application will start a local server on port 3000 by default.

3. In Cursor IDE, you can connect to the bridge using the provided extension or by accessing the WebSocket endpoint directly.

## Configuration

You can configure the application by modifying the following environment variables:

- `PORT`: The port on which the server will listen (default: 3000)
- `TERMINAL_ROWS`: Number of rows for the terminal (default: 24)
- `TERMINAL_COLS`: Number of columns for the terminal (default: 80)

## Limitations

- Currently, Cursor IDE does not have an official extension API, so this solution uses a workaround approach.
- The bridge requires both Cursor IDE and the bridge application to be running on the same machine.

## Future Improvements

- Develop a proper Cursor IDE extension once an official extension API is available.
- Add support for bidirectional communication to allow Cursor to send commands to the terminal.
- Implement authentication to secure the connection between Cursor and the bridge.

## License

MIT
