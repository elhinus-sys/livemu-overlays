// LiveMu Cloud Overlays - Smart Hybrid Bridge (Web Hosted + Local-First Data)
(function() {
    const urlParams = new URLSearchParams(window.location.search);
    const streamToken = urlParams.get('token') || 'default';
    const forceCloud = urlParams.get('cloud') === '1' || urlParams.get('cloud') === 'true' || urlParams.get('mode') === 'cloud';
    const localPort = urlParams.get('localPort') || '3011';
    const localHostUrl = `http://localhost:${localPort}`;
    const cloudHostUrl = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '';
    const isAlreadyLocal = typeof window !== 'undefined' && window.location && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    window.__LIVEMU_TOKEN__ = streamToken;

    let globalIsLocalConnected = false;

    // 1. Interceptar window.fetch para redirigir peticiones multimedia y datos a la PC local
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        if (typeof input === 'string') {
            let url = input;
            if (url.startsWith('/local-file') || url.startsWith('/media-event')) {
                // Siempre obtener archivos multimedia locales directamente de la PC
                url = `${localHostUrl}${url}`;
            } else if (url.startsWith('/data')) {
                // Si la app local está conectada, pedir datos a local
                if (globalIsLocalConnected || isAlreadyLocal) {
                    url = `${localHostUrl}/data`;
                } else {
                    const sep = url.includes('?') ? '&' : '?';
                    if (!url.includes('token=')) {
                        url = `${url}${sep}token=${encodeURIComponent(streamToken)}`;
                    }
                }
            } else if (url.startsWith('/')) {
                const sep = url.includes('?') ? '&' : '?';
                if (!url.includes('token=')) {
                    url = `${url}${sep}token=${encodeURIComponent(streamToken)}`;
                }
            }
            return originalFetch.call(this, url, init);
        }
        return originalFetch.apply(this, arguments);
    };

    // 2. Interceptar y encapsular window.io con Modo Híbrido Inteligente
    function wrapIo(origIo) {
        if (!origIo || origIo.__livemu_hooked) return origIo;

        const hookedIo = function(uri, opts) {
            if (typeof uri === 'object' && uri !== null) {
                opts = uri;
                uri = undefined;
            }
            opts = opts || {};

            // Si ya estamos accediendo directamente por localhost en el navegador, usar conexión nativa
            if (isAlreadyLocal) {
                const finalUri = (typeof uri === 'string' && uri.length > 0) ? uri : localHostUrl;
                const sock = origIo(finalUri, opts);
                window.socket = sock;
                return sock;
            }

            // Si el streamer fuerza explícitamente modo 100% cloud en la URL (?cloud=1)
            if (forceCloud) {
                console.log(`[LiveMu Bridge] Forzando modo 100% Cloud hacia Render (Sala: ${streamToken})`);
                opts.query = opts.query || {};
                opts.query.token = streamToken;
                const sock = origIo(cloudHostUrl, opts);
                window.socket = sock;
                sock.on('connect', () => {
                    sock.emit('join-room', streamToken);
                    sock.emit('get_data', streamToken);
                    sock.emit('get_music', streamToken);
                    sock.emit('request-twitch-status', streamToken);
                });
                return sock;
            }

            // --- MODO HÍBRIDO LOCAL-FIRST (Ahorro total de Ancho de Banda) ---
            console.log(`[LiveMu Bridge] Inicializando Modo Híbrido: Web en Render + Datos en Localhost (${localHostUrl})`);

            // Socket hacia la app local en tu PC
            const localSocket = origIo(localHostUrl, {
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 3000,
                timeout: 4000,
                transports: ['websocket', 'polling']
            });

            // Socket de respaldo hacia Render (empieza apagado para no gastar ancho de banda)
            const cloudSocket = origIo(cloudHostUrl, {
                query: { token: streamToken },
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 2500,
                autoConnect: false // No conectar si la app local responde
            });

            let isLocalConnected = false;
            const eventListeners = new Map(); // eventName -> Set(callbacks)

            function syncRoom(targetSocket) {
                if (!targetSocket || !targetSocket.connected) return;
                targetSocket.emit('join-room', streamToken);
                targetSocket.emit('get_data', streamToken);
                targetSocket.emit('get_music', streamToken);
                targetSocket.emit('request-twitch-status', streamToken);
            }

            function dispatchEvent(event, ...args) {
                const listeners = eventListeners.get(event);
                if (listeners) {
                    listeners.forEach(cb => {
                        try { cb.apply(proxySocket, args); } catch (e) { console.error(`[LiveMu Bridge] Error en listener '${event}':`, e); }
                    });
                }
            }

            function setupEventBridge(event) {
                if (eventListeners.has(event)) return;
                eventListeners.set(event, new Set());

                // Escuchar en el socket local
                localSocket.on(event, (...args) => {
                    const listeners = eventListeners.get(event);
                    if (listeners) {
                        listeners.forEach(cb => {
                            try { cb.apply(proxySocket, args); } catch (e) { console.error(e); }
                        });
                    }
                });

                // Escuchar en el socket cloud (solo procesar si local no está conectado para no duplicar eventos)
                cloudSocket.on(event, (...args) => {
                    if (isLocalConnected) return; // Prioridad local: silenciar eventos de la nube
                    const listeners = eventListeners.get(event);
                    if (listeners) {
                        listeners.forEach(cb => {
                            try { cb.apply(proxySocket, args); } catch (e) { console.error(e); }
                        });
                    }
                });
            }

            // Gestión de conexión Local
            localSocket.on('connect', () => {
                isLocalConnected = true;
                globalIsLocalConnected = true;
                console.log('%c[LiveMu Bridge] ✅ Conectado a la App en tu PC (http://localhost:3011) - Ancho de banda de Render: 0 MB', 'color: #00d2d3; font-weight: bold; font-size: 1.1em;');

                // Desconectar socket de Render de inmediato para ahorrar tráfico
                if (cloudSocket && cloudSocket.connected) {
                    console.log('[LiveMu Bridge] 🔌 Desconectando socket de Render Cloud para ahorrar cuota mensual.');
                    cloudSocket.disconnect();
                }

                syncRoom(localSocket);
                dispatchEvent('connect');
            });

            localSocket.on('disconnect', (reason) => {
                isLocalConnected = false;
                globalIsLocalConnected = false;
                console.log('[LiveMu Bridge] Desconectado de App Local:', reason);
                dispatchEvent('disconnect', reason);

                // Si la app local se cierra, activar cloud como respaldo
                if (cloudSocket && !cloudSocket.connected) {
                    console.log('[LiveMu Bridge] Reactivando Render Cloud como respaldo...');
                    cloudSocket.connect();
                }
            });

            // Gestión de conexión Cloud (Respaldo)
            cloudSocket.on('connect', () => {
                console.log(`[LiveMu Bridge] ☁️ Conectado a Render Cloud (Sala: ${streamToken}) [Modo Respaldo]`);
                syncRoom(cloudSocket);
                if (!isLocalConnected) {
                    dispatchEvent('connect');
                }
            });

            cloudSocket.on('disconnect', (reason) => {
                if (!isLocalConnected) {
                    dispatchEvent('disconnect', reason);
                }
            });

            // Si tras 2.5 segundos la app local aún no ha respondido (ej. se abrió OBS antes que la app), conectar a Render como respaldo temporal
            setTimeout(() => {
                if (!isLocalConnected && cloudSocket && !cloudSocket.connected) {
                    console.log('[LiveMu Bridge] OBS/TikTok abierto antes que la app. Activando Render Cloud en espera de que inicie la app...');
                    cloudSocket.connect();
                }
            }, 2500);

            // Objeto Proxy que los widgets utilizarán de forma transparente
            const proxySocket = {
                get connected() {
                    return isLocalConnected || (cloudSocket && cloudSocket.connected);
                },
                get id() {
                    return isLocalConnected ? localSocket.id : (cloudSocket ? cloudSocket.id : null);
                },
                on: function(event, callback) {
                    setupEventBridge(event);
                    eventListeners.get(event).add(callback);
                    return proxySocket;
                },
                off: function(event, callback) {
                    if (eventListeners.has(event)) {
                        if (callback) {
                            eventListeners.get(event).delete(callback);
                        } else {
                            eventListeners.get(event).clear();
                        }
                    }
                    return proxySocket;
                },
                removeListener: function(event, callback) {
                    return proxySocket.off(event, callback);
                },
                removeAllListeners: function(event) {
                    if (event) {
                        if (eventListeners.has(event)) eventListeners.get(event).clear();
                    } else {
                        eventListeners.clear();
                    }
                    return proxySocket;
                },
                emit: function(event, ...args) {
                    if (isLocalConnected) {
                        localSocket.emit(event, ...args);
                    } else if (cloudSocket && cloudSocket.connected) {
                        cloudSocket.emit(event, ...args);
                    } else {
                        localSocket.emit(event, ...args);
                    }
                    return proxySocket;
                },
                disconnect: function() {
                    localSocket.disconnect();
                    if (cloudSocket) cloudSocket.disconnect();
                    return proxySocket;
                },
                connect: function() {
                    localSocket.connect();
                    return proxySocket;
                },
                close: function() {
                    return proxySocket.disconnect();
                }
            };

            window.socket = proxySocket;
            return proxySocket;
        };

        hookedIo.__livemu_hooked = true;
        return hookedIo;
    }

    if (window.io) {
        window.io = wrapIo(window.io);
    }

    // Interceptar cualquier script posterior de Socket.io que intente sobreescribir window.io
    try {
        let currentIo = window.io;
        Object.defineProperty(window, 'io', {
            configurable: true,
            enumerable: true,
            get: function() {
                return currentIo;
            },
            set: function(newVal) {
                currentIo = wrapIo(newVal);
            }
        });
    } catch(e) {}
})();
