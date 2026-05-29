// == 尺棋 联机对战模块 v2 ====================================================
// 从 PeerJS WebRTC 切换为 WebSocket 中继模式
// 100% 连接成功率，不受 NAT 类型影响

// 服务器地址
// 本地开发: ws://localhost:3456
// 生产环境: wss://ruler-chess.onrender.com (Render.com 免费 TLS)
// 自定义: 加 ?server=wss://your-server 到 URL
const WS_SERVER = (() => {
  const url = new URL(location.href);
  const p = url.searchParams.get('server');
  if (p) return p;
  if (location.protocol === 'https:') {
    return 'wss://ruler-chess.onrender.com';
  }
  return 'ws://localhost:3456';
})();

const MP = {
  ws: null,
  host: false,
  myIndex: -1,
  connected: false,
  roomId: null,
  _joinId: null,        // 等待加入的房间 ID
  _pendingInit: false,  // 连接建立后是否等待 init 消息

  // Callbacks — 由 game.js 设置
  onStatus: null,
  onReady: null,
  onAction: null,
  onDisconnect: null,

  init() {
    const url = new URL(location.href);
    const joinId = url.searchParams.get('join');
    if (joinId) {
      this._joinId = joinId;
      this.joinRoom(joinId);
    }
  },

  createRoom() {
    this.host = true;
    this.myIndex = 0; // White
    this._pendingInit = false;
    this._status('正在连接服务器...');
    this._connect(() => {
      // 连接建立后发送创建请求
      this._send({ type: 'create' });
    });
  },

  joinRoom(hostId) {
    this.host = false;
    this.myIndex = 1; // Red
    this._pendingInit = true;
    this._status('正在加入房间...');
    this._connect(() => {
      this._send({ type: 'join', roomId: hostId });
    });
  },

  joinWithId(hostId) {
    this._joinId = hostId;
    this.joinRoom(hostId);
    const url = new URL(location.href);
    url.searchParams.set('join', hostId);
    history.replaceState(null, '', url.toString());
  },

  _connect(onOpen) {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
    }
    try {
      this.ws = new WebSocket(WS_SERVER);
    } catch (e) {
      this._status('无法连接服务器，请检查网络。');
      return;
    }

    this.ws.onopen = () => {
      if (onOpen) onOpen();
    };

    this.ws.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch (ex) { return; }
      this._handleMessage(data);
    };

    this.ws.onclose = () => {
      if (this.connected) {
        this.connected = false;
        this._status('与服务器断开连接。');
        if (this.onDisconnect) this.onDisconnect();
      }
    };

    this.ws.onerror = () => {
      // close 事件会紧接着触发，在 onclose 中处理
    };
  },

  _handleMessage(data) {
    switch (data.type) {
      case 'room-created':
        this.roomId = data.roomId;
        this.connected = false; // 等待对手加入才算 connected
        const link = `${location.origin}${location.pathname}?join=${data.roomId}`;
        this._status(`房间已创建！将链接发给对手：`);
        this._showLinkPanel(link);
        break;

      case 'joined':
        this.roomId = data.roomId;
        this.connected = true;
        this._hideLinkPanel();
        // 客机等待主机的 init 消息来同步游戏状态
        this._status('已连接，等待主机同步游戏状态...');
        break;

      case 'guest-joined':
        this.connected = true;
        this._hideLinkPanel();
        this._status('对手已加入！你是白皇后（先手）。');
        // 先初始化游戏状态，再发送给客机
        if (this.onReady) this.onReady(); // → startNewGame() 生成 items/flags
        this._send({
          type: 'init',
          items: state.items,
          flags: state.flags
        });
        break;

      case 'peer-left':
        this.connected = false;
        this._status('对手已断开连接。');
        if (this.onDisconnect) this.onDisconnect();
        break;

      case 'init':
        // 客机接收主机的游戏状态，用主机数据初始化
        if (this._pendingInit) {
          this._pendingInit = false;
          // 直接调用 startNewGame 并传入主机的道具/旗子，保证双方同步
          if (typeof startNewGame === 'function') {
            startNewGame({ items: data.items, flags: data.flags });
          }
          this._status(`已连接！你是红皇后。`);
        }
        break;

      case 'error':
        this._status(`连接失败：${data.message}`);
        break;

      default:
        // 转发对手的游戏操作
        if (this.onAction) this.onAction(data);
    }
  },

  send(action) {
    if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._send(action);
    }
  },

  _send(data) {
    try { this.ws.send(JSON.stringify(data)); } catch (e) {}
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
      <h3 style="color:#f0c040;margin-top:0;">邀请对手</h3>
      <p style="font-size:13px;color:#aaa;">复制以下链接发给对手</p>
      <input id="mp-link-input" value="${link}" readonly style="width:100%;padding:6px;font-size:12px;border:1px solid #4a4a6a;background:#0d0d1a;color:#e0e0e0;border-radius:4px;margin:8px 0;" onclick="this.select()">
      <button onclick="navigator.clipboard.writeText(document.getElementById('mp-link-input').value);this.textContent='已复制！'" style="background:#e94560;color:#fff;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:14px;margin:4px;">复制链接</button>
      <p style="font-size:12px;color:#666;margin-top:10px;">等待对手加入...</p>
    `;
  },

  _hideLinkPanel() {
    const panel = document.getElementById('mp-link-panel');
    if (panel) panel.remove();
  },

  disconnect() {
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    this.connected = false;
  }
};

// Auto-init
MP.init();
