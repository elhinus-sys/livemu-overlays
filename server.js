const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// In-memory state cache per room (streamer token)
const rooms = new Map();

function sanitizeToken(token) {
    if (!token || typeof token !== 'string') return 'default';
    const cleaned = token.trim();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(cleaned)) return 'default';
    return cleaned;
}

function getRoomState(token) {
    const key = sanitizeToken(token);
    if (!rooms.has(key)) {
        rooms.set(key, {
            widgetData: {},
            gifts: [],
            topLikers: {},
            topGifters: {},
            extensible: {},
            music: null,
            twitchStatus: null,
            twitchBadges: null,
            lastActivity: Date.now()
        });
    }
    const state = rooms.get(key);
    state.lastActivity = Date.now();
    return state;
}

function cleanOldRooms() {
    const now = Date.now();
    for (const [key, room] of rooms.entries()) {
        if (key === 'default') continue;
        const roomSockets = io.sockets.adapter.rooms.get(`room_${key}`);
        const hasClients = roomSockets && roomSockets.size > 0;
        if (!hasClients && (now - (room.lastActivity || 0)) > 6 * 60 * 60 * 1000) {
            rooms.delete(key);
        }
    }
}
setInterval(cleanOldRooms, 30 * 60 * 1000);

// Ping / Health check
app.get('/ping', (req, res) => {
    res.json({ status: 'ok', time: Date.now(), service: 'LiveMu Cloud Overlays' });
});

// JSON data endpoint
app.get('/data', (req, res) => {
    const token = req.query.token || 'default';
    const state = getRoomState(token);
    res.json(state.widgetData || {});
});

// Map routes to overlay HTML files
const overlayRoutes = {
    '/': 'gift-overlay.html',
    '/gift-overlay': 'gift-overlay.html',
    '/likes-goal-overlay': 'likes-goal-overlay.html',
    '/gift-goal-overlay': 'gift-goal-overlay.html',
    '/extensible-overlay': 'extensible-overlay.html',
    '/top-likes-overlay': 'top-likes-overlay.html',
    '/top-gifter-overlay': 'top-gifter-overlay.html',
    '/chat-widget': 'chat-widget.html',
    '/multichat': 'multichat.html',
    '/alerts': 'alerts.html',
    '/overlay-musica': 'overlay-musica.html',
    '/overlay-canvas': 'overlay-canvas.html',
    '/obs-widget': 'obs-widget.html'
};

Object.entries(overlayRoutes).forEach(([route, file]) => {
    app.get([route, `${route}.html`], (req, res) => {
        const filePath = path.join(__dirname, 'public', file);
        if (fs.existsSync(filePath)) {
            let html = fs.readFileSync(filePath, 'utf8');
            // Asegurar script de socket.io y puente de token en el <head> para ejecutarse antes que los scripts del overlay
            let headInject = '';
            if (!html.includes('/socket.io/socket.io.js')) {
                headInject += '  <script src="/socket.io/socket.io.js"></script>\n';
            }
            if (!html.includes('/token-bridge.js')) {
                headInject += '  <script src="/token-bridge.js"></script>\n';
            }
            if (headInject) {
                html = html.replace('</head>', `${headInject}</head>`);
            }
            res.type('html').send(html);
        } else {
            res.status(404).send(`Overlay ${file} not found`);
        }
    });
});

// Static assets
app.use(express.static(path.join(__dirname, 'public')));

