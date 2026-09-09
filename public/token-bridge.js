// LiveMu Cloud Overlays - Global Token & Socket.IO Bridge
(function() {
    const urlParams = new URLSearchParams(window.location.search);
    const streamToken = urlParams.get('token') || 'default';
    window.__LIVEMU_TOKEN__ = streamToken;

    // 1. Interceptar window.fetch para redirigir localhost y adjuntar token de sala
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        if (typeof input === 'string') {
            let url = input.replace(/http:\/\/localhost:3011/g, '').replace(/http:\/\/localhost:3010/g, '');
            if (url.startsWith('/')) {
                const sep = url.includes('?') ? '&' : '?';
                if (!url.includes('token=')) {
                    url = `${url}${sep}token=${encodeURIComponent(streamToken)}`;
                }
            }
            return originalFetch.call(this, url, init);
        }
        return originalFetch.apply(this, arguments);
    };

    // 2. Interceptar y encapsular window.io
    function wrapIo(origIo) {
        if (!origIo || origIo.__livemu_hooked) return origIo;
        const hookedIo = function(uri, opts) {
            if (typeof uri === 'object' && uri !== null) {
                opts = uri;
                uri = undefined;
            }
            opts = opts || {};
            opts.query = opts.query || {};
            if (typeof opts.query === 'object') {
                opts.query.token = streamToken;
            }

            // Usar siempre el origin actual para evitar conectar a 'undefined'
            const targetHost = (typeof window !== 'undefined' && window.location && window.location.origin) 
                ? window.location.origin 
                : undefined;

            let finalUri = uri;
            if (!finalUri || (typeof finalUri === 'string' && (finalUri.includes('localhost:3011') || finalUri.includes('localhost:3010')))) {
                finalUri = targetHost;
            }

            const socket = finalUri ? origIo(finalUri, opts) : origIo(opts);
            window.socket = socket;

            socket.on('connect', () => {
                console.log(`[LiveMu Cloud] Conectado exitosamente a sala: ${streamToken}`);
                socket.emit('join-room', streamToken);
                socket.emit('get_data', streamToken);
                socket.emit('get_music', streamToken);
            });

            return socket;
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
