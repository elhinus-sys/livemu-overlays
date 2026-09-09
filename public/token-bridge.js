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

    // 2. Interceptar window.io para que cualquier overlay use automáticamente la sala correcta
    function hookSocketIo() {
        if (typeof window.io === 'function') {
            if (window.io.__livemu_hooked) return;
            const origIo = window.io;
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
                // Limpiar URLs locales fijas para que use el host actual (Render)
                if (typeof uri === 'string' && (uri.includes('localhost:3011') || uri.includes('localhost:3010'))) {
                    uri = undefined;
                }

                const socket = origIo(uri, opts);
                window.socket = socket;

                socket.on('connect', () => {
                    console.log(`[LiveMu Cloud] Conectado exitosamente a sala: ${streamToken}`);
                    socket.emit('join-room', streamToken);
                    socket.emit('get_data', streamToken);
                });

                return socket;
            };
            hookedIo.__livemu_hooked = true;
            window.io = hookedIo;
        } else {
            setTimeout(hookSocketIo, 30);
        }
    }
    hookSocketIo();
})();
