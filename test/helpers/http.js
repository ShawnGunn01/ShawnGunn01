// Starts the real Express app (src/server.js) on an ephemeral port so
// tests can hit actual HTTP routes — for compliance-critical paths
// (opt-out, send hard-blocks, the Calendly webhook) this file's tests
// deliberately exercise the real route, not just the underlying store/
// engine function, since that's what "prove it works" means here.
// server.js guards app.listen behind require.main === module specifically
// so requiring it here doesn't also bind the real :3000 port.

function startServer(app) {
  return new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => {
      const { port } = listener.address();
      resolve({ listener, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function stopServer(listener) {
  return new Promise((resolve) => listener.close(resolve));
}

module.exports = { startServer, stopServer };
