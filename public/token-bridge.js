// LiveMu Token Bridge for Cloud Overlays
(function() {
    const urlParams = new URLSearchParams(window.location.search);
    const streamToken = urlParams.get('token') || 'default';

    function attachBridge() {
        if (window.socket && typeof window.socket.emit === 'function') {
            window.socket.emit('join-room', streamToken);
            window.socket.emit('get_data', streamToken);
            console.log('[LiveMu Cloud] Conectado a sala:', streamToken);
        } else {
            setTimeout(attachBridge, 200);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attachBridge);
    } else {
        attachBridge();
    }
})();
