// == 尺棋 WebSocket 中继服务器 ================================================
// 用法: node server.js [port]
// 默认端口 3456

const WebSocket = require('ws');

const PORT = parseInt(process.argv[2]) || 3456;

const wss = new WebSocket.Server({ port: PORT });

// 房间: roomId -> { host, guest, createdAt }
const rooms = new Map();

// 连接 -> 元信息
const connInfo = new Map(); // ws -> { roomId, role }

function generateRoomId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(data)); } catch (e) { /* ignore */ }
  }
}

function cleanupRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.host) { connInfo.delete(room.host); try { room.host.close(); } catch (e) {} }
  if (room.guest) { connInfo.delete(room.guest); try { room.guest.close(); } catch (e) {} }
  rooms.delete(roomId);
}

// 定期清理超过 30 分钟的空房间
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (!room.host || room.host.readyState !== WebSocket.OPEN) {
      if (!room.guest || room.guest.readyState !== WebSocket.OPEN) {
        cleanupRoom(id);
      }
    }
  }
}, 5 * 60 * 1000);

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    switch (msg.type) {
      case 'create': {
        const roomId = generateRoomId();
        rooms.set(roomId, { host: ws, guest: null, createdAt: Date.now() });
        connInfo.set(ws, { roomId, role: 'host' });
        send(ws, { type: 'room-created', roomId });
        console.log(`[+] Room ${roomId} created`);
        break;
      }
      case 'join': {
        const room = rooms.get(msg.roomId);
        if (!room) {
          send(ws, { type: 'error', message: '房间不存在或已过期，请让房主重新创建。' });
          return;
        }
        if (room.guest) {
          send(ws, { type: 'error', message: '房间已满，请等待或让房主重新创建。' });
          return;
        }
        room.guest = ws;
        connInfo.set(ws, { roomId: msg.roomId, role: 'guest' });
        // 通知双方
        send(room.host, { type: 'guest-joined' });
        send(ws, { type: 'joined', roomId: msg.roomId });
        console.log(`[+] Room ${msg.roomId}: guest joined`);
        break;
      }
      default: {
        // 转发给房间内的另一方
        const info = connInfo.get(ws);
        if (!info) return;
        const room = rooms.get(info.roomId);
        if (!room) return;
        const peer = info.role === 'host' ? room.guest : room.host;
        if (peer && peer.readyState === WebSocket.OPEN) {
          send(peer, msg);
        }
      }
    }
  });

  ws.on('close', () => {
    const info = connInfo.get(ws);
    if (!info) return;
    const room = rooms.get(info.roomId);
    if (!room) return;
    const peer = info.role === 'host' ? room.guest : room.host;
    if (peer && peer.readyState === WebSocket.OPEN) {
      send(peer, { type: 'peer-left' });
    }
    console.log(`[-] Room ${info.roomId}: ${info.role} left`);
    cleanupRoom(info.roomId);
  });

  ws.on('error', () => {
    // close 事件会处理清理
  });
});

console.log(`尺棋 WebSocket 服务器已启动，端口 ${PORT}`);