// Socket.IO
const io = new Server(server, {
    maxHttpBufferSize: 5e7, // 50MB para soportar plantillas y datos grandes sin cerrar transporte
    pingTimeout: 60000,
    pingInterval: 25000,
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    const queryToken = socket.handshake.query.token || 'default';
    let currentToken = String(queryToken).trim();
    socket.join(`room_${currentToken}`);
    socket.currentToken = currentToken;

    // Send initial state immediately
    const initialState = getRoomState(currentToken);
    if (initialState.widgetData && Object.keys(initialState.widgetData).length > 0) {
        socket.emit('data', initialState.widgetData);
    }
    if (initialState.gifts && initialState.gifts.length > 0) {
        socket.emit('update-gifts', initialState.gifts);
    }
    if (initialState.topLikers && Object.keys(initialState.topLikers).length > 0) {
        socket.emit('sync_likers', Object.values(initialState.topLikers));
    }
    if (initialState.topGifters && Object.keys(initialState.topGifters).length > 0) {
        socket.emit('sync_gifters', Object.values(initialState.topGifters));
    }
    if (initialState.extensible && Object.keys(initialState.extensible).length > 0) {
        socket.emit('extensible_data', initialState.extensible);
    }
    if (initialState.twitchStatus) {
        socket.emit('twitch-connection-status', initialState.twitchStatus);
    }
    if (initialState.twitchBadges) {
        socket.emit('twitch-badges', initialState.twitchBadges);
    }

    // Join room explicitly
    socket.on('join-room', (token) => {
        if (!token) return;
        const newKey = String(token).trim();
        if (socket.currentToken) {
            socket.leave(`room_${socket.currentToken}`);
        }
        socket.currentToken = newKey;
        socket.join(`room_${newKey}`);

        const state = getRoomState(newKey);
        if (state.widgetData && Object.keys(state.widgetData).length > 0) socket.emit('data', state.widgetData);
        if (state.gifts && state.gifts.length > 0) socket.emit('update-gifts', state.gifts);
        if (state.topLikers) socket.emit('sync_likers', Object.values(state.topLikers));
        if (state.topGifters) socket.emit('sync_gifters', Object.values(state.topGifters));
        if (state.extensible) socket.emit('extensible_data', state.extensible);
        if (state.twitchStatus) socket.emit('twitch-connection-status', state.twitchStatus);
        if (state.twitchBadges) socket.emit('twitch-badges', state.twitchBadges);
    });

    // Request data from OBS widgets
    socket.on('get_data', (token) => {
        const roomKey = String(token || socket.currentToken || 'default').trim();
        const state = getRoomState(roomKey);
        if (state.topLikers) socket.emit('sync_likers', Object.values(state.topLikers));
        if (state.topGifters) socket.emit('sync_gifters', Object.values(state.topGifters));
        if (state.gifts) socket.emit('update-gifts', state.gifts);
        if (state.widgetData) socket.emit('data', state.widgetData);
        if (state.extensible && Object.keys(state.extensible).length > 0) socket.emit('extensible_data', state.extensible);
        if (state.music) socket.emit('music-update', state.music);
        if (state.twitchStatus) socket.emit('twitch-connection-status', state.twitchStatus);
        if (state.twitchBadges) socket.emit('twitch-badges', state.twitchBadges);
    });

    socket.on('get_music', (token) => {
        const roomKey = String(token || socket.currentToken || 'default').trim();
        const state = getRoomState(roomKey);
        if (state.music) socket.emit('music-update', state.music);
    });

    socket.on('request-twitch-status', (token) => {
        const roomKey = String(token || socket.currentToken || 'default').trim();
        const state = getRoomState(roomKey);
        if (state.twitchStatus) socket.emit('twitch-connection-status', state.twitchStatus);
        if (state.twitchBadges) socket.emit('twitch-badges', state.twitchBadges);
    });

    // Events from LiveMu app on PC
    socket.on('streamer-event', ({ token, event, data }) => {
        const roomKey = String(token || socket.currentToken || 'default').trim();
        const state = getRoomState(roomKey);

        // Update in-memory state
        if (event === 'data' && data) {
            state.widgetData = data;
            if (data.extensible) state.extensible = data.extensible;
        }
        if (event === 'update-gifts' && Array.isArray(data)) state.gifts = data;
        if (event === 'sync_likers' && Array.isArray(data)) {
            state.topLikers = {};
            data.forEach(l => state.topLikers[l.uid] = l);
        }
        if (event === 'sync_gifters' && Array.isArray(data)) {
            state.topGifters = {};
            data.forEach(g => state.topGifters[g.uid] = g);
        }
        if (event === 'extensible_data' && data) state.extensible = data;
        if (event === 'music-update' && data) state.music = data;
        if (event === 'twitch-connection-status' && data) state.twitchStatus = data;
        if (event === 'twitch-badges' && data) state.twitchBadges = data;

        // Broadcast to all OBS widgets connected in this room
        io.to(`room_${roomKey}`).emit(event, data);
    });
});

server.listen(port, () => {
    console.log(`[LiveMu Cloud Overlays] Server running on port ${port}`);
});
