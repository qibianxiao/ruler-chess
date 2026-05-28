// == 尺棋 联机对战模块 ========================================================
// Uses PeerJS (WebRTC) — no server needed, pure P2P

const MP = {
  peer: null,
  conn: null,
  host: false,         // true = host (White), false = guest (Red)
  myIndex: -1,
  connected: false,
  roomId: null,

  // Callbacks — set by game.js
  onStatus: null,      // (msg) => void
  onReady: null,       // () => void — both sides connected, game can start
  onAction: null,      // (action) => void — opponent's action received
  onDisconnect: null,  // () => void

  init() {
    const url = new URL(location.href);
    const joinId = url.searchParams.get('join');
    if (joinId) {
      this.joinRoom(joinId);
    }
    // Otherwise wait for user to click "创建房间" or "加入房间"
  },

  createRoom() {
    this.host = true;
    this.myIndex = 0; // White
    this.peer = new Peer();
    this.peer.on('open', (id) => {
      this.roomId = id;
      const link = `${location.origin}${location.pathname}?join=${id}`;
      this._status(`房间已创建！将链接发给对手：<br><input value="${link}" readonly style="width:100%;padding:4px;font-size:12px;" onclick="this.select()">`);
      // Also show a copy button
      this._showLinkPanel(link);
    });
    this.peer.on('connection', (conn) => {
      this.conn = conn;
      this._setupConn();
    });
    this.peer.on('error', (err) => {
      this._status(`连接错误：${err.message}`);
    });
  },

  joinRoom(hostId) {
    this.host = false;
    this.myIndex = 1; // Red
    this._status('正在加入房间...');
    try {
      this.peer = new Peer();
      this.peer.on('open', () => {
        this.conn = this.peer.connect(hostId, { reliable: true });
        this._setupConn();
      });
      this.peer.on('error', (err) => {
        this._status(`连接失败：${err.message}。请检查链接是否正确，或让房主重新创建房间。`);
      });
    } catch(e) {
      this._status(`初始化失败：${e.message}`);
    }
  },

  joinWithId(hostId) {
    // Called from UI button
    this.joinRoom(hostId);
    // Update URL without reloading
    const url = new URL(location.href);
    url.searchParams.set('join', hostId);
    history.replaceState(null, '', url.toString());
  },

  _setupConn() {
    this.conn.on('open', () => {
      this.connected = true;
      this._status(`已连接！你是${this.host ? '白皇后（先手）' : '红皇后'}。`);
      if (this.host) {
        // Host sends initial game state
        this.send({ type: 'init', items: state.items, flags: state.flags });
      }
      this._hideLinkPanel();
      if (this.onReady) this.onReady();
    });

    this.conn.on('data', (data) => {
      if (data.type === 'init') {
        // Guest receives initial state
        state.items = data.items;
        state.flags = data.flags;
        state.phase = 'roll';
        render();
        if (this.onReady) this.onReady();
        return;
      }
      if (this.onAction) this.onAction(data);
    });

    this.conn.on('close', () => {
      this.connected = false;
      this._status('对手已断开连接。');
      if (this.onDisconnect) this.onDisconnect();
    });

    this.conn.on('error', (err) => {
      this._status(`连接错误：${err}`);
    });
  },

  send(action) {
    if (this.connected && this.conn) {
      try { this.conn.send(action); } catch(e) {}
    }
  },

  isMyTurn() {
    return !this.connected || state.currentPlayer === this.myIndex;
  },

  _status(msg) {
    if (this.onStatus) this.onStatus(msg);
  },

  _showLinkPanel(link) {
    let panel = document.getElementById('mp-link-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'mp-link-panel';
      panel.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#16213e;border:2px solid #f0c040;border-radius:12px;padding:20px;z-index:200;text-align:center;color:#e0e0e0;min-width:340px;';
      document.body.appendChild(panel);
    }
    panel.innerHTML = `
      <h3 style="color:#f0c040;margin-top:0;">🔗 邀请对手</h3>
      <p style="font-size:13px;color:#aaa;">复制以下链接发给对手</p>
      <input id="mp-link-input" value="${link}" readonly style="width:100%;padding:6px;font-size:12px;border:1px solid #4a4a6a;background:#0d0d1a;color:#e0e0e0;border-radius:4px;margin:8px 0;" onclick="this.select()">
      <button onclick="navigator.clipboard.writeText(document.getElementById('mp-link-input').value);this.textContent='已复制！'" style="background:#e94560;color:#fff;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:14px;margin:4px;">📋 复制链接</button>
      <p style="font-size:12px;color:#666;margin-top:10px;">等待对手加入...</p>
    `;
  },

  _hideLinkPanel() {
    const panel = document.getElementById('mp-link-panel');
    if (panel) panel.remove();
  },

  // Clean disconnect
  disconnect() {
    if (this.conn) { try { this.conn.close(); } catch(e) {} }
    if (this.peer) { try { this.peer.destroy(); } catch(e) {} }
    this.connected = false;
  }
};

// Auto-init: if URL has ?join=xxx, auto-join on page load
MP.init();
