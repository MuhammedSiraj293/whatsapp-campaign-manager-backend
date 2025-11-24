// backend/src/socketManager.js

const { Server } = require('socket.io');

let io;

const init = (httpServer, corsOptions) => {
  io = new Server(httpServer, {
    cors: corsOptions
  });
  console.log('Socket.IO initialized');
  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized!');
  }
  return io;
};

module.exports = {
  init,
  getIO,
};