function switchView(viewName) {
    if (viewName === 'interactivos') viewName = 'templates';
    localStorage.setItem('s4e_last_view', viewName);

    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active-view'));
    const viewEl = document.getElementById('view-' + viewName);
    if (viewEl) viewEl.classList.add('active-view');

    document.querySelectorAll('nav a').forEach(el => el.classList.remove('active'));

    let mainNavId = 'nav-' + viewName;
    const subnav = document.getElementById('interactivos-subnav');
    const interactivosWrapper = document.getElementById('interactivos-wrapper');

    if (['templates', 'dashboard'].includes(viewName)) {
        mainNavId = 'nav-interactivos';
        if (subnav) subnav.style.display = 'block';
        if (interactivosWrapper) interactivosWrapper.style.display = 'grid';
        document.querySelectorAll('.sub-tab').forEach(el => el.classList.remove('active'));
        const activeSubTab = document.getElementById('subtab-' + viewName);
        if (activeSubTab) activeSubTab.classList.add('active');
    } else {
        if (subnav) subnav.style.display = 'none';
        if (interactivosWrapper) interactivosWrapper.style.display = 'none';
    }

    const navLink = document.getElementById(mainNavId);
    if (navLink) navLink.classList.add('active');

    const alertsFrame = document.getElementById('preview-alerts');
    if (alertsFrame) { if (viewName === 'media') { if (alertsFrame.getAttribute('src') !== 'http://localhost:3011/alerts.html?preview=true') alertsFrame.src = 'http://localhost:3011/alerts.html?preview=true'; } else { alertsFrame.src = 'about:blank'; } }

    // [OPTIMIZACIÓN] Carga escalonada (Staggered Loading) de los widgets para evitar picos de CPU
    if (viewName === 'canvas') {
        if (window.ipcRenderer) {
            window.ipcRenderer.send('local-open-canvas-window');
        }
        // [NUEVO FIX] Si es el arranque de la app, esperamos 3 segundos antes de cargar las vistas previas.
        // Esto asegura que la ventana principal y la ventana de OBS se creen primero sin ahogar el CPU.
        if (typeof window.initialCanvasLoadDone === 'undefined') window.initialCanvasLoadDone = false;
        let delay = window.initialCanvasLoadDone ? 0 : 3000;
        // [OPTIMIZACIÓN RAM] Ya no cargamos el editor al entrar a la vista. Se carga bajo demanda.
        window.initialCanvasLoadDone = true; // Marcamos como hecho para que el delay solo aplique la primera vez.

        // [FIX] 2. Cargar el resto de widgets de vista previa mucho más lento
        const loadFrame = (id, url) => {
            const frame = document.getElementById(id);
            if (frame && frame.getAttribute('src') !== url) { setTimeout(() => frame.src = url, delay); delay += 1200; } // Separación extrema de 1.2s entre cada mini-ventana
        };
        loadFrame('preview-likes-goal', 'http://localhost:3011/likes-goal-overlay.html');
        loadFrame('preview-gift-goal', 'http://localhost:3011/gift-goal-overlay.html');
        loadFrame('preview-chat', 'http://localhost:3011/chat-widget.html');
        loadFrame('preview-top-likes', 'http://localhost:3011/top-likes-overlay.html');
        loadFrame('preview-top-gifter', 'http://localhost:3011/top-gifter-overlay.html');
        loadFrame('preview-extensible', 'http://localhost:3011/extensible-overlay.html');
        loadFrame('preview-musica', 'http://localhost:3011/overlay-musica.html');
        // [FIX RAM] La línea de abajo estaba comentada. La restauramos para que el preview de alertas también se cargue aquí.
        loadFrame('preview-alerts', 'http://localhost:3011/alerts.html?preview=true');
    } else {
        // [OPTIMIZACIÓN DE RAM] Destruimos los iframes de vista previa cuando no están visibles.
        // Esto libera una cantidad significativa de memoria RAM a costa de un pequeño
        // tiempo de recarga al volver a la pestaña de "Overlays".
        const unloadFrame = (id) => {
            const frame = document.getElementById(id);
            // Solo lo descargamos si ya tiene contenido, para no interferir con la carga inicial.
            if (frame && frame.getAttribute('src') !== 'about:blank') frame.src = 'about:blank';
        };

        // [OPTIMIZACIÓN RAM] Descargar el editor si salimos de la vista de overlays
        deactivateCanvasEditor();

        unloadFrame('preview-chat');
        unloadFrame('preview-top-likes');
        unloadFrame('preview-top-gifter');
        unloadFrame('preview-likes-goal');
        unloadFrame('preview-gift-goal');
        unloadFrame('preview-extensible');
        unloadFrame('preview-musica');
        unloadFrame('preview-alerts');
    }


    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
        if (viewName === 'music') {
            mainContent.style.padding = '0';
            mainContent.style.gap = '0';
            mainContent.style.overflow = 'hidden';
            mainContent.style.height = '100%';
            mainContent.style.width = '100%';
            if (typeof window.initYouTubePlayer === 'function') {
                setTimeout(window.initYouTubePlayer, 50);
            }
        } else {
            mainContent.style.padding = '20px';
            mainContent.style.gap = '20px';
            mainContent.style.overflowY = 'auto';
            mainContent.style.height = '100%';
            mainContent.style.width = '100%';
        }
    }

    if (viewName === 'templates') renderTemplateList();
    if (viewName === 'media') { currentActionMode = 'media'; renderMediaList(); }
    else if (viewName === 'dashboard') { currentActionMode = 'minecraft'; renderTriggerList(); }
    else if (viewName === 'tts') { if (typeof initTTS === 'function') initTTS(); }

    window.dispatchEvent(new CustomEvent('view-changed', { detail: { viewName } }));
}

// [OPTIMIZACIÓN RAM] Nuevas funciones para controlar el editor maestro
function activateCanvasEditor() {
    const placeholder = document.getElementById('editor-placeholder');
    const deactivateBtn = document.getElementById('btn-deactivate-editor');
    const editor = document.getElementById('embedded-canvas-editor');

    if (placeholder) placeholder.style.display = 'none';
    if (editor) {
        editor.style.display = 'block';
        if (editor.getAttribute('src') === 'about:blank') {
            editor.src = 'http://localhost:3011/overlay-canvas.html?edit=true';
        }
        // Forzar la actualización de la escala del iframe
        setTimeout(() => updateEditorIframeScale(), 50);
    }
    if (deactivateBtn) deactivateBtn.style.display = 'flex';
}

function deactivateCanvasEditor() {
    const placeholder = document.getElementById('editor-placeholder');
    const deactivateBtn = document.getElementById('btn-deactivate-editor');
    const editor = document.getElementById('embedded-canvas-editor');
    if (placeholder) placeholder.style.display = 'block';
    if (editor) {
        editor.style.display = 'none';
        editor.src = 'about:blank'; // ¡La línea clave que libera la RAM!
    }
    if (deactivateBtn) deactivateBtn.style.display = 'none';
}



function openConnectionsModal() {
    document.getElementById('connections-modal').style.display = 'flex';
    try {
        const { ipcRenderer } = require('electron');
        ipcRenderer.invoke('get-kick-status').then(status => {
            if (status && status.username) {
                const input = document.getElementById('kick-username-modal');
                if (input && !input.value) input.value = status.username;
            }
            if (status && status.connected) {
                updateKickUI({ type: 'connected', username: status.username });
            }
        }).catch(() => { });
    } catch (e) { }
}

function updateKickUI(status) {
    const btn = document.getElementById('btn-kick-connect');
    const label = document.getElementById('kick-status');
    const homeLabel = document.getElementById('home-status-kick');
    if (status.type === 'connected') {
        if (btn) {
            btn.innerText = "Desconectar"; btn.classList.replace('btn-outline', 'btn-danger'); btn.style.borderColor = ''; btn.style.color = 'white'; btn.onclick = typeof disconnectKick === 'function' ? disconnectKick : null; btn.disabled = false;
        }
        if (label) {
            label.innerText = "Conectado"; label.style.color = "#53fc18";
        }
        if (homeLabel) {
            homeLabel.innerText = status.username ? `@${status.username}` : "Conectado";
            homeLabel.style.color = "#53fc18";
        }
    } else if (status.type === 'connecting') {
        if (btn) {
            btn.innerText = "Conectando..."; btn.disabled = true;
        }
        if (label) {
            label.innerText = "Conectando..."; label.style.color = "#f0ad4e";
        }
        if (homeLabel) {
            homeLabel.innerText = "Conectando...";
            homeLabel.style.color = "#f0ad4e";
        }
    } else {
        if (btn) {
            btn.innerText = "Conectar"; btn.className = "btn btn-outline"; btn.style.borderColor = "#53fc18"; btn.style.color = "#53fc18"; btn.onclick = typeof connectKick === 'function' ? connectKick : null; btn.disabled = false;
        }
        if (label) {
            label.innerText = status.message || "Desconectado"; label.style.color = status.type === 'error' ? "#dc3545" : "#b0b0b0";
        }
        if (homeLabel) {
            homeLabel.innerText = "Desconectado";
            homeLabel.style.color = "#aaa";
        }
    }
}
function updateHeaderProfile(username, avatar) {
    if (username) { const el = document.getElementById('header-username-display'); if (el) el.innerText = username; }
    if (avatar) {
        const icon = document.getElementById('header-avatar-icon'); if (icon) icon.style.display = 'none';
        const img = document.getElementById('header-avatar-img'); if (img) { img.src = avatar; img.style.display = 'block'; }
    }
}

async function openServerConfig() {
    const data = await require('electron').ipcRenderer.invoke('local-get-server-profiles');
    serverProfiles = data.profiles || [];
    activeProfileId = data.activeId;
    if (serverProfiles.length === 0) createNewServerProfile();
    else loadProfileIntoForm(activeProfileId || serverProfiles[0].id);
    renderServerProfilesList();
    document.getElementById('server-config-modal').style.display = 'flex';
}

function switchServerTab(tabName) {
    document.getElementById('tab-server-config').style.display = tabName === 'config' ? 'flex' : 'none';
    document.getElementById('tab-server-plugins').style.display = tabName === 'plugins' ? 'flex' : 'none';
    document.getElementById('btn-tab-server-config').style.background = tabName === 'config' ? '#333' : 'transparent';
    document.getElementById('btn-tab-server-plugins').style.background = tabName === 'plugins' ? '#333' : 'transparent';
    if (tabName === 'plugins') loadServerPlugins();
}

async function loadServerPlugins() {
    const p = serverProfiles.find(x => String(x.id) === String(editingProfileId));
    const container = document.getElementById('tab-server-plugins');

    if (!p || !p.path) {
        container.innerHTML = '<div style="color:#888; text-align:center; margin-top:20px;">Debes guardar o seleccionar un archivo de servidor (.jar) en la pestaña "Ajustes Generales" para poder gestionar sus plugins.</div>';
        return;
    }

    container.innerHTML = '<div style="text-align:center; padding:20px; color:#888;"><i class="fa-solid fa-spinner fa-spin"></i> Cargando...</div>';

    const installed = await require('electron').ipcRenderer.invoke('local-get-server-plugins', p.path);
    const defaults = await require('electron').ipcRenderer.invoke('local-get-default-plugins');

    let html = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:0.85rem; color:#aaa; font-weight:bold;">Plugins Instalados</span>
            <button class="btn btn-purple btn-sm" onclick="installCustomPlugin()"><i class="fa-solid fa-plus"></i> Instalar .jar</button>
        </div>
        <div style="background:#111; border:1px solid #333; border-radius:6px; flex-grow:1; overflow-y:auto; padding:8px; display:flex; flex-direction:column; gap:5px; min-height: 120px;">
            ${installed.plugins && installed.plugins.length > 0
            ? installed.plugins.map(plug => `
                    <div style="display:flex; justify-content:space-between; align-items:center; background:#222; padding:8px 12px; border-radius:4px; border:1px solid #333;">
                        <span style="font-size:0.85rem; color:#fff;"><i class="fa-solid fa-puzzle-piece" style="color:var(--primary-blue); margin-right:5px;"></i> ${plug}</span>
                        <button class="btn btn-danger btn-sm" onclick="removePlugin('${plug}')"><i class="fa-solid fa-trash"></i></button>
                    </div>`).join('')
            : '<div style="color:#666; text-align:center; padding:10px; font-size:0.85rem;">No hay plugins instalados</div>'}
        </div>
        
        <span style="font-size:0.85rem; color:#aaa; font-weight:bold; margin-top:5px;">Plugins Recomendados (Incluidos)</span>
        <div style="background:#111; border:1px solid #333; border-radius:6px; height:200px; overflow-y:auto; padding:8px; display:flex; flex-direction:column; gap:5px;">
            ${defaults.plugins && defaults.plugins.length > 0
            ? defaults.plugins.map(plug => {
                const isInstalled = installed.plugins && installed.plugins.includes(plug.name);
                return `
                    <div style="display:flex; justify-content:space-between; align-items:center; background:#222; padding:8px 12px; border-radius:4px; border:1px solid #333;">
                        <span style="font-size:0.85rem; color:#fff;"><i class="fa-solid fa-star" style="color:var(--gold); margin-right:5px;"></i> ${plug.name}</span>
                        <button class="btn ${isInstalled ? 'btn-outline' : 'btn-green'} btn-sm" ${isInstalled ? 'disabled' : ''} onclick="installDefaultPlugin('${plug.path.replace(/\\/g, '\\\\')}')">
                            ${isInstalled ? '<i class="fa-solid fa-check"></i> Instalado' : '<i class="fa-solid fa-download"></i> Instalar'}
                        </button>
                    </div>`;
            }).join('')
            : '<div style="color:#666; text-align:center; padding:10px; font-size:0.85rem;">No hay plugins en la carpeta base</div>'}
        </div>
    `;
    container.innerHTML = html;
}

function renderServerProfilesList() {
    const list = document.getElementById('server-profiles-list'); if (!list) return;
    list.innerHTML = '';
    serverProfiles.forEach(p => {
        const div = document.createElement('div');
        div.style.cssText = "padding:8px; background:#2b2b2b; border-radius:4px; cursor:pointer; border:1px solid transparent; display:flex; align-items:center; justify-content:space-between;";
        if (String(p.id) === String(activeProfileId)) div.style.borderColor = "#28a745";
        if (String(p.id) === String(editingProfileId)) div.style.background = "#444";
        div.innerHTML = `<span style="font-size:0.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.name}</span>${String(p.id) === String(activeProfileId) ? '<i class="fa-solid fa-circle-check" style="color:#28a745; font-size:0.8rem;"></i>' : ''}`;
        div.onclick = () => loadProfileIntoForm(p.id);
        list.appendChild(div);
    });
}

function createNewServerProfile() {
    editingProfileId = null;
    document.getElementById('conf-profile-name').value = "Nuevo Servidor"; document.getElementById('conf-server-path').value = "";
    document.getElementById('conf-server-xmx').value = "4G"; document.getElementById('conf-server-xms').value = "2G";
    document.getElementById('conf-server-args').value = ""; renderServerProfilesList();
    switchServerTab('config');
}
function loadProfileIntoForm(id) {
    const p = serverProfiles.find(x => String(x.id) === String(id)); if (!p) return;
    editingProfileId = p.id;
    activeProfileId = p.id; // Marcarlo como activo automáticamente
    document.getElementById('conf-profile-name').value = p.name; document.getElementById('conf-server-path').value = p.path;
    document.getElementById('conf-server-xmx').value = p.xmx; document.getElementById('conf-server-xms').value = p.xms;
    document.getElementById('conf-server-args').value = p.args || ""; renderServerProfilesList();
    require('electron').ipcRenderer.send('local-save-server-profiles', { profiles: serverProfiles, activeId: activeProfileId });
    if (document.getElementById('tab-server-plugins').style.display === 'flex') loadServerPlugins();
}
function saveCurrentProfile() {
    const name = document.getElementById('conf-profile-name').value || "Servidor";
    const path = document.getElementById('conf-server-path').value;
    const xmx = document.getElementById('conf-server-xmx').value;
    const xms = document.getElementById('conf-server-xms').value;
    const args = document.getElementById('conf-server-args').value;
    if (editingProfileId) { const p = serverProfiles.find(x => String(x.id) === String(editingProfileId)); if (p) { p.name = name; p.path = path; p.xmx = xmx; p.xms = xms; p.args = args; } }
    else { const newId = Date.now(); serverProfiles.push({ id: newId, name: name, path: path, xmx: xmx, xms: xms, args: args }); editingProfileId = newId; }
    activeProfileId = editingProfileId; // Si guarda uno nuevo, que se active de inmediato
    require('electron').ipcRenderer.send('local-save-server-profiles', { profiles: serverProfiles, activeId: activeProfileId });
    renderServerProfilesList();
}
async function deleteCurrentProfile() {
    if (!editingProfileId) return;
    const p = serverProfiles.find(x => String(x.id) === String(editingProfileId));
    if (!confirm(`¿Eliminar el perfil "${p ? p.name : 'Servidor'}"?`)) return;
    if (p && p.path && p.path.includes('minecraft_servers')) {
        if (confirm("¿Deseas eliminar también la CARPETA del servidor y todos sus archivos del disco?\n\nEsta acción no se puede deshacer.")) {
            const result = await require('electron').ipcRenderer.invoke('local-delete-server-folder', p.path);
            if (!result.success) alert("No se pudo borrar la carpeta: " + result.error);
        }
    }
    serverProfiles = serverProfiles.filter(p => String(p.id) !== String(editingProfileId));
    if (String(activeProfileId) === String(editingProfileId)) activeProfileId = null;
    if (serverProfiles.length > 0) loadProfileIntoForm(serverProfiles[0].id); else createNewServerProfile();
    require('electron').ipcRenderer.send('local-save-server-profiles', { profiles: serverProfiles, activeId: activeProfileId });
    renderServerProfilesList();
}

async function removePlugin(filename) {
    if (!confirm(`¿Seguro que deseas eliminar el plugin "${filename}" del servidor?`)) return;
    const p = serverProfiles.find(x => String(x.id) === String(editingProfileId));
    const res = await require('electron').ipcRenderer.invoke('local-remove-plugin', p.path, filename);
    if (!res.success) alert("Error: " + res.error);
    loadServerPlugins();
}

async function installDefaultPlugin(sourcePath) {
    const p = serverProfiles.find(x => String(x.id) === String(editingProfileId));
    const res = await require('electron').ipcRenderer.invoke('local-install-plugin', p.path, sourcePath);
    if (!res.success) alert("Error instalando plugin: " + res.error);
    loadServerPlugins();
}

async function installCustomPlugin() {
    const p = serverProfiles.find(x => String(x.id) === String(editingProfileId));
    const res = await require('electron').ipcRenderer.invoke('local-pick-and-install-plugin', p.path);
    if (res && !res.success) alert("Error: " + res.error);
    else if (res && res.success) loadServerPlugins();
}

function saveServerConfig() {
    saveCurrentProfile();
    document.getElementById('server-config-modal').style.display = 'none';
}

function showPrompt(title, defaultValue = "") {
    return new Promise((resolve) => {
        const modal = document.getElementById('generic-prompt-modal'); const titleEl = document.getElementById('generic-prompt-title');
        const inputEl = document.getElementById('generic-prompt-input'); const cancelBtn = document.getElementById('generic-prompt-cancel'); const confirmBtn = document.getElementById('generic-prompt-confirm');
        titleEl.innerText = title; inputEl.value = defaultValue;
        const cleanup = () => { modal.style.display = 'none'; cancelBtn.onclick = null; confirmBtn.onclick = null; inputEl.onkeydown = null; };
        cancelBtn.onclick = () => { cleanup(); resolve(null); };
        confirmBtn.onclick = () => { const val = inputEl.value; cleanup(); resolve(val); };
        inputEl.onkeydown = (e) => { if (e.key === 'Enter') confirmBtn.click(); if (e.key === 'Escape') cancelBtn.click(); };
        modal.style.display = 'flex'; inputEl.focus(); inputEl.select();
    });
}
function showMessage(title, text) {
    if (document.getElementById('msg-modal-title')) document.getElementById('msg-modal-title').innerText = title;
    if (document.getElementById('msg-modal-text')) document.getElementById('msg-modal-text').innerText = text;
    if (document.getElementById('message-modal')) document.getElementById('message-modal').style.display = 'flex';
}

const MC_COLORS_LIST = [
    { hex: 'linear-gradient(45deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff)', name: '{colorName}', code: '', label: 'AUTO' },
    { hex: '#000000', name: 'black', code: '§0' }, { hex: '#0000AA', name: 'dark_blue', code: '§1' },
    { hex: '#00AA00', name: 'dark_green', code: '§2' }, { hex: '#00AAAA', name: 'dark_aqua', code: '§3' },
    { hex: '#AA0000', name: 'dark_red', code: '§4' }, { hex: '#AA00AA', name: 'dark_purple', code: '§5' },
    { hex: '#FFAA00', name: 'gold', code: '§6' }, { hex: '#AAAAAA', name: 'gray', code: '§7' },
    { hex: '#555555', name: 'dark_gray', code: '§8' }, { hex: '#5555FF', name: 'blue', code: '§9' },
    { hex: '#55FF55', name: 'green', code: '§a' }, { hex: '#55FFFF', name: 'aqua', code: '§b' },
    { hex: '#FF5555', name: 'red', code: '§c' }, { hex: '#FF55FF', name: 'light_purple', code: '§d' },
    { hex: '#FFFF55', name: 'yellow', code: '§e' }, { hex: '#FFFFFF', name: 'white', code: '§f' }
];
let currentMcColor = MC_COLORS_LIST[15];
let lastFocusedInput = null;

function initColorTools() {
    const container = document.getElementById('mc-swatches'); container.innerHTML = '';
    MC_COLORS_LIST.forEach(c => {
        const div = document.createElement('div');
        div.style.cssText = `width:24px; height:24px; background:${c.hex}; border:1px solid #555; cursor:pointer; border-radius:3px; display:flex; align-items:center; justify-content:center; font-size:0.6rem; font-weight:bold; color:white; text-shadow:0 0 2px black;`;
        div.title = c.label || c.name; if (c.label) div.innerText = "A";
        div.onclick = () => {
            currentMcColor = c; const preview = document.getElementById('mc-color-preview');
            preview.innerText = c.label || c.name; preview.style.background = c.hex;
            preview.style.color = (c.name === 'black' || c.name === 'dark_blue') ? 'white' : 'black';
            if (c.label) preview.style.color = 'white';
        };
        container.appendChild(div);
    });
    ['conf-chat-format', 'conf-gift-format', 'conf-follow-format', 'conf-subscribe-format', 'conf-color-viewer', 'conf-color-follower', 'conf-color-friend'].forEach(id => {
        const el = document.getElementById(id); if (el) el.addEventListener('focus', () => lastFocusedInput = el);
    });
}

function insertColorToFormat(type) {
    if (!lastFocusedInput) return;
    const val = type === 'code' ? currentMcColor.code : currentMcColor.name;
    const start = lastFocusedInput.selectionStart; const end = lastFocusedInput.selectionEnd;
    const text = lastFocusedInput.value;
    lastFocusedInput.value = text.substring(0, start) + val + text.substring(end);
    lastFocusedInput.focus(); lastFocusedInput.selectionStart = lastFocusedInput.selectionEnd = start + val.length;
}

function applyColorToNickname() {
    if (!lastFocusedInput) return;
    const colorName = currentMcColor.name; let text = lastFocusedInput.value;
    if (text.includes('{colorName}')) text = text.replace(/{colorName}/g, colorName);
    else text = text.replace(/("text":"{nickname}","color":")([^"]+)(")/g, `$1${colorName}$3`);
    lastFocusedInput.value = text; lastFocusedInput.style.borderColor = '#28a745';
    setTimeout(() => lastFocusedInput.style.borderColor = '#444', 300);
}

function switchChatTab(tabName, btn) {
    document.querySelectorAll('.chat-tab-content').forEach(el => el.style.display = 'none');
    document.getElementById('tab-' + tabName).style.display = 'block';
    if (btn) { btn.parentElement.querySelectorAll('.btn').forEach(b => b.style.background = 'transparent'); btn.style.background = '#333'; }
}

async function openChatConfig() {
    const config = await require('electron').ipcRenderer.invoke('local-get-chat-config');
    document.getElementById('conf-chat-enabled').checked = config.chat ? config.chat.enabled : false; document.getElementById('conf-chat-format').value = config.chat ? config.chat.format : '';
    document.getElementById('conf-gift-enabled').checked = config.gift ? config.gift.enabled : false; document.getElementById('conf-gift-format').value = config.gift ? config.gift.format : '';
    document.getElementById('conf-follow-enabled').checked = config.follow ? config.follow.enabled : false; document.getElementById('conf-follow-format').value = config.follow ? config.follow.format : '';
    document.getElementById('conf-subscribe-enabled').checked = config.subscribe ? config.subscribe.enabled : false; document.getElementById('conf-subscribe-format').value = config.subscribe ? config.subscribe.format : '';
    document.getElementById('conf-color-viewer').value = config.colors ? config.colors.viewer : 'blue'; document.getElementById('conf-color-follower').value = config.colors ? config.colors.follower : 'dark_green'; document.getElementById('conf-color-friend').value = config.colors ? config.colors.friend : 'gold';
    initColorTools(); document.getElementById('chat-config-modal').style.display = 'flex';
}

function saveChatConfig() {
    const getVal = (id) => { const el = document.getElementById(id); return el.value.trim() || el.placeholder; };
    require('electron').ipcRenderer.send('local-save-chat-config', {
        chat: { enabled: document.getElementById('conf-chat-enabled').checked, format: getVal('conf-chat-format') },
        gift: { enabled: document.getElementById('conf-gift-enabled').checked, format: getVal('conf-gift-format') },
        follow: { enabled: document.getElementById('conf-follow-enabled').checked, format: getVal('conf-follow-format') },
        subscribe: { enabled: document.getElementById('conf-subscribe-enabled').checked, format: getVal('conf-subscribe-format') },
        colors: { viewer: document.getElementById('conf-color-viewer').value || 'blue', follower: document.getElementById('conf-color-follower').value || 'dark_green', friend: document.getElementById('conf-color-friend').value || 'gold' }
    });
    document.getElementById('chat-config-modal').style.display = 'none';
}

function openServerFolder() { require('electron').ipcRenderer.send('local-open-server-folder'); }
function openAlertsWindow() { require('electron').ipcRenderer.send('local-open-alerts-window'); }
function sendTerminalCommand() { const input = document.getElementById('terminal-input'); const cmd = input.value; if (cmd) { require('electron').ipcRenderer.send('local-send-command', cmd); input.value = ''; } }

function createTemplate() {
    document.getElementById('custom-prompt-modal').style.display = 'flex';
    const input = document.getElementById('new-template-name'); input.value = "Nueva Plantilla"; input.focus(); input.select();
}
function closeModal() { document.getElementById('custom-prompt-modal').style.display = 'none'; }
function openTemplate(id) {
    currentTemplateId = id; localStorage.setItem('s4e_active_template_id', id); if (typeof syncWidgetData === 'function') syncWidgetData();
    const t = templates.find(x => x.id === id);
    if (t) { document.getElementById('current-template-name').value = t.name; renderTriggerList(); switchView('dashboard'); }
}
function saveTemplateName() {
    if (!currentTemplateId) return; const t = templates.find(x => x.id === currentTemplateId);
    if (t) { t.name = document.getElementById('current-template-name').value; if (typeof saveTemplates === 'function') saveTemplates(); }
}
function renderTemplateList() {
    const grid = document.getElementById('templates-grid'); if (!grid) return;
    grid.innerHTML = templates.map(t => {
        const images = [...new Set(t.triggers.filter(tr => tr.functionImage).map(tr => tr.functionImage))].slice(0, 4);
        const imagesHtml = images.length > 0 ? `<div class="template-preview-images">${images.map(img => `<img src="${img}" onerror="this.style.display='none'">`).join('')}</div>` : `<div style="height:50px; margin-top:auto; margin-bottom:10px; display:flex; align-items:center; justify-content:center; background:rgba(255,255,255,0.03); border-radius:4px;"><i class="fa-solid fa-image" style="color:#444;"></i></div>`;
        return `<div class="template-card-item" onclick="openTemplate(${t.id})"><div><div class="template-title">${t.name}</div><div class="template-count">${t.triggers.length} activadores</div></div>${imagesHtml}<div class="template-actions"><button class="btn btn-outline btn-sm" onclick="exportTemplate(${t.id}, event)" title="Exportar JSON"><i class="fa-solid fa-file-export"></i></button><button class="btn btn-danger btn-sm" onclick="deleteTemplate(${t.id}, event)"><i class="fa-solid fa-trash"></i></button></div></div>`;
    }).join('');
}
function importTemplate() { document.getElementById('import-file-input').click(); }

function saveTrigger() {
    const typeEl = document.querySelector('#trigger-type-grid .selected'); if (!typeEl) return alert("Selecciona un tipo de evento");
    const typeName = typeEl.getAttribute('data-name');
    const amount = document.getElementById('trigger-amount').value;
    const command = document.getElementById('trigger-commands').value;
    const actionRepetition = document.getElementById('trigger-action-repetition').value;
    const gtaRepetition = document.getElementById('trigger-gta5-repetition').value;
    const actionInterval = document.getElementById('trigger-action-interval').value;
    const gtaInterval = document.getElementById('trigger-gta5-interval').value;
    const actionDelay = document.getElementById('trigger-action-delay').value;
    const gtaDelay = document.getElementById('trigger-gta5-delay').value;
    const audioVolume = document.getElementById('trigger-audio-volume').value;
    const funcEl = document.querySelector('#trigger-function-grid .selected');
    const funcName = funcEl ? funcEl.getAttribute('data-name') : 'Comando';
    const minCoins = document.getElementById('trigger-min-coins').value;
    const maxCoins = document.getElementById('trigger-max-coins').value;
    const keyword = document.getElementById('trigger-keyword').value;
    const followOnce = document.getElementById('trigger-follow-once').checked;
    const keyboardShortcut = document.getElementById('trigger-keyboard-shortcut').value;
    const mediaFile = document.getElementById('trigger-media-file').value;
    const mediaDuration = document.getElementById('trigger-media-duration').value;
    const mediaVolume = document.getElementById('trigger-media-volume').value;
    const mediaShowUser = document.getElementById('trigger-media-show-user').checked;
    const mediaTts = document.getElementById('trigger-media-tts').checked;
    const webhookUrl = document.getElementById('trigger-webhook-url').value;
    const webhookMethod = document.getElementById('trigger-webhook-method').value;
    const webhookPayload = document.getElementById('trigger-webhook-payload').value;
    const webhookHeaders = document.getElementById('trigger-webhook-headers').value;

    if (typeName === 'Regalo' && !selectedGift) return alert("Selecciona un regalo");
    if (typeName === 'Emote' && !selectedEmote) return alert("Selecciona un emote");

    let giftId = typeName === 'Regalo' && selectedGift ? selectedGift.id : null;
    let emoteId = typeName === 'Emote' && selectedEmote ? selectedEmote.id : null;

    let targetList = mediaTriggers;
    if (currentActionMode !== 'media') {
        const t = templates.find(x => x.id === currentTemplateId);
        if (!t) return alert("Error: No hay plantilla seleccionada");
        targetList = t.triggers;
    }

    if (editingTriggerId) {
        const trigger = targetList.find(x => x.id === editingTriggerId);
        if (trigger) {
            trigger.actionType = currentActionMode; trigger.type = typeName; trigger.giftId = giftId; trigger.emoteId = emoteId; trigger.amount = amount; trigger.command = command;
            trigger.webhookUrl = webhookUrl; trigger.webhookMethod = webhookMethod; trigger.webhookPayload = webhookPayload; trigger.webhookHeaders = webhookHeaders;
            trigger.actionRepetition = currentActionMode === 'gta5' ? gtaRepetition : actionRepetition;
            trigger.actionInterval = currentActionMode === 'gta5' ? gtaInterval : actionInterval;
            trigger.actionDelay = currentActionMode === 'gta5' ? gtaDelay : actionDelay;
            trigger.audio = selectedAudio; trigger.audioVolume = audioVolume; trigger.functionImage = selectedFunctionImage; trigger.functionName = funcName; trigger.minCoins = minCoins; trigger.maxCoins = maxCoins; trigger.keyword = keyword; trigger.followOnce = followOnce; trigger.keyboardShortcut = keyboardShortcut; trigger.mediaFile = mediaFile; trigger.mediaDuration = mediaDuration; trigger.mediaVolume = mediaVolume; trigger.mediaShowUser = mediaShowUser; trigger.mediaTts = mediaTts;
        }
    } else {
        const newTrigger = {
            id: Date.now(), type: typeName, actionType: currentActionMode, giftId: giftId, emoteId: emoteId, amount: amount, command: command,
            webhookUrl: webhookUrl, webhookMethod: webhookMethod, webhookPayload: webhookPayload, webhookHeaders: webhookHeaders,
            actionRepetition: currentActionMode === 'gta5' ? gtaRepetition : actionRepetition,
            actionInterval: currentActionMode === 'gta5' ? gtaInterval : actionInterval,
            actionDelay: currentActionMode === 'gta5' ? gtaDelay : actionDelay,
            active: true, audio: selectedAudio, audioVolume: audioVolume, functionImage: selectedFunctionImage, functionName: funcName, minCoins: minCoins, maxCoins: maxCoins, keyword: keyword, followOnce: followOnce, keyboardShortcut: keyboardShortcut, mediaFile: mediaFile, mediaDuration: mediaDuration, mediaVolume: mediaVolume, mediaShowUser: mediaShowUser, mediaTts: mediaTts
        };
        targetList.push(newTrigger);
    }

    if (typeName === 'AllLikes') {
        sessionGlobalLikes = 0;
        templates.forEach(tpl => { if (tpl.triggers) { tpl.triggers.forEach(tr => { if (tr.type === 'AllLikes') delete triggerRuntimeState[tr.id]; }); } });
    }

    if (currentActionMode === 'media') {
        require('electron').ipcRenderer.send('local-save-media-triggers', mediaTriggers);
        localStorage.setItem('s4e_local_media_triggers', JSON.stringify(mediaTriggers));
    } else { if (typeof saveTemplates === 'function') saveTemplates(); }

    if (currentActionMode === 'media') renderMediaList(); else renderTriggerList();
    if (typeof updateAppShortcuts === 'function') updateAppShortcuts();
    switchView(currentActionMode === 'media' ? 'media' : 'dashboard');
    renderWidgetPreview();
}

function toggleTrigger(id, isActive) {
    let found = false; const t = templates.find(x => x.id === currentTemplateId);
    if (t) { const trigger = t.triggers.find(x => x.id === id); if (trigger) { trigger.active = isActive; if (typeof saveTemplates === 'function') saveTemplates(); if (typeof updateAppShortcuts === 'function') updateAppShortcuts(); found = true; } }
    if (!found) { const trigger = mediaTriggers.find(x => x.id === id); if (trigger) { trigger.active = isActive; require('electron').ipcRenderer.send('local-save-media-triggers', mediaTriggers); localStorage.setItem('s4e_local_media_triggers', JSON.stringify(mediaTriggers)); } }
    renderWidgetPreview();
}

function editTrigger(id, section = 'event') {
    let trigger = null; const t = templates.find(x => x.id === currentTemplateId);
    if (t) trigger = t.triggers.find(x => x.id === id);
    if (!trigger) trigger = mediaTriggers.find(x => x.id === id);
    if (!trigger) return;
    editingTriggerId = id; currentActionMode = trigger.actionType || 'minecraft';
    document.getElementById('trigger-amount').value = trigger.amount; document.getElementById('trigger-commands').value = trigger.command || '';
    document.getElementById('trigger-webhook-url').value = trigger.webhookUrl || ''; document.getElementById('trigger-webhook-method').value = trigger.webhookMethod || 'GET';
    document.getElementById('trigger-webhook-payload').value = trigger.webhookPayload || ''; document.getElementById('trigger-webhook-headers').value = trigger.webhookHeaders || '';
    const presetSelect = document.getElementById('gta5-preset-select'); if (presetSelect) { presetSelect.value = ""; if (trigger.webhookUrl) presetSelect.value = trigger.webhookUrl; }
    document.getElementById('trigger-action-repetition').value = trigger.actionRepetition || 1; document.getElementById('trigger-action-interval').value = trigger.actionInterval || 0; document.getElementById('trigger-action-delay').value = trigger.actionDelay || 0;
    document.getElementById('trigger-gta5-repetition').value = trigger.actionRepetition || 1; document.getElementById('trigger-gta5-interval').value = trigger.actionInterval || 0; document.getElementById('trigger-gta5-delay').value = trigger.actionDelay || 0;
    if (document.getElementById('trigger-gta5-image-url')) document.getElementById('trigger-gta5-image-url').value = trigger.functionImage || '';
    document.getElementById('trigger-image-url').value = trigger.functionImage || ''; selectedAudio = trigger.audio || null;
    document.getElementById('trigger-audio-volume').value = trigger.audioVolume !== undefined ? trigger.audioVolume : 50; document.getElementById('audio-volume-display').innerText = (trigger.audioVolume !== undefined ? trigger.audioVolume : 50) + '%';
    if (selectedAudio) selectAudio(selectedAudio); else removeSelectedAudio();
    selectedFunctionImage = trigger.functionImage || null;
    document.getElementById('trigger-min-coins').value = trigger.minCoins || 0; document.getElementById('trigger-max-coins').value = trigger.maxCoins || 100;
    document.getElementById('trigger-keyword').value = trigger.keyword || ''; document.getElementById('trigger-follow-once').checked = trigger.followOnce !== false; document.getElementById('trigger-keyboard-shortcut').value = trigger.keyboardShortcut || '';
    document.getElementById('trigger-media-file').value = trigger.mediaFile || ''; document.getElementById('trigger-media-duration').value = trigger.mediaDuration || 5;
    const mVol = trigger.mediaVolume !== undefined ? trigger.mediaVolume : 100; document.getElementById('trigger-media-volume').value = mVol; document.getElementById('media-volume-display').innerText = mVol + '%';
    document.getElementById('trigger-media-show-user').checked = trigger.mediaShowUser || false;
    document.getElementById('trigger-media-tts').checked = trigger.mediaTts || false;
    document.querySelectorAll('#trigger-type-grid .trigger-card').forEach(card => { if (card.getAttribute('data-name') === trigger.type) card.click(); });
    if (trigger.type === 'Regalo' && trigger.giftId) { setTimeout(() => { const giftCard = document.querySelector(`.gift-card-new[data-id="${trigger.giftId}"]`); if (giftCard) selectGift(giftCard, tiktokGiftsAPI.find(g => String(g.id) === String(trigger.giftId))); }, 100); }
    if (trigger.type === 'Emote' && trigger.emoteId) { setTimeout(() => { const emoteCard = document.querySelector(`#emote-api-grid .gift-card-new[data-id="${trigger.emoteId}"]`); if (emoteCard) selectEmote(emoteCard, tiktokEmotesAPI.find(e => String(e.id) === String(trigger.emoteId))); }, 100); }
    if (typeof renderAudioList === 'function') renderAudioList(typeof POPULAR_SOUNDS !== 'undefined' ? POPULAR_SOUNDS : []);

    let titleText = "Editar Activador";
    if (section === 'event') { showSection('section-event-config'); titleText = "Editar Evento"; }
    else if (section === 'function') {
        if (currentActionMode === 'media') showSection('section-media-config'); else if (currentActionMode === 'gta5') showSection('section-gta5-config'); else showSection('section-minecraft-config');
        if (currentActionMode === 'gta5') titleText = "Editar Acción GTA 5"; else if (currentActionMode === 'media') titleText = "Editar Multimedia"; else titleText = "Editar Acción Minecraft";
    }
    else if (section === 'audio') { showSection('section-audio-config'); titleText = "Editar Sonido"; }
    document.getElementById('trigger-view-title').innerHTML = `<i class="fa-solid fa-pen" style="color:var(--gold);"></i> ${titleText}`;
    document.getElementById('btn-save-trigger').innerHTML = '<i class="fa-solid fa-save"></i> Guardar Cambios';
    toggleWebhookPayload(); switchView('new-trigger');
}
function openNewTriggerView(mode = 'minecraft') {
    if (mode === true) mode = 'media'; if (mode === false) mode = 'minecraft';
    currentActionMode = mode; editingTriggerId = null;
    document.getElementById('trigger-amount').value = 1; document.getElementById('trigger-commands').value = "/summon tnt ~ ~5 ~";
    document.getElementById('trigger-webhook-url').value = ""; document.getElementById('trigger-webhook-method').value = (currentActionMode === 'gta5') ? "POST" : "GET";
    document.getElementById('trigger-webhook-payload').value = ""; document.getElementById('trigger-webhook-headers').value = "";
    const presetSelect = document.getElementById('gta5-preset-select'); if (presetSelect) presetSelect.value = "";
    document.getElementById('trigger-action-repetition').value = 1; document.getElementById('trigger-action-interval').value = 0; document.getElementById('trigger-action-delay').value = 0;
    document.getElementById('trigger-gta5-repetition').value = 1; document.getElementById('trigger-gta5-interval').value = 0; document.getElementById('trigger-gta5-delay').value = 0;
    if (document.getElementById('trigger-gta5-image-url')) document.getElementById('trigger-gta5-image-url').value = "";
    document.getElementById('trigger-audio-volume').value = 50; document.getElementById('audio-volume-display').innerText = '50%';
    document.getElementById('trigger-image-url').value = ""; selectedGift = null; selectedEmote = null; selectedAudio = null; removeSelectedAudio(); selectedFunctionImage = null;
    document.getElementById('trigger-min-coins').value = 0; document.getElementById('trigger-max-coins').value = 100; document.getElementById('trigger-keyword').value = "";
    document.getElementById('trigger-follow-once').checked = true; document.getElementById('trigger-keyboard-shortcut').value = "";
    document.getElementById('trigger-media-file').value = ""; document.getElementById('trigger-media-duration').value = 5; document.getElementById('trigger-media-show-user').checked = false;
    document.getElementById('trigger-media-tts').checked = false;

    document.querySelectorAll('.trigger-card').forEach(c => c.classList.remove('selected'));
    const likesCard = document.querySelector('#trigger-type-grid .trigger-card[data-name="Likes"]'); if (likesCard) likesCard.classList.add('selected');
    const cmdCard = document.querySelector('#trigger-function-grid .trigger-card[data-name="Comando"]'); if (cmdCard) cmdCard.classList.add('selected');

    document.getElementById('gift-selection-area').style.display = 'none'; document.getElementById('emote-selection-area').style.display = 'none';
    document.getElementById('section-minecraft-config').style.display = 'none'; document.getElementById('section-media-config').style.display = 'none'; document.getElementById('section-gta5-config').style.display = 'none';
    if (currentActionMode === 'media') document.getElementById('section-media-config').style.display = 'block'; else if (currentActionMode === 'gta5') document.getElementById('section-gta5-config').style.display = 'block'; else document.getElementById('section-minecraft-config').style.display = 'block';

    document.getElementById('trigger-view-title').innerHTML = '<i class="fa-solid fa-bolt" style="color:var(--gold);"></i> Nuevo Activador';
    document.getElementById('btn-save-trigger').innerHTML = '<i class="fa-solid fa-check"></i> Crear Activador';
    showSection('section-event-config'); toggleWebhookPayload(); if (typeof renderAudioList === 'function') renderAudioList(typeof POPULAR_SOUNDS !== 'undefined' ? POPULAR_SOUNDS : []); switchView('new-trigger');
}
function cancelEdit() { editingTriggerId = null; switchView(currentActionMode === 'media' ? 'media' : 'dashboard'); }
function showSection(sectionId) {
    document.getElementById('section-event-config').style.display = 'none'; document.getElementById('section-minecraft-config').style.display = 'none'; document.getElementById('section-media-config').style.display = 'none'; document.getElementById('section-gta5-config').style.display = 'none'; document.getElementById('section-audio-config').style.display = 'none';
    const target = document.getElementById(sectionId);
    if (target) { target.style.display = 'block'; const header = target.querySelector('.accordion-header'); const content = target.querySelector('.accordion-content'); if (header && content) { header.classList.add('active'); content.classList.add('active'); } }
}
function selectTriggerType(element, typeName) {
    let siblings = element.parentElement.children; for (let sib of siblings) sib.classList.remove('selected'); element.classList.add('selected');
    const giftArea = document.getElementById('gift-selection-area');
    if (typeName === 'Regalo') { giftArea.style.display = 'block'; if (!giftArea.querySelector('.gift-card-new')) initGiftGrid(); }
    else if (typeName === 'Emote') { giftArea.style.display = 'none'; document.getElementById('emote-selection-area').style.display = 'block'; initEmoteGrid(); selectedGift = null; }
    else { giftArea.style.display = 'none'; document.getElementById('emote-selection-area').style.display = 'none'; selectedGift = null; selectedEmote = null; }
    const extraConfig = document.getElementById('extra-config-area'); const configCoins = document.getElementById('config-coins'); const configChat = document.getElementById('config-chat'); const configFollow = document.getElementById('config-follow'); const descBox = document.getElementById('trigger-description');
    if (typeof TRIGGER_DESCRIPTIONS !== 'undefined' && TRIGGER_DESCRIPTIONS[typeName]) { descBox.style.display = 'block'; descBox.innerText = TRIGGER_DESCRIPTIONS[typeName]; } else { descBox.style.display = 'none'; }
    if (typeName === 'Coins' || typeName === 'Chat' || typeName === 'Follow') { extraConfig.style.display = 'block'; configCoins.style.display = typeName === 'Coins' ? 'block' : 'none'; configChat.style.display = typeName === 'Chat' ? 'block' : 'none'; configFollow.style.display = typeName === 'Follow' ? 'block' : 'none'; } else { extraConfig.style.display = 'none'; }
    const amountLabel = document.getElementById('amount-label');
    if (amountLabel) { if (typeName === 'AllLikes') amountLabel.innerText = "Cada X Likes (Global)"; else if (typeName === 'Likes') amountLabel.innerText = "Mínimo Likes (Usuario)"; else if (typeName === 'Compartir') amountLabel.innerText = "Time Limit for user (no more often than)"; else amountLabel.innerText = "Cantidad / Repeticiones"; }
}
const TRIGGER_DESCRIPTIONS = {
    'Likes': "The number of likes that 1 viewer must give for the event to be executed. Best 15 - 150",
    'AllLikes': "The number of likes that all viewers must give for the event to happen.",
    'Follow': "Si marcas esta casilla, el evento solo se seguirá una vez por cada espectador durante la emisión actual. Esto es una protección para evitar que hagas spam en el evento desmarcando y volviendo a marcar la opción de seguir, activo defaul",
    'Coins': "Minimum gift price for it to trigger an event. Expl : 99-150",
    'Join': "When a new viewer enters the broadcast, it does not work for Top donors who are level 3 or higher.",
    'Chat': "Se activa cuando alguien escribe un mensaje en el chat y coincide con la palabra agregada",
    'Compartir': "Triggers when someone shares the Wi-Fi broadcast via the share button Time Limit for user (no more often than):",
    'Subscribe': "Triggers when someone has paid for a Super Fan to your TikTok broadcasts",
    'Regalo': "Select a gift to trigger this event.",
    'Keyboard': "Ejecuta la acción al presionar una combinación de teclas (Globalmente).",
    'Emote': "Se activa cuando un suscriptor envía un emote específico en el chat."
};
function selectFunction(element) { let siblings = element.parentElement.children; for (let sib of siblings) sib.classList.remove('selected'); element.classList.add('selected'); }
async function selectMediaFile() { const path = await require('electron').ipcRenderer.invoke('local-select-media'); if (path) { const fileUrl = 'file:///' + path.replace(/\\/g, '/'); document.getElementById('trigger-media-file').value = fileUrl; } }

function initGtaPresets() {
    try {
        const path = require('path'); const fs = require('fs'); const jsonPath = path.join(__dirname, 'gta5comandos.json');
        if (fs.existsSync(jsonPath)) {
            let content = fs.readFileSync(jsonPath, 'utf8').trim();
            if (content.startsWith(',')) content = content.substring(1); if (!content.startsWith('[')) content = `[${content}]`;
            try { gtaPresets = JSON.parse(content); } catch (e) { console.error("Error parsing gta5comandos.json:", e); }
        }
    } catch (e) { console.error("Error loading GTA presets:", e); }
    renderGtaPresets(gtaPresets);
}
function renderGtaPresets(list) {
    const select = document.getElementById('gta5-preset-select'); if (!select) return;
    const currentVal = select.value; select.innerHTML = '<option value="">-- Seleccionar Acción --</option>';
    if (!list || list.length === 0) return;
    const groups = {};
    list.forEach(item => { const cat = item.Categoria || 'General'; if (!groups[cat]) groups[cat] = []; groups[cat].push(item); });
    const sortedCats = Object.keys(groups).sort();
    sortedCats.forEach(cat => {
        const group = document.createElement('optgroup'); group.label = cat;
        groups[cat].forEach(item => {
            const opt = document.createElement('option'); opt.value = item.Webhook; opt.innerText = item.Descripción || item.Webhook;
            if (item["Variaciones que puedes cambiar"]) opt.setAttribute('data-variations', item["Variaciones que puedes cambiar"]);
            group.appendChild(opt);
        }); select.appendChild(group);
    });
    if (currentVal) select.value = currentVal;
}
function filterGtaPresets() {
    const term = document.getElementById('gta5-preset-search').value.toLowerCase();
    if (!term) { renderGtaPresets(gtaPresets); return; }
    const filtered = gtaPresets.filter(item => { const desc = (item.Descripción || '').toLowerCase(); const cat = (item.Categoria || '').toLowerCase(); const cmd = (item.Webhook || '').toLowerCase(); return desc.includes(term) || cat.includes(term) || cmd.includes(term); });
    renderGtaPresets(filtered);
}
function applyGtaPreset() {
    const select = document.getElementById('gta5-preset-select'); const val = select.value; if (!val) return;
    document.getElementById('trigger-webhook-url').value = val;
    const opt = select.options[select.selectedIndex]; const variations = opt.getAttribute('data-variations'); const descBox = document.getElementById('trigger-description');
    if (variations) { descBox.style.display = 'block'; descBox.innerText = "ℹ️ " + variations; }
}

function renderTriggerList() {
    const list = document.getElementById('main-event-list'); const header = list.querySelector('.event-header'); list.innerHTML = ''; if (header) list.appendChild(header);
    const t = templates.find(x => x.id === currentTemplateId); if (!t) return;
    t.triggers.filter(tr => tr.actionType !== 'media').forEach(t => {
        let displayName = t.type; let displayIcon = ''; let displayIconClass = ''; let actionIcon = '<i class="fa-solid fa-terminal" style="color:#ffd700"></i>';
        if (t.type === 'Likes') { displayIcon = '<i class="fa-solid fa-heart"></i>'; displayIconClass = 'icon-red'; }
        else if (t.type === 'Regalo') { const gift = tiktokGiftsAPI.find(g => String(g.id) === String(t.giftId)); if (gift) { displayName = `${gift.name} <span style="color:var(--gold); font-weight:bold;">(${gift.cost}🟡)</span>`; displayIcon = `<img src="${gift.icon}" style="width:25px; height:25px; object-fit:contain;">`; } else { displayName = 'Gift ' + (t.giftId || '?'); displayIcon = '<i class="fa-solid fa-gift"></i>'; displayIconClass = 'icon-cyan'; } }
        else if (t.type === 'Emote') { const emote = tiktokEmotesAPI.find(e => String(e.id) === String(t.emoteId)); if (emote) { if (emote.name === `#${t.emoteId}`) displayName = `Emote: ${emote.name}`; else displayName = `Emote: ${emote.name} <span style="color:#888; font-size:0.8rem;">#${t.emoteId}</span>`; displayIcon = `<img src="${emote.icon}" style="width:25px; height:25px; object-fit:contain;">`; } else { displayName = 'Emote ' + (t.emoteId || '?'); displayIcon = '<i class="fa-solid fa-face-smile"></i>'; displayIconClass = 'icon-gold'; } }
        else if (t.type === 'Compartir') { displayIcon = '<i class="fa-solid fa-share"></i>'; displayIconClass = 'icon-white'; }
        else if (t.type === 'AllLikes') { displayIcon = '<i class="fa-solid fa-heart-circle-plus"></i>'; displayIconClass = 'icon-red'; displayName = "Lluvia de Likes"; }
        else if (t.type === 'Follow') { displayIcon = '<i class="fa-solid fa-user-plus"></i>'; displayIconClass = 'icon-blue'; }
        else if (t.type === 'Join') { displayIcon = '<i class="fa-solid fa-door-open"></i>'; displayIconClass = 'icon-green'; displayName = "Viewer Join"; }
        else if (t.type === 'Chat') { displayIcon = '<i class="fa-solid fa-comments"></i>'; displayIconClass = 'icon-white'; displayName = t.keyword ? `Chat: "${t.keyword}"` : "Cualquier Chat"; }
        else if (t.type === 'Coins') { displayIcon = '<i class="fa-solid fa-coins"></i>'; displayIconClass = 'icon-gold'; displayName = `Coins (${t.minCoins}-${t.maxCoins})`; }
        else if (t.type === 'Subscribe') { displayIcon = '<i class="fa-solid fa-star"></i>'; displayIconClass = 'icon-gold'; displayName = "Super Fan"; }
        else if (t.type === 'Keyboard') { displayIcon = '<i class="fa-solid fa-keyboard"></i>'; displayIconClass = 'icon-white'; displayName = "Teclado"; }
        if (t.keyboardShortcut) displayName += ` <span style="background:#333; padding:2px 6px; border-radius:4px; font-size:0.7rem; border:1px solid #555; color:#00d2d3;">${t.keyboardShortcut}</span>`;
        if (t.functionImage) actionIcon = `<img src="${t.functionImage}" style="width:25px; height:25px; object-fit:cover; border-radius:4px;">`; else if (t.actionType === 'gta5') actionIcon = '<i class="fa-solid fa-car" style="color:var(--purple)"></i>';
        const div = document.createElement('div'); div.style.display = 'contents'; div.innerHTML = getRowHTML(t, displayName, displayIcon, displayIconClass, actionIcon); list.appendChild(div.firstElementChild);
    }); renderWidgetPreview();
}
function renderMediaList() {
    const list = document.getElementById('media-event-list'); const header = list.querySelector('.event-header'); list.innerHTML = ''; if (header) list.appendChild(header);
    mediaTriggers.forEach(t => {
        let displayName = t.type; let displayIcon = ''; let displayIconClass = '';
        if (t.type === 'Likes') { displayIcon = '<i class="fa-solid fa-heart"></i>'; displayIconClass = 'icon-red'; }
        else if (t.type === 'Regalo') { const gift = tiktokGiftsAPI.find(g => String(g.id) === String(t.giftId)); if (gift) { displayName = `${gift.name} <span style="color:var(--gold); font-weight:bold;">(${gift.cost}🟡)</span>`; displayIcon = `<img src="${gift.icon}" style="width:25px; height:25px; object-fit:contain;">`; } else { displayName = 'Gift ' + (t.giftId || '?'); displayIcon = '<i class="fa-solid fa-gift"></i>'; displayIconClass = 'icon-cyan'; } }
        else if (t.type === 'Emote') { const emote = tiktokEmotesAPI.find(e => String(e.id) === String(t.emoteId)); if (emote) { displayName = `Emote: ${emote.name}`; displayIcon = `<img src="${emote.icon}" style="width:25px; height:25px; object-fit:contain;">`; } else { displayName = 'Emote ' + (t.emoteId || '?'); displayIcon = '<i class="fa-solid fa-face-smile"></i>'; displayIconClass = 'icon-gold'; } }
        else { displayIcon = '<i class="fa-solid fa-bolt"></i>'; displayIconClass = 'icon-white'; }
        let actionIcon = '<i class="fa-solid fa-photo-film" style="color:#28a745"></i>'; let actionText = t.mediaFile ? t.mediaFile.split(/[/\\]/).pop() : 'Sin archivo';
        if (t.mediaFile && t.mediaFile.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i)) actionIcon = `<img src="${t.mediaFile}" style="width:25px; height:25px; object-fit:cover; border-radius:4px;">`;
        const tempDiv = document.createElement('div'); tempDiv.innerHTML = getRowHTML(t, displayName, displayIcon, displayIconClass, actionIcon);
        const actionSpan = tempDiv.querySelector('.event-action span'); if (actionSpan) actionSpan.innerText = actionText;
        const actionDiv = tempDiv.querySelector('.event-action'); if (actionDiv) actionDiv.onclick = () => editTrigger(t.id, 'function');
        const div = document.createElement('div'); div.style.display = 'contents'; div.innerHTML = tempDiv.innerHTML; list.appendChild(div.firstElementChild);
    });
}
function renderWidgetPreview() {
    const containerDashboard = document.getElementById('widget-preview-content'); const containerHome = document.getElementById('home-widget-preview');
    const targets = []; if (containerDashboard) targets.push(containerDashboard); if (containerHome) targets.push(containerHome);
    if (targets.length === 0) return;
    const t = templates.find(x => x.id === currentTemplateId); let contentHTML = '';
    if (!t || !t.triggers) { contentHTML = '<div style="color:#666; width:100%; text-align:center; padding:10px;">Sin activadores</div>'; }
    else {
        const activeTriggers = t.triggers.filter(tr => tr.active && tr.actionType !== 'media');
        if (activeTriggers.length === 0) { contentHTML = '<div style="color:#666; width:100%; text-align:center; padding:10px; font-size:0.85rem;">Añade activadores para ver la vista previa aquí.</div>'; }
        else {
            contentHTML = activeTriggers.map(tr => {
                let bottomContent = '';
                if (tr.type === 'Regalo') { let giftImg = 'https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/802a21ae29f9fae5abe3693de9f874bd~tplv-obj.webp'; if (tr.giftId) { const g = tiktokGiftsAPI.find(x => String(x.id) === String(tr.giftId)); if (g) giftImg = g.icon || (g.image && g.image.url_list ? g.image.url_list[0] : giftImg); } bottomContent = `<img src="${giftImg}" style="width:35px; height:35px; object-fit:contain; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));">`; }
                else if (tr.type === 'Emote') { let emoteImg = 'https://placehold.co/35x35/333/ccc?text=Emote'; if (tr.emoteId) { const e = tiktokEmotesAPI.find(x => String(x.id) === String(tr.emoteId)); if (e) emoteImg = e.icon; } bottomContent = `<img src="${emoteImg}" style="width:35px; height:35px; object-fit:contain; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));">`; }
                else if (tr.type === 'Likes') { bottomContent = `<div class="preview-like-container"><i class="fa-solid fa-heart preview-like-heart" style="filter: drop-shadow(0 2px 2px rgba(0,0,0,0.3));"></i><span class="preview-like-count">${tr.amount || 15}</span></div>`; }
                else if (tr.type === 'AllLikes') { bottomContent = `<div class="preview-like-container"><i class="fa-solid fa-heart preview-like-heart preview-all-likes" style="filter: drop-shadow(0 2px 2px rgba(0,0,0,0.3));"></i><span class="preview-like-count">${tr.amount || 100}</span></div>`; }
                else if (tr.type === 'Compartir') { bottomContent = `<div class="preview-icon-container"><i class="fa-solid fa-share preview-widget-icon"></i></div>`; }
                else if (tr.type === 'Follow') { bottomContent = `<div class="preview-icon-container"><i class="fa-solid fa-user-plus preview-widget-icon" style="color:#00a8ff;"></i></div>`; }
                else if (tr.type === 'Join') { bottomContent = `<div class="preview-icon-container"><i class="fa-solid fa-door-open preview-widget-icon" style="color:#2ecc71;"></i></div>`; }
                else if (tr.type === 'Chat') { bottomContent = `<div class="preview-icon-container"><i class="fa-solid fa-comments preview-widget-icon"></i></div>`; }
                else if (tr.type === 'Coins') { bottomContent = `<div class="preview-icon-container"><i class="fa-solid fa-coins preview-widget-icon" style="color:#ffd700;"></i></div>`; }
                else if (tr.type === 'Subscribe') { bottomContent = `<div class="preview-icon-container"><i class="fa-solid fa-star preview-widget-icon" style="color:#ffd700;"></i></div>`; }
                else if (tr.type === 'Keyboard') { bottomContent = `<div class="preview-icon-container"><i class="fa-solid fa-keyboard preview-widget-icon"></i></div>`; }
                let actionContent = `<i class="fa-solid fa-terminal" style="font-size:2rem; color:#ffd700;"></i>`;
                if (tr.functionImage) actionContent = `<img src="${tr.functionImage}" style="width:100%; height:100%; object-fit:contain; filter:drop-shadow(0 0 5px rgba(255, 215, 0, 0.5));">`;
                return `<div class="preview-item"><div class="preview-repetition-badge">${tr.actionRepetition || 1}x</div><div class="preview-action-image-container">${actionContent}</div>${bottomContent}</div>`;
            }).join('');
        }
    }
    targets.forEach(el => el.innerHTML = contentHTML);
}
function getRowHTML(trigger, displayName, displayIcon, displayIconClass, actionIcon) {
    let actionText = '';
    if (trigger.actionType === 'gta5') { let url = trigger.webhookUrl || 'Sin URL'; if (url.startsWith('!') || url.startsWith('$')) url = url.substring(1); actionText = url.length > 25 ? url.substring(0, 25) + '...' : url; }
    else { actionText = trigger.command ? trigger.command.substring(0, 20) + (trigger.command.length > 20 ? '...' : '') : ''; }
    return `<div class="event-row" id="trigger-${trigger.id}"><div class="event-icon ${displayIconClass}" onclick="editTrigger(${trigger.id}, 'event')" style="cursor:pointer" title="Editar Evento">${displayIcon}</div><div class="event-info" onclick="editTrigger(${trigger.id}, 'event')" style="cursor:pointer" title="Editar Evento"><small>${displayName} (x${trigger.amount})</small></div><div class="event-action" onclick="editTrigger(${trigger.id}, 'function')" style="cursor:pointer" title="Editar Comando">${actionIcon}<span>${actionText}</span></div><div class="event-sound" onclick="editTrigger(${trigger.id}, 'audio')" style="cursor:pointer" title="Editar Sonido">${trigger.audio ? trigger.audio.title : 'Sin audio'}</div><div class="check-container" onclick="event.stopPropagation()"><input type="checkbox" ${trigger.active ? 'checked' : ''} onchange="toggleTrigger(${trigger.id}, this.checked)"></div><div style="display:flex; gap:5px;"><button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); moveTrigger(${trigger.id}, -1)" title="Subir"><i class="fa-solid fa-arrow-up"></i></button><button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); moveTrigger(${trigger.id}, 1)" title="Bajar"><i class="fa-solid fa-arrow-down"></i></button><button class="btn btn-blue btn-sm" onclick="event.stopPropagation(); typeof testTrigger==='function'?testTrigger(${trigger.id}):null" title="Probar ahora" style="padding: 5px 8px;"><i class="fa-solid fa-play"></i></button><button class="btn btn-sm" style="background-color:var(--gold); color:black; padding: 5px 8px;" onclick="event.stopPropagation(); typeof testTriggerDelayed==='function'?testTriggerDelayed(${trigger.id}, this):null" title="Probar en 5s"><i class="fa-solid fa-clock"></i></button><button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); typeof deleteTrigger==='function'?deleteTrigger(${trigger.id}):null" title="Eliminar" style="padding: 5px 8px;"><i class="fa-solid fa-trash"></i></button></div></div>`;
}
function toggleAccordion(id) {
    document.querySelectorAll('.accordion-content').forEach(el => el.classList.remove('active')); document.querySelectorAll('.accordion-header').forEach(el => el.classList.remove('active'));
    const content = document.getElementById(id); const header = content ? content.previousElementSibling : null;
    if (content) { content.classList.add('active'); if (header) header.classList.add('active'); }
}

const shortcutInput = document.getElementById('trigger-keyboard-shortcut');
if (shortcutInput) {
    shortcutInput.addEventListener('keydown', (e) => {
        e.preventDefault(); e.stopPropagation(); const keys = [];
        if (e.ctrlKey) keys.push('Ctrl'); if (e.shiftKey) keys.push('Shift'); if (e.altKey) keys.push('Alt'); if (e.metaKey) keys.push('Super');
        let key = e.key; if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return;
        if (key === ' ') key = 'Space'; if (key.length === 1) key = key.toUpperCase();
        keys.push(key); shortcutInput.value = keys.join('+');
    });
}
function clearShortcut() { document.getElementById('trigger-keyboard-shortcut').value = ''; }

function renderGiftGrid(giftsToRender) {
    const container = document.getElementById('gift-api-grid'); if (!container) return; container.innerHTML = "";
    if (!giftsToRender || giftsToRender.length === 0) { container.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 20px; color: #888; font-size: 0.9rem;">No hay regalos cargados.<br>Conecta a TikTok para descargar la lista.</div>'; return; }
    giftsToRender.forEach(gift => {
        const card = document.createElement('div'); card.className = "gift-card-new"; card.setAttribute('data-id', gift.id);
        if (selectedGift && String(selectedGift.id) === String(gift.id)) card.classList.add('selected');
        card.onclick = () => selectGift(card, gift);
        card.innerHTML = `<img src="${gift.icon}" alt="${gift.name}" onerror="this.src='https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/802a21ae29f9fae5abe3693de9f874bd~tplv-obj.webp'"><div class="name">${gift.name}</div><div class="price">${gift.cost} 🟡</div>`;
        container.appendChild(card);
    });
}
function initGiftGrid() { filterGifts(); }
function filterGifts(pillType, pillElement) {
    const searchTerm = document.getElementById('gift-search-input').value.toLowerCase();
    const hideUsed = document.getElementById('hide-used-gifts').checked;
    if (pillElement) { document.querySelectorAll('.gift-pill').forEach(p => p.classList.remove('active')); pillElement.classList.add('active'); }
    let usedGiftIds = [];
    if (currentTemplateId) { const t = templates.find(x => x.id === currentTemplateId); if (t && t.triggers) usedGiftIds = t.triggers.filter(tr => tr.type === 'Regalo').map(tr => String(tr.giftId)); }
    const filtered = tiktokGiftsAPI.filter(gift => {
        const matchesSearch = gift.name.toLowerCase().includes(searchTerm) || String(gift.cost).includes(searchTerm);
        const isUsed = usedGiftIds.includes(String(gift.id));
        if (hideUsed && isUsed) return false; if (pillType === 'selected' && (!selectedGift || String(gift.id) !== String(selectedGift.id))) return false; if (pillType === 'used' && !isUsed) return false;
        return matchesSearch;
    }); renderGiftGrid(filtered);
}
function selectGift(element, giftData) { document.querySelectorAll('.gift-card-new').forEach(c => c.classList.remove('selected')); element.classList.add('selected'); selectedGift = giftData; }

function initEmoteGrid() { filterEmotes(); }
function filterEmotes() { const searchTerm = document.getElementById('emote-search-input').value.toLowerCase(); const filtered = tiktokEmotesAPI.filter(emote => emote.name.toLowerCase().includes(searchTerm) || String(emote.id).includes(searchTerm)); renderEmoteGrid(filtered); }
function renderEmoteGrid(emotesToRender) {
    const container = document.getElementById('emote-api-grid'); if (!container) return; container.innerHTML = "";
    if (!emotesToRender || emotesToRender.length === 0) { container.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 20px; color: #888; font-size: 0.9rem;">No se encontraron emotes al conectar.<br><span style="color:var(--gold)">Revisa la consola (Ctrl+Shift+I) para ver detalles.<br>O pide que usen un emote en el chat.</span></div>'; return; }
    emotesToRender.forEach(emote => {
        const card = document.createElement('div'); card.className = "gift-card-new"; card.setAttribute('data-id', emote.id);
        if (selectedEmote && String(selectedEmote.id) === String(emote.id)) card.classList.add('selected');
        card.onclick = () => selectEmote(card, emote);
        const deleteBtn = document.createElement('div'); deleteBtn.innerHTML = '<i class="fa-solid fa-times"></i>'; deleteBtn.style.cssText = 'position:absolute; top:2px; right:2px; color:#fff; background:rgba(220, 53, 69, 0.8); border-radius:50%; width:20px; height:20px; display:flex; justify-content:center; align-items:center; font-size:0.8rem; cursor:pointer; z-index:10; transition: background 0.2s;';
        deleteBtn.onmouseover = () => deleteBtn.style.background = 'rgba(220, 53, 69, 1)'; deleteBtn.onmouseout = () => deleteBtn.style.background = 'rgba(220, 53, 69, 0.8)';
        deleteBtn.onclick = (e) => { e.stopPropagation(); if (typeof deleteEmote === 'function') deleteEmote(emote.id); };
        const showId = emote.name !== `#${emote.id}`;
        card.innerHTML = `<img src="${emote.icon}" alt="${emote.name}" onerror="this.src='https://placehold.co/55x55/333/ccc?text=Emote'"><div class="name" style="word-break: break-all;">${emote.name}</div>${showId ? `<div class="price" style="font-size:0.7rem; color:#888; margin-top:2px; word-break: break-all; text-align: center; line-height: 1.1;">#${emote.id}</div>` : ''}`;
        card.appendChild(deleteBtn); container.appendChild(card);
    });
}
function selectEmote(element, emoteData) { document.querySelectorAll('#emote-api-grid .gift-card-new').forEach(c => c.classList.remove('selected')); element.classList.add('selected'); selectedEmote = emoteData; }

async function searchSounds() {
    const query = document.getElementById('audio-search-input').value; const list = document.getElementById('audio-results-list'); list.innerHTML = '<div style="text-align:center; padding:20px;">Buscando...</div>';
    try { const result = await require('electron').ipcRenderer.invoke('local-search-sounds', query); list.innerHTML = ''; if (result.items && result.items.length > 0) renderAudioList(result.items); else list.innerHTML = '<div style="text-align:center; padding:20px; color:#aaa;">No se encontraron resultados.</div>'; } catch (e) { list.innerHTML = `<div style="text-align:center; padding:20px; color:red;">Error: ${e.message}</div>`; }
}
function playAudioPreview(url) { const volInput = document.getElementById('trigger-audio-volume'); const audio = new Audio(url); audio.volume = (volInput ? volInput.value : 50) / 100; audio.play().catch(e => console.error("Error playing preview:", e)); }
function renderAudioList(items) {
    const list = document.getElementById('audio-results-list'); list.innerHTML = '';
    items.forEach(sound => {
        const div = document.createElement('div'); const duration = sound.duration ? ` <span style="color:var(--gold); font-size:0.8rem;">(${parseFloat(sound.duration).toFixed(1)}s)</span>` : '';
        div.className = 'sound-result'; if (selectedAudio && selectedAudio.mp3 === sound.mp3) div.classList.add('selected');
        div.innerHTML = `<button class="sound-play-btn" onclick="event.stopPropagation(); playAudioPreview('${sound.mp3}')"><i class="fa-solid fa-play"></i></button><div style="flex-grow:1; font-size:0.9rem;">${sound.title}${duration}</div>`;
        div.onclick = () => selectAudio(sound, div); list.appendChild(div);
    });
}
async function selectLocalAudio() { const path = await require('electron').ipcRenderer.invoke('local-select-audio'); if (path) { const filename = path.split(/[/\\]/).pop(); const fileUrl = 'file:///' + path.replace(/\\/g, '/'); selectAudio({ title: filename, mp3: fileUrl, isLocal: true }); } }
function selectAudio(sound, element) { selectedAudio = sound; document.querySelectorAll('.sound-result').forEach(el => el.classList.remove('selected')); if (element) element.classList.add('selected'); const box = document.getElementById('current-audio-box'); const nameEl = document.getElementById('current-audio-name'); if (box && nameEl) { box.style.display = 'flex'; nameEl.innerText = sound.title; } }
function removeSelectedAudio() { selectedAudio = null; document.querySelectorAll('.sound-result').forEach(el => el.classList.remove('selected')); document.getElementById('current-audio-box').style.display = 'none'; }
function playSelectedAudio() { if (selectedAudio && selectedAudio.mp3) playAudioPreview(selectedAudio.mp3); }
function selectFunctionImage(src) { selectedFunctionImage = src; document.getElementById('trigger-image-url').value = src; const el1 = document.getElementById('trigger-image-url'); if (el1) el1.value = src; const el2 = document.getElementById('trigger-gta5-image-url'); if (el2) el2.value = src; document.querySelectorAll('.func-img-item').forEach(img => { img.classList.toggle('selected', img.src === src); }); }
function toggleWebhookPayload() { const method = document.getElementById('trigger-webhook-method').value; const container = document.getElementById('webhook-payload-container'); if (container) container.style.display = method === 'POST' ? 'block' : 'none'; }
async function selectLocalImage() { const path = await require('electron').ipcRenderer.invoke('local-select-image'); if (path) selectFunctionImage('file://' + path.replace(/\\/g, '/')); }

function renderIgnoredBots() {
    const container = document.getElementById('tts-ignored-bots-list'); if (!container) return; container.innerHTML = '';
    (typeof ttsConfig !== 'undefined' && ttsConfig.ignoredBots ? ttsConfig.ignoredBots : []).forEach(bot => {
        const tag = document.createElement('span'); tag.className = 'gift-pill active'; tag.style.display = 'flex'; tag.style.alignItems = 'center'; tag.style.gap = '5px'; tag.innerHTML = `${bot} <i class="fa-solid fa-times" style="cursor:pointer" onclick="typeof removeIgnoredBot==='function'?removeIgnoredBot('${bot}'):null"></i>`; container.appendChild(tag);
    });
}

function openExtensibleConfig() {
    const extConf = typeof extensibleState !== 'undefined' ? extensibleState.config : { initialSeconds: 3600, secPerSub: 0, secPerFollow: 0, secPerShare: 0, secPerBit: 1, secPerCoin: 10, baseCoin: 1, baseBit: 1 };
    const extState = typeof extensibleState !== 'undefined' ? extensibleState : { label: "EXTENSIBLE", showMs: false, active: false, theme: "neon" };
    const initSecs = extConf.initialSeconds || 3600; const h = Math.floor(initSecs / 3600); const m = Math.floor((initSecs % 3600) / 60);
    document.getElementById('ext-init-hours').value = h; document.getElementById('ext-init-minutes').value = m; document.getElementById('ext-label').value = extState.label; document.getElementById('ext-show-ms').checked = extState.showMs || false;
    const themeSelect = document.getElementById('ext-theme');
    if (themeSelect) themeSelect.value = extState.theme || 'neon';
    if (extConf.baseCoin) { document.getElementById('ext-base-coin').value = extConf.baseCoin; document.getElementById('ext-sec-coin').value = extConf.uiSecCoin !== undefined ? extConf.uiSecCoin : (extConf.secPerCoin * extConf.baseCoin); } else { document.getElementById('ext-base-coin').value = "1"; document.getElementById('ext-sec-coin').value = extConf.secPerCoin; }
    if (document.getElementById('ext-base-like')) {
        if (extConf.baseLike) { document.getElementById('ext-base-like').value = extConf.baseLike; document.getElementById('ext-sec-like').value = extConf.uiSecLike !== undefined ? extConf.uiSecLike : ((extConf.secPerLike || 0) * extConf.baseLike); } else { document.getElementById('ext-base-like').value = "1000"; document.getElementById('ext-sec-like').value = extConf.secPerLike !== undefined ? (extConf.secPerLike * 1000) : 0; }
    }
    if (document.getElementById('ext-sec-tiktok-sub')) {
        document.getElementById('ext-sec-tiktok-sub').value = extConf.secPerTikTokSub !== undefined ? extConf.secPerTikTokSub : (extConf.secPerSub || 0);
    }
    document.getElementById('ext-sec-sub').value = extConf.secPerSub !== undefined ? extConf.secPerSub : 0;
    if (document.getElementById('ext-sec-sub-t2')) document.getElementById('ext-sec-sub-t2').value = extConf.secPerSubT2 !== undefined ? extConf.secPerSubT2 : 0;
    if (document.getElementById('ext-sec-sub-t3')) document.getElementById('ext-sec-sub-t3').value = extConf.secPerSubT3 !== undefined ? extConf.secPerSubT3 : 0;
    document.getElementById('ext-sec-follow').value = extConf.secPerFollow !== undefined ? extConf.secPerFollow : 0;
    document.getElementById('ext-sec-share').value = extConf.secPerShare !== undefined ? extConf.secPerShare : 0;
    if (document.getElementById('ext-sec-kick-sub')) document.getElementById('ext-sec-kick-sub').value = extConf.secPerKickSub !== undefined ? extConf.secPerKickSub : (extConf.secPerSub || 300);
    if (document.getElementById('ext-base-kick')) {
        if (extConf.baseKick) { document.getElementById('ext-base-kick').value = extConf.baseKick; document.getElementById('ext-sec-kick').value = extConf.uiSecKick !== undefined ? extConf.uiSecKick : ((extConf.secPerKick || 1) * extConf.baseKick); } else { document.getElementById('ext-base-kick').value = "1"; document.getElementById('ext-sec-kick').value = extConf.secPerKick || 1; }
    }
    if (document.getElementById('ext-base-bit')) {
        if (extConf.baseBit) {
            document.getElementById('ext-base-bit').value = extConf.baseBit;
            document.getElementById('ext-sec-bit').value = extConf.uiSecBit !== undefined ? extConf.uiSecBit : ((extConf.secPerBit || 1) * extConf.baseBit);
        } else {
            document.getElementById('ext-base-bit').value = "100";
            document.getElementById('ext-sec-bit').value = extConf.secPerBit !== undefined ? (extConf.secPerBit * 100) : 360;
        }
    }
    renderChannelPointRewardsUI();
    updateExtensibleBtn(); updateExtensiblePreview(); document.getElementById('extensible-config-modal').style.display = 'flex';
}

function renderChannelPointRewardsUI() {
    const container = document.getElementById('ext-cp-rewards-container');
    if (!container || typeof extensibleState === 'undefined') return;

    if (!extensibleState.config.channelPointRewards || !Array.isArray(extensibleState.config.channelPointRewards)) {
        extensibleState.config.channelPointRewards = [
            { name: "+1 Minuto", seconds: 60 },
            { name: "+10 Minutos", seconds: 600 },
            { name: "+1 Hora", seconds: 3600 }
        ];
    }

    container.innerHTML = '';
    extensibleState.config.channelPointRewards.forEach((reward, idx) => {
        const row = document.createElement('div');
        row.style.cssText = "display:flex; gap:6px; align-items:center; margin-bottom:4px;";
        row.innerHTML = `
            <input type="text" class="ext-cp-name" placeholder="Nombre en Twitch (ej: +5 Minutos)" value="${(reward.name || '').replace(/"/g, '&quot;')}" style="flex:1; background:#111; border:1px solid #444; color:#ffffff; padding:6px 8px; border-radius:4px; font-size:0.85rem;" oninput="autoSaveExtensibleConfig()">
            <span style="font-size:0.85rem; color:#00f2fe; font-weight:bold;">= +</span>
            <input type="number" class="ext-cp-val" placeholder="Segundos" value="${reward.seconds !== undefined ? reward.seconds : 60}" style="width:90px; background:#111; border:1px solid #444; color:#ffffff; padding:6px 6px; border-radius:4px; font-size:0.85rem; text-align:center;" oninput="autoSaveExtensibleConfig()">
            <span style="font-size:0.8rem; color:#aaa;">seg</span>
            <button type="button" class="btn btn-outline btn-sm" onclick="removeChannelPointRewardRow(${idx})" title="Eliminar recompensa" style="color:#ff4757; border-color:#ff4757; padding:5px 8px;"><i class="fa-solid fa-trash"></i></button>
        `;
        container.appendChild(row);
    });
}

function addChannelPointRewardRow() {
    if (typeof extensibleState === 'undefined') return;
    saveExtensibleConfig(false);
    if (!extensibleState.config.channelPointRewards || !Array.isArray(extensibleState.config.channelPointRewards)) {
        extensibleState.config.channelPointRewards = [];
    }
    extensibleState.config.channelPointRewards.push({ name: "", seconds: 60 });
    renderChannelPointRewardsUI();
    autoSaveExtensibleConfig();
}

function removeChannelPointRewardRow(index) {
    if (typeof extensibleState === 'undefined' || !extensibleState.config.channelPointRewards) return;
    saveExtensibleConfig(false);
    extensibleState.config.channelPointRewards.splice(index, 1);
    renderChannelPointRewardsUI();
    autoSaveExtensibleConfig();
}

function closeExtensibleConfig() {
    saveExtensibleConfig(false);
    const modal = document.getElementById('extensible-config-modal');
    if (modal) modal.style.display = 'none';
}

let extAutoSaveTimeout = null;
function autoSaveExtensibleConfig() {
    updateExtensiblePreview();
    if (extAutoSaveTimeout) clearTimeout(extAutoSaveTimeout);
    extAutoSaveTimeout = setTimeout(() => {
        saveExtensibleConfig(false);
        const indicator = document.getElementById('ext-autosave-indicator');
        if (indicator) {
            indicator.style.opacity = '1';
            setTimeout(() => { indicator.style.opacity = '0'; }, 1200);
        }
    }, 200);
}

function saveExtensibleConfig(closeModal = false) {
    if (typeof extensibleState === 'undefined') return;
    const labelInput = document.getElementById('ext-label');
    if (labelInput) extensibleState.label = labelInput.value || "EXTENSIBLE";
    const showMsCheck = document.getElementById('ext-show-ms');
    if (showMsCheck) extensibleState.showMs = showMsCheck.checked;
    const themeSelect = document.getElementById('ext-theme');
    if (themeSelect) extensibleState.theme = themeSelect.value;

    const baseCoinEl = document.getElementById('ext-base-coin');
    const secCoinEl = document.getElementById('ext-sec-coin');
    const baseCoin = baseCoinEl ? Math.max(1, parseInt(baseCoinEl.value) || 1) : (extensibleState.config.baseCoin || 1);
    const secsCoin = secCoinEl ? Math.max(0, parseFloat(secCoinEl.value) || 0) : (extensibleState.config.uiSecCoin || 0);
    extensibleState.config.secPerCoin = secsCoin / baseCoin;
    extensibleState.config.baseCoin = baseCoin;
    extensibleState.config.uiSecCoin = secsCoin;

    const baseLikeEl = document.getElementById('ext-base-like');
    const secLikeEl = document.getElementById('ext-sec-like');
    const baseLike = baseLikeEl ? Math.max(1, parseInt(baseLikeEl.value) || 1) : (extensibleState.config.baseLike || 1000);
    const secsLike = secLikeEl ? Math.max(0, parseFloat(secLikeEl.value) || 0) : (extensibleState.config.uiSecLike !== undefined ? extensibleState.config.uiSecLike : 0);
    extensibleState.config.secPerLike = secsLike / baseLike;
    extensibleState.config.baseLike = baseLike;
    extensibleState.config.uiSecLike = secsLike;

    const secTikTokSubEl = document.getElementById('ext-sec-tiktok-sub');
    if (secTikTokSubEl) extensibleState.config.secPerTikTokSub = Math.max(0, parseInt(secTikTokSubEl.value) || 0);

    const secSubEl = document.getElementById('ext-sec-sub');
    if (secSubEl) extensibleState.config.secPerSub = Math.max(0, parseInt(secSubEl.value) || 0);
    const secSubT2El = document.getElementById('ext-sec-sub-t2');
    if (secSubT2El) extensibleState.config.secPerSubT2 = Math.max(0, parseInt(secSubT2El.value) || 0);
    const secSubT3El = document.getElementById('ext-sec-sub-t3');
    if (secSubT3El) extensibleState.config.secPerSubT3 = Math.max(0, parseInt(secSubT3El.value) || 0);
    const secKickSubEl = document.getElementById('ext-sec-kick-sub');
    if (secKickSubEl) extensibleState.config.secPerKickSub = Math.max(0, parseInt(secKickSubEl.value) || 0);
    const secFollowEl = document.getElementById('ext-sec-follow');
    if (secFollowEl) extensibleState.config.secPerFollow = Math.max(0, parseInt(secFollowEl.value) || 0);
    const secShareEl = document.getElementById('ext-sec-share');
    if (secShareEl) extensibleState.config.secPerShare = Math.max(0, parseInt(secShareEl.value) || 0);

    const baseBitEl = document.getElementById('ext-base-bit');
    const secBitEl = document.getElementById('ext-sec-bit');
    const baseBit = baseBitEl ? Math.max(1, parseInt(baseBitEl.value) || 1) : (extensibleState.config.baseBit || 100);
    const secsBit = secBitEl ? Math.max(0, parseFloat(secBitEl.value) || 0) : (extensibleState.config.uiSecBit !== undefined ? extensibleState.config.uiSecBit : 360);
    extensibleState.config.secPerBit = secsBit / baseBit;
    extensibleState.config.baseBit = baseBit;
    extensibleState.config.uiSecBit = secsBit;

    const baseKickEl = document.getElementById('ext-base-kick');
    const secKickEl = document.getElementById('ext-sec-kick');
    const baseKick = baseKickEl ? Math.max(1, parseInt(baseKickEl.value) || 1) : (extensibleState.config.baseKick || 1);
    const secsKick = secKickEl ? Math.max(0, parseFloat(secKickEl.value) || 0) : (extensibleState.config.uiSecKick || 0);
    extensibleState.config.secPerKick = secsKick / baseKick;
    extensibleState.config.baseKick = baseKick;
    extensibleState.config.uiSecKick = secsKick;

    const cpContainer = document.getElementById('ext-cp-rewards-container');
    if (cpContainer) {
        const rows = cpContainer.children;
        const rewards = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const nameEl = row.querySelector('.ext-cp-name');
            const valEl = row.querySelector('.ext-cp-val');
            if (nameEl && valEl) {
                const name = nameEl.value.trim();
                const seconds = Math.max(0, parseInt(valEl.value, 10) || 0);
                if (name) {
                    rewards.push({ name: name, seconds: seconds });
                }
            }
        }
        extensibleState.config.channelPointRewards = rewards;
    }

    const initHEl = document.getElementById('ext-init-hours');
    const initMEl = document.getElementById('ext-init-minutes');
    const h = initHEl ? Math.max(0, parseInt(initHEl.value) || 0) : Math.floor((extensibleState.config.initialSeconds || 3600) / 3600);
    const m = initMEl ? Math.max(0, parseInt(initMEl.value) || 0) : Math.floor(((extensibleState.config.initialSeconds || 3600) % 3600) / 60);
    extensibleState.config.initialSeconds = (h * 3600) + (m * 60);

    // Solo actualizamos el tiempo si el timer NO está en uso (nunca fue iniciado
    // o ya se hizo reset). La señal de esto es la bandera _neverStarted.
    // Si el timer fue iniciado alguna vez y está pausado a medias, NO tocamos el tiempo.
    if (!extensibleState.active && extensibleState._neverStarted === true) {
        extensibleState.time = extensibleState.config.initialSeconds;
    }
    if (typeof saveExtensibleState === 'function') saveExtensibleState();
    if (typeof syncWidgetData === 'function') syncWidgetData();
    updateExtensibleBtn();

    if (closeModal) {
        const modal = document.getElementById('extensible-config-modal');
        if (modal) modal.style.display = 'none';
    }
}

function toggleExtensibleTimer() {
    if (typeof extensibleState === 'undefined') return;
    extensibleState.active = !extensibleState.active;
    // Marcamos que el timer ya fue iniciado al menos una vez.
    // Esto evita que saveExtensibleConfig pise el tiempo cuando el timer
    // está pausado a medias y el usuario abre/cierra el modal de config.
    if (extensibleState.active) extensibleState._neverStarted = false;
    updateExtensibleBtn();
    if (typeof saveExtensibleState === 'function') saveExtensibleState();
    if (typeof syncWidgetData === 'function') syncWidgetData();
}

function resetExtensibleTimer() {
    if (typeof extensibleState === 'undefined') return;
    let secs = 3600;
    if (document.getElementById('extensible-config-modal') && document.getElementById('extensible-config-modal').style.display !== 'none') {
        const h = parseInt(document.getElementById('ext-init-hours').value) || 0;
        const m = parseInt(document.getElementById('ext-init-minutes').value) || 0;
        secs = (h * 3600) + (m * 60);
    } else {
        secs = extensibleState.config.initialSeconds || 3600;
    }
    extensibleState.time = secs;
    extensibleState.active = false;
    // Al hacer reset, volvemos al estado "nunca iniciado" para que los cambios
    // en el tiempo inicial del config se reflejen correctamente.
    extensibleState._neverStarted = true;
    updateExtensibleBtn();
    if (typeof saveExtensibleState === 'function') saveExtensibleState();
    if (typeof syncWidgetData === 'function') syncWidgetData();
}

function updateExtensiblePreview() {
    if (typeof extensibleState === 'undefined') return;
    const title = (document.getElementById('ext-label') && document.getElementById('ext-label').value) || "EXTENSIBLE";
    const previewTitle = document.getElementById('ext-modal-preview-title');
    const isShowMs = document.getElementById('ext-show-ms') ? document.getElementById('ext-show-ms').checked : false;

    const themeSelect = document.getElementById('ext-theme');
    const theme = themeSelect ? themeSelect.value : (extensibleState.theme || 'neon');
    const THEME_COLORS = {
        neon: { color: '#00f2fe', shadow: 'rgba(0, 242, 254, 0.5)' },
        gold: { color: '#ffd700', shadow: 'rgba(255, 215, 0, 0.5)' },
        purple: { color: '#e056fd', shadow: 'rgba(224, 86, 253, 0.5)' },
        red: { color: '#ff4757', shadow: 'rgba(255, 71, 87, 0.5)' },
        matrix: { color: '#2ed573', shadow: 'rgba(46, 213, 115, 0.5)' },
        simple: { color: '#ffffff', shadow: 'rgba(0, 0, 0, 0.9)' }
    };
    const tCol = THEME_COLORS[theme] || THEME_COLORS.neon;

    if (previewTitle) {
        if (theme === 'simple') {
            previewTitle.style.display = 'none';
        } else {
            previewTitle.style.display = 'block';
            previewTitle.innerText = title;
            previewTitle.style.color = tCol.color;
        }
    }

    const shadowStyle = (theme === 'simple')
        ? '0 2px 10px rgba(0, 0, 0, 0.95), 0 0 4px #000'
        : `0 0 15px ${tCol.shadow}`;

    const pTime = document.getElementById('ext-modal-preview-time');
    let displaySecs = typeof extensibleState.time === 'number' ? extensibleState.time : (extensibleState.config ? extensibleState.config.initialSeconds : 3600);

    const h = Math.floor(displaySecs / 3600).toString().padStart(2, '0');
    const m = Math.floor((displaySecs % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(displaySecs % 60).toString().padStart(2, '0');
    let timeStr = `${h}:${m}:${s}`;
    if (isShowMs) {
        const ms = Math.floor((displaySecs % 1) * 100).toString().padStart(2, '0');
        timeStr += `.${ms}`;
    }
    if (pTime) {
        pTime.innerText = timeStr;
        pTime.style.textShadow = shadowStyle;
    }
}

function addManualTime() {
    if (typeof extensibleState === 'undefined') return;
    const amount = parseInt(document.getElementById('ext-manual-amount').value) || 0;
    const unit = parseInt(document.getElementById('ext-manual-unit').value) || 1;
    if (amount !== 0) {
        const delta = amount * unit;
        extensibleState._neverStarted = false;
        extensibleState.time = Math.max(0, extensibleState.time + delta);
        extensibleState.lastAdded = {
            seconds: delta,
            user: 'Admin',
            reason: 'manual',
            ts: Date.now()
        };
        if (typeof saveExtensibleState === 'function') saveExtensibleState();
        if (typeof syncWidgetData === 'function') syncWidgetData();
        updateExtensibleBtn();
        updateExtensiblePreview();
    }
}

// Controles directos en la tarjeta de Overlays
function cardToggleExtensible() { toggleExtensibleTimer(); }
function cardResetExtensible() { resetExtensibleTimer(); }
function cardAddExtensibleTime(seconds) {
    if (typeof extensibleState === 'undefined') return;
    extensibleState._neverStarted = false;
    extensibleState.time = Math.max(0, extensibleState.time + seconds);
    extensibleState.lastAdded = {
        seconds: seconds,
        user: 'Admin',
        reason: 'manual',
        ts: Date.now()
    };
    if (typeof saveExtensibleState === 'function') saveExtensibleState();
    if (typeof syncWidgetData === 'function') syncWidgetData();
    updateExtensibleBtn();
    updateExtensiblePreview();
}

function updateExtensibleBtn() {
    if (typeof extensibleState === 'undefined') return;

    // 1. Botón dentro del modal
    const modalBtn = document.getElementById('btn-ext-toggle');
    if (modalBtn) {
        if (extensibleState.active) {
            modalBtn.innerHTML = '<i class="fa-solid fa-pause"></i> Pausar';
            modalBtn.classList.replace('btn-blue', 'btn-danger');
        } else {
            modalBtn.innerHTML = '<i class="fa-solid fa-play"></i> Iniciar';
            modalBtn.classList.replace('btn-danger', 'btn-blue');
        }
    }

    // 2. Botón en la tarjeta de Overlays
    const cardBtn = document.getElementById('card-btn-ext-toggle');
    if (cardBtn) {
        if (extensibleState.active) {
            cardBtn.innerHTML = '<i class="fa-solid fa-pause"></i> Pausar';
            cardBtn.className = 'btn btn-danger btn-sm';
        } else {
            cardBtn.innerHTML = '<i class="fa-solid fa-play"></i> Iniciar';
            cardBtn.className = 'btn btn-blue btn-sm';
        }
    }

    // 3. Badge de estado en la tarjeta de Overlays
    const cardStatus = document.getElementById('card-ext-status');
    if (cardStatus) {
        if (extensibleState.time <= 0) {
            cardStatus.innerHTML = '<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#ff4757; margin-right:6px; box-shadow:0 0 6px #ff4757;"></span>FINALIZADO';
            cardStatus.style.color = '#ff4757';
        } else if (extensibleState.active) {
            cardStatus.innerHTML = '<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#2ed573; margin-right:6px; box-shadow:0 0 8px #2ed573;"></span>ACTIVO';
            cardStatus.style.color = '#2ed573';
        } else {
            cardStatus.innerHTML = '<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#ffa502; margin-right:6px;"></span>PAUSADO';
            cardStatus.style.color = '#ffa502';
        }
    }

    // 4. Actualizar la vista previa de tiempo
    updateExtensiblePreview();
}

function getChatWidgetParamsString() {
    try {
        const raw = localStorage.getItem('s4e_chat_widget_config');
        if (!raw) return '';
        const config = JSON.parse(raw);
        const params = new URLSearchParams();
        if (config.hide) params.append('hideAfter', config.hide);
        if (config.font) params.append('fontSize', config.font);
        if (config.emote) params.append('emoteSize', config.emote);
        if (config.text) params.append('textColor', config.text);
        if (config.bg) params.append('bgColor', config.bg);
        if (config.icons) params.append('showIcons', 'true');
        if (config.blockedBots) params.append('blockedBots', config.blockedBots);
        return params.toString();
    } catch (e) {
        return '';
    }
}

function getChatWidgetUrl(mode) {
    const activeMode = mode || currentOverlayHostMode || 'cloud';
    const paramsStr = getChatWidgetParamsString();
    const effectiveToken = CLOUD_TOKEN || 'hinu';
    
    if (activeMode === 'cloud') {
        let url = `${CLOUD_BASE_URL}/chat-widget.html?token=${effectiveToken}`;
        if (paramsStr) url += `&${paramsStr}`;
        return url;
    } else {
        let url = `http://localhost:3011/chat-widget.html`;
        if (paramsStr) url += `?${paramsStr}`;
        return url;
    }
}

let currentBlockedBotsList = [];

function parseBlockedBotsString(str) {
    if (!str) return [];
    return str.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function renderBlockedBotChips() {
    const container = document.getElementById('chat-blocked-chips');
    if (!container) return;
    container.innerHTML = '';
    if (currentBlockedBotsList.length === 0) {
        container.innerHTML = '<span style="font-size:0.75rem; color:#666; font-style:italic;">No hay bots bloqueados.</span>';
        return;
    }
    currentBlockedBotsList.forEach(bot => {
        const chip = document.createElement('span');
        chip.style.cssText = 'background: rgba(255, 71, 87, 0.15); color: #ff6b81; border: 1px solid rgba(255, 71, 87, 0.35); padding: 3px 9px; border-radius: 12px; font-size: 0.78rem; display: inline-flex; align-items: center; gap: 6px; font-weight: 500;';
        chip.innerHTML = `<span>${bot}</span><i class="fa-solid fa-times" style="cursor: pointer; opacity: 0.7; font-size: 0.7rem;" title="Quitar"></i>`;
        chip.querySelector('i').onclick = () => removeBlockedBot(bot);
        container.appendChild(chip);
    });
}

function addCustomBlockedBot() {
    const input = document.getElementById('chat-cfg-blocked-bots-input');
    if (!input) return;
    const val = input.value.trim().toLowerCase();
    if (val) {
        val.split(',').forEach(v => {
            const clean = v.trim().toLowerCase();
            if (clean && !currentBlockedBotsList.includes(clean)) {
                currentBlockedBotsList.push(clean);
            }
        });
        input.value = '';
        renderBlockedBotChips();
        updateChatPreview();
    }
}

function addQuickBot(botName) {
    const clean = botName.trim().toLowerCase();
    if (!currentBlockedBotsList.includes(clean)) {
        currentBlockedBotsList.push(clean);
        renderBlockedBotChips();
        updateChatPreview();
    }
}

function removeBlockedBot(botName) {
    const clean = botName.trim().toLowerCase();
    currentBlockedBotsList = currentBlockedBotsList.filter(b => b !== clean);
    renderBlockedBotChips();
    updateChatPreview();
}

function copyModalChatUrl(btn) {
    const input = document.getElementById('chat-cfg-generated-link');
    if (input && input.value) {
        navigator.clipboard.writeText(input.value).then(() => {
            const originalHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-check"></i> ¡Copiado!';
            btn.classList.remove('btn-blue');
            btn.classList.add('btn-green');
            setTimeout(() => {
                btn.innerHTML = originalHtml;
                btn.classList.remove('btn-green');
                btn.classList.add('btn-blue');
            }, 2000);
        }).catch(err => {
            input.select();
            document.execCommand('copy');
        });
    }
}

function updateChatWidgetLink() {
    const activeMode = currentOverlayHostMode || 'cloud';
    const url = getChatWidgetUrl(activeMode);
    const linkBox = document.getElementById('chat-widget-link');
    if (linkBox) linkBox.value = url;
    const modalLinkBox = document.getElementById('chat-cfg-generated-link');
    if (modalLinkBox) modalLinkBox.value = url;
    const modalModeLabel = document.getElementById('chat-modal-mode-label');
    if (modalModeLabel) modalModeLabel.innerText = activeMode === 'cloud' ? 'Render Cloud' : 'Local (PC)';
    const modalBadge = document.getElementById('chat-modal-badge-host');
    if (modalBadge) modalBadge.innerText = activeMode === 'cloud' ? 'Modo Render Cloud' : 'Modo Local (PC)';
}

function loadChatWidgetConfig() {
    try {
        const raw = localStorage.getItem('s4e_chat_widget_config');
        if (raw) {
            const config = JSON.parse(raw);
            if (config.hide !== undefined) document.getElementById('chat-cfg-hide').value = config.hide;
            if (config.font !== undefined) document.getElementById('chat-cfg-font').value = config.font;
            if (config.emote !== undefined) document.getElementById('chat-cfg-emote').value = config.emote;
            if (config.text !== undefined) document.getElementById('chat-cfg-text').value = config.text;
            if (config.bg !== undefined) document.getElementById('chat-cfg-bg').value = config.bg;
            if (config.icons !== undefined) document.getElementById('chat-cfg-icons').checked = config.icons;
            if (config.blockedBots !== undefined) {
                currentBlockedBotsList = parseBlockedBotsString(config.blockedBots);
            }
        }
    } catch (e) { }
    renderBlockedBotChips();
    updateChatPreview();
    updateChatWidgetLink();
}

function openChatWidgetConfig() { 
    loadChatWidgetConfig(); 
    updateChatPreview(); 
    document.getElementById('chat-widget-config-modal').style.display = 'flex'; 

    const botInput = document.getElementById('chat-cfg-blocked-bots-input');
    if (botInput && !botInput.__enter_bound) {
        botInput.__enter_bound = true;
        botInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addCustomBlockedBot();
            }
        });
    }
}

function updateChatPreview() {
    const hide = document.getElementById('chat-cfg-hide').value;
    const font = document.getElementById('chat-cfg-font').value;
    const emote = document.getElementById('chat-cfg-emote').value;
    const text = document.getElementById('chat-cfg-text').value;
    const bg = document.getElementById('chat-cfg-bg').value;
    const icons = document.getElementById('chat-cfg-icons').checked;
    const blockedBots = currentBlockedBotsList.join(',');

    localStorage.setItem('s4e_chat_widget_config', JSON.stringify({ hide, font, emote, text, bg, icons, blockedBots }));

    const params = new URLSearchParams();
    if (hide) params.append('hideAfter', hide);
    if (font) params.append('fontSize', font);
    if (emote) params.append('emoteSize', emote);
    if (text) params.append('textColor', text);
    if (bg) params.append('bgColor', bg);
    if (icons) params.append('showIcons', 'true');
    if (blockedBots) params.append('blockedBots', blockedBots);

    const paramsStr = params.toString();
    const previewFrame = document.getElementById('chat-cfg-preview');
    if (previewFrame) {
        previewFrame.src = `http://localhost:3011/chat-widget.html${paramsStr ? '?' + paramsStr : ''}`;
    }

    updateChatWidgetLink();
}

function testChatPreview() { const iframe = document.getElementById('chat-cfg-preview'); if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage({ type: 'test-message' }, '*'); }
['chat-cfg-hide', 'chat-cfg-font', 'chat-cfg-emote', 'chat-cfg-text', 'chat-cfg-bg', 'chat-cfg-icons'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('change', updateChatPreview);
        el.addEventListener('input', updateChatPreview);
    }
});
function saveChatWidgetConfig() { 
    updateChatPreview(); 
    updateChatWidgetLink(); 
    const frame = document.getElementById('preview-chat'); 
    if (frame) {
        const paramsStr = getChatWidgetParamsString();
        frame.src = `http://localhost:3011/chat-widget.html${paramsStr ? '?' + paramsStr : ''}`;
    }
    document.getElementById('chat-widget-config-modal').style.display = 'none'; 
}

function openGoalsConfig() {
    if (typeof goalsConfig === 'undefined') return;
    document.getElementById('goal-likes-target').value = goalsConfig.likes.target;
    document.getElementById('goal-likes-label').value = goalsConfig.likes.label || 'Likes Goal';
    document.getElementById('goal-likes-position').value = goalsConfig.likes.position || 'inside';
    document.getElementById('goal-likes-show-icon').checked = goalsConfig.likes.showIcon !== false;
    document.getElementById('goal-coins-target').value = goalsConfig.coins.target;
    document.getElementById('goal-coins-label').value = goalsConfig.coins.label || 'Gift Goal';
    document.getElementById('goal-coins-position').value = goalsConfig.coins.position || 'inside';
    document.getElementById('goal-coins-show-icon').checked = goalsConfig.coins.showIcon !== false;
    document.getElementById('goals-config-modal').style.display = 'flex';
}

function saveGoalsConfig() {
    if (typeof goalsConfig === 'undefined') return;
    goalsConfig.likes.target = parseInt(document.getElementById('goal-likes-target').value) || 1000;
    goalsConfig.likes.label = document.getElementById('goal-likes-label').value;
    goalsConfig.likes.position = document.getElementById('goal-likes-position').value;
    goalsConfig.likes.showIcon = document.getElementById('goal-likes-show-icon').checked;
    goalsConfig.coins.target = parseInt(document.getElementById('goal-coins-target').value) || 1000;
    goalsConfig.coins.label = document.getElementById('goal-coins-label').value;
    goalsConfig.coins.position = document.getElementById('goal-coins-position').value;
    goalsConfig.coins.showIcon = document.getElementById('goal-coins-show-icon').checked;
    localStorage.setItem('s4e_goals_config', JSON.stringify(goalsConfig));
    require('electron').ipcRenderer.send('update-goals', goalsConfig);

    // Forzar recarga visual instantánea
    const likesFrame = document.getElementById('preview-likes-goal');
    if (likesFrame) likesFrame.src = likesFrame.src;
    const giftFrame = document.getElementById('preview-gift-goal');
    if (giftFrame) giftFrame.src = giftFrame.src;
    if (typeof syncWidgetData === 'function') syncWidgetData(true);
}

function resetLikesProgress() {
    if (confirm("¿Seguro que quieres reiniciar el progreso de la meta de likes a 0?")) {
        require('electron').ipcRenderer.send('reset-likes-progress');
    }
}

function resetCoinsProgress() {
    if (confirm("¿Seguro que quieres reiniciar el progreso de la meta de regalos a 0?")) {
        require('electron').ipcRenderer.send('reset-coins-progress');
    }
}

// --- Emotes Management ---
function deleteEmote(id) {
    if (!confirm("¿Eliminar este emote de la lista?")) return;
    tiktokEmotesAPI = tiktokEmotesAPI.filter(e => String(e.id) !== String(id));
    require('electron').ipcRenderer.send('delete-emote', id);
    filterEmotes();
    if (selectedEmote && String(selectedEmote.id) === String(id)) {
        selectedEmote = null;
        document.querySelectorAll('#emote-api-grid .gift-card-new').forEach(c => c.classList.remove('selected'));
    }
}

async function addEmoteById() {
    let id = document.getElementById('emote-search-input').value.trim();
    if (id.startsWith('#')) id = id.substring(1);

    if (!id || !/^\d+$/.test(id)) {
        id = await showPrompt("Ingresa el ID del Emote (ej. 7252340999758564102):");
        if (!id) return;
        id = id.trim();
        if (id.startsWith('#')) id = id.substring(1);
    }

    if (tiktokEmotesAPI.find(e => String(e.id) === String(id))) {
        alert("Este emote ya está en la lista.");
        document.getElementById('emote-search-input').value = id;
        filterEmotes();
        return;
    }
    const name = await showPrompt("Nombre para este emote (opcional):") || `Emote ${id}`;
    const newEmote = { id: id, name: name, icon: 'https://placehold.co/55x55/333/ccc?text=ID' };
    tiktokEmotesAPI.push(newEmote);
    require('electron').ipcRenderer.send('manual-emote-added', { emoteId: id, emoteName: name });

    document.getElementById('emote-search-input').value = id;
    filterEmotes();
    setTimeout(() => {
        const card = document.querySelector(`.gift-card-new[data-id="${id}"]`);
        if (card) selectEmote(card, newEmote);
    }, 100);
}

// --- Template Management ---
function confirmCreateTemplate() {
    const name = document.getElementById('new-template-name').value;
    if (!name) return;
    if (!Array.isArray(templates)) templates = [];
    const newT = { id: Date.now(), name: name, triggers: [] };
    templates.push(newT);
    if (typeof saveTemplates === 'function') saveTemplates();
    renderTemplateList();
    openTemplate(newT.id);
    closeModal();
}

function deleteTemplate(id, event) {
    if (event) event.stopPropagation();
    if (!confirm("¿Borrar esta plantilla y todos sus activadores?")) return;
    templates = templates.filter(t => t.id !== id);
    if (typeof saveTemplates === 'function') saveTemplates();
    renderTemplateList();
}

// --- Triggers Testing & Movement ---
function testTrigger(id) {
    let trigger = null;
    const t = templates.find(x => x.id === currentTemplateId);
    if (t) trigger = t.triggers.find(x => x.id === id);
    if (!trigger) trigger = mediaTriggers.find(x => x.id === id);
    if (!trigger) return;

    if (editingTriggerId === id) {
        trigger = { ...trigger };
        trigger.amount = document.getElementById('trigger-amount').value;
        trigger.command = document.getElementById('trigger-commands').value;
        trigger.webhookUrl = document.getElementById('trigger-webhook-url').value;
        trigger.webhookMethod = document.getElementById('trigger-webhook-method').value;
        trigger.webhookPayload = document.getElementById('trigger-webhook-payload').value;
        trigger.webhookHeaders = document.getElementById('trigger-webhook-headers').value;
        trigger.type = document.querySelector('#trigger-type-grid .selected')?.getAttribute('data-name') || trigger.type;
        if (document.getElementById('trigger-media-tts')) trigger.mediaTts = document.getElementById('trigger-media-tts').checked;
    }

    if (trigger.actionType === 'media' || (trigger.mediaFile && trigger.mediaFile.length > 0)) {
        let actionText = "activó la alerta";
        if (trigger.type === 'Likes') actionText = "dio like";
        else if (trigger.type === 'Follow') actionText = "es un nuevo seguidor";
        else if (trigger.type === 'Regalo') {
            const gift = tiktokGiftsAPI.find(g => String(g.id) === String(trigger.giftId));
            actionText = `envió ${gift ? gift.name : 'un Regalo'}`;
        }
        else if (trigger.type === 'Emote') {
            const emote = tiktokEmotesAPI.find(e => String(e.id) === String(trigger.emoteId));
            actionText = `envió emote ${emote ? emote.name : 'Emote'}`;
        }

        if (trigger.mediaTts) {
            if (typeof speakText === 'function') {
                speakText(`Usuario de Prueba ${actionText}`, 'sistema', true);
            }
        }

        if (trigger.mediaFile && trigger.mediaFile.match(/\.(mp4|webm|mov)$/i)) {
            let localSrc = trigger.mediaFile;
            if (localSrc && (localSrc.startsWith('file:') || localSrc.match(/^[a-zA-Z]:/))) {
                localSrc = 'http://localhost:3011/local-file?path=' + encodeURIComponent(localSrc);
            }

            const v = document.createElement('video');
            v.src = localSrc;
            v.volume = (trigger.mediaVolume !== undefined ? trigger.mediaVolume : 100) / 100;
            v.muted = false;
            v.autoplay = true; // Forzar inicio
            // TRUCO DEFINITIVO: Dentro del área visible pero casi invisible para evitar suspensión de Chrome
            v.style.cssText = "position: fixed; top: 50%; left: 50%; width: 2px; height: 2px; opacity: 0.001; pointer-events: none; z-index: 9999;";
            document.body.appendChild(v);

            if (typeof playMediaOnSelectedDevice === 'function') {
                playMediaOnSelectedDevice(v).catch(e => console.error("Error playing app video sound (Test):", e));
            } else {
                v.play().catch(e => console.error("Error:", e));
            }

            v.onended = () => v.remove();
            v.onerror = () => v.remove();
        }
        require('electron').ipcRenderer.send('dispatch-media-event', {
            file: trigger.mediaFile, duration: trigger.mediaDuration || 5,
            volume: 0, // Muteado en OBS, solo sonará en la App
            showUser: trigger.mediaShowUser, username: "Usuario de Prueba", actionText: actionText
        });
    }

    if (trigger.actionType !== 'media') {
        const mcUser = document.getElementById('minecraft-player-name') ? document.getElementById('minecraft-player-name').value : '@a';
        const context = {
            playername: mcUser, nickname: 'TestUser', uniqueId: 'test_user_handle',
            giftname: trigger.type === 'Emote' ? 'TestEmote' : (trigger.type === 'Regalo' ? 'TestGift' : trigger.type),
            giftcount: trigger.amount || '1', coins: '10', count: trigger.amount || '1', picture: 'https://placehold.co/200x200'
        };
        if (typeof executeTriggerAction === 'function') executeTriggerAction(trigger, context);
    }
    if (trigger.audio && trigger.audio.mp3) {
        let audioSrc = trigger.audio.mp3;
        if (audioSrc && (audioSrc.startsWith('file:') || audioSrc.match(/^[a-zA-Z]:/))) {
            audioSrc = 'http://localhost:3011/local-file?path=' + encodeURIComponent(audioSrc);
        }
        const audio = new Audio(audioSrc);
        audio.volume = (trigger.audioVolume !== undefined ? trigger.audioVolume : 50) / 100;
        playMediaOnSelectedDevice(audio).catch(e => console.error("Error playing audio:", e));
    }
}

function testTriggerDelayed(id, btnElement) {
    const originalContent = btnElement.innerHTML;
    btnElement.innerHTML = '<i class="fa-solid fa-hourglass-half fa-spin"></i>';
    btnElement.disabled = true;
    setTimeout(() => {
        testTrigger(id);
        btnElement.innerHTML = originalContent;
        btnElement.disabled = false;
    }, 5000);
}

function moveTrigger(id, direction) {
    const t = templates.find(x => x.id === currentTemplateId);
    if (t) {
        const index = t.triggers.findIndex(x => x.id === id);
        if (index !== -1) {
            const newIndex = index + direction;
            if (newIndex >= 0 && newIndex < t.triggers.length) {
                const temp = t.triggers[index]; t.triggers[index] = t.triggers[newIndex]; t.triggers[newIndex] = temp;
                if (typeof saveTemplates === 'function') saveTemplates(); renderTriggerList(); renderWidgetPreview(); return;
            }
        }
    }
    const mIndex = mediaTriggers.findIndex(x => x.id === id);
    if (mIndex !== -1) {
        const newIndex = mIndex + direction;
        if (newIndex >= 0 && newIndex < mediaTriggers.length) {
            const temp = mediaTriggers[mIndex]; mediaTriggers[mIndex] = mediaTriggers[newIndex]; mediaTriggers[newIndex] = temp;
            localStorage.setItem('s4e_local_media_triggers', JSON.stringify(mediaTriggers)); renderMediaList();
        }
    }
}

function deleteTrigger(id) {
    if (!confirm("¿Eliminar este activador?")) return;
    let found = false;
    const t = templates.find(x => x.id === currentTemplateId);
    if (t) {
        const initialLen = t.triggers.length;
        t.triggers = t.triggers.filter(x => x.id !== id);
        if (t.triggers.length < initialLen) { if (typeof saveTemplates === 'function') saveTemplates(); if (typeof updateAppShortcuts === 'function') updateAppShortcuts(); found = true; }
    }
    if (!found) {
        const initialLen = mediaTriggers.length;
        mediaTriggers = mediaTriggers.filter(x => x.id !== id);
        if (mediaTriggers.length < initialLen) localStorage.setItem('s4e_local_media_triggers', JSON.stringify(mediaTriggers));
    }
    if (currentActionMode === 'media') renderMediaList(); else renderTriggerList();
    renderWidgetPreview();
}

// --- Audio Devices ---
async function loadAudioDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
        const selectAlerts = document.getElementById('alerts-audio-device');
        if (selectAlerts) {
            selectAlerts.innerHTML = '<option value="default">Por defecto</option>';
            const savedId = localStorage.getItem('s4e_alerts_audio_device');
            audioOutputs.forEach(d => {
                const opt = document.createElement('option'); opt.value = d.deviceId; opt.innerText = d.label || `Speaker ${d.deviceId.substring(0, 5)}...`;
                if (d.deviceId === savedId) opt.selected = true; selectAlerts.appendChild(opt);
            });
        }
        const selectTTS = document.getElementById('tts-audio-device');
        if (selectTTS) {
            selectTTS.innerHTML = '<option value="default">Por defecto</option>';
            let savedTTSId = 'default';
            try { const ttsConfigSaved = JSON.parse(localStorage.getItem('s4e_tts_config')); if (ttsConfigSaved && ttsConfigSaved.audioDevice) savedTTSId = ttsConfigSaved.audioDevice; } catch (e) { }
            audioOutputs.forEach(d => {
                const opt = document.createElement('option'); opt.value = d.deviceId; opt.innerText = d.label || `Speaker ${d.deviceId.substring(0, 5)}...`;
                if (d.deviceId === savedTTSId) opt.selected = true; selectTTS.appendChild(opt);
            });
        }
    } catch (e) { console.error("Error loading audio devices:", e); }
}

async function playMediaOnSelectedDevice(element) {
    const deviceId = localStorage.getItem('s4e_alerts_audio_device');
    if (deviceId && deviceId !== 'default' && element.setSinkId) { try { await element.setSinkId(deviceId); } catch (e) { } }
    return element.play();
}

// --- Canvas Editor Helpers ---
let currentCanvasRatio = '16/9';

async function sendAddWidget() {
    let url = document.getElementById('external-widget-select').value;
    if (url === 'custom') {
        url = await showPrompt("Introduce la URL del overlay (Streamlabs, StreamElements, YouTube, etc):");
        if (!url) return;
        if (!url.startsWith('http')) url = 'https://' + url;
    } else {
        url = url.startsWith('http') ? url : 'http://localhost:3011' + url;
    }
    const iframe = document.getElementById('embedded-canvas-editor');
    if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage({ command: 'addWidget', url: url }, '*');
}
function sendSaveLayout() {
    const iframe = document.getElementById('embedded-canvas-editor');
    if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage({ command: 'saveLayout' }, '*');
    alert("¡Escena guardada correctamente!");
}
function sendClearCanvas() {
    if (confirm("¿Estás seguro de que quieres borrar todos los overlays del lienzo?\\nEsta acción no se puede deshacer.")) {
        const iframe = document.getElementById('embedded-canvas-editor');
        if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage({ command: 'clearCanvas' }, '*');
    }
}
function updateEditorIframeScale() {
    const container = document.getElementById('editor-container');
    const iframe = document.getElementById('embedded-canvas-editor');
    if (!container || !iframe) return;
    const isVertical = typeof currentCanvasRatio !== 'undefined' && currentCanvasRatio === '9/16';
    const logicalW = isVertical ? 1080 : 1920; const logicalH = isVertical ? 1920 : 1080;
    if (isVertical) { container.style.height = '75vh'; container.style.minHeight = '500px'; container.style.maxHeight = '900px'; }
    else { container.style.height = '60vh'; container.style.minHeight = '400px'; container.style.maxHeight = '700px'; }
    iframe.style.width = logicalW + 'px'; iframe.style.height = logicalH + 'px';
    const padding = 40; const availableW = container.clientWidth - padding; const availableH = container.clientHeight - padding;
    const scaleX = availableW / logicalW; const scaleY = availableH / logicalH; const scale = Math.min(scaleX, scaleY, 1);
    iframe.style.transform = `scale(${scale})`;
}
function setEditorAspect(ratio) {
    if (typeof currentCanvasRatio !== 'undefined') currentCanvasRatio = ratio;
    updateEditorIframeScale();
    require('electron').ipcRenderer.send('resize-canvas-window', ratio);

    const btn916 = document.getElementById('btn-aspect-9-16');
    const btn169 = document.getElementById('btn-aspect-16-9');
    if (btn916 && btn169) {
        btn916.className = ratio === '9/16' ? 'btn btn-blue btn-sm' : 'btn btn-outline btn-sm';
        btn169.className = ratio === '16/9' ? 'btn btn-blue btn-sm' : 'btn btn-outline btn-sm';
    }
}

// --- Canvas Profiles ---
function renderCanvasProfiles() {
    const select = document.getElementById('canvas-profile-select');
    if (!select || typeof canvasProfilesState === 'undefined' || !canvasProfilesState) return;
    select.innerHTML = '';
    canvasProfilesState.profiles.forEach(p => {
        const opt = document.createElement('option'); opt.value = p.id; opt.innerText = p.name;
        if (p.id === canvasProfilesState.activeId) opt.selected = true; select.appendChild(opt);
    });
}
function changeCanvasProfile() {
    const val = document.getElementById('canvas-profile-select').value;
    if (val && typeof canvasProfilesState !== 'undefined') {
        canvasProfilesState.activeId = val; if (typeof saveCanvasProfilesState === 'function') saveCanvasProfilesState();
    }
}
async function createCanvasProfile() {
    const name = await showPrompt("Nombre del nuevo perfil:", "Nuevo Perfil");
    if (!name || typeof canvasProfilesState === 'undefined') return;
    const newId = 'prof_' + Date.now();
    canvasProfilesState.profiles.push({ id: newId, name: name, layouts: { '16/9': [], '9/16': [] } });
    canvasProfilesState.activeId = newId; if (typeof saveCanvasProfilesState === 'function') saveCanvasProfilesState();
}
async function renameCanvasProfile() {
    if (typeof canvasProfilesState === 'undefined') return;
    const active = canvasProfilesState.profiles.find(p => p.id === canvasProfilesState.activeId);
    if (!active) return;
    const name = await showPrompt("Nuevo nombre:", active.name);
    if (!name) return;
    active.name = name; if (typeof saveCanvasProfilesState === 'function') saveCanvasProfilesState();
}
function deleteCanvasProfile() {
    if (typeof canvasProfilesState === 'undefined') return;
    if (canvasProfilesState.profiles.length <= 1) return alert("No puedes eliminar el único perfil.");
    if (!confirm("¿Eliminar este perfil de overlays permanentemente?")) return;
    canvasProfilesState.profiles = canvasProfilesState.profiles.filter(p => p.id !== canvasProfilesState.activeId);
    canvasProfilesState.activeId = canvasProfilesState.profiles[0].id;
    if (typeof saveCanvasProfilesState === 'function') saveCanvasProfilesState();
}
window.addEventListener('resize', () => { if (typeof updateEditorIframeScale === 'function') updateEditorIframeScale(); });

// --- GESTIÓN DE SERVIDOR DE OVERLAYS (LOCAL vs RENDER CLOUD) ---
let currentOverlayHostMode = localStorage.getItem('s4e_overlay_host_mode') || 'cloud';
const CLOUD_BASE_URL = 'https://livemu-overlays.onrender.com';
let CLOUD_TOKEN = localStorage.getItem('s4e_cloud_token') || '';

// Cargar token único persistido desde el proceso principal (Electron)
function loadCloudConfig() {
    if (window.require) {
        try {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.invoke('get-cloud-config').then(cfg => {
                if (cfg && cfg.cloudToken) {
                    CLOUD_TOKEN = cfg.cloudToken;
                    localStorage.setItem('s4e_cloud_token', CLOUD_TOKEN);
                    updateCloudTokenUI();
                    setOverlayHostMode(currentOverlayHostMode);
                }
            }).catch(e => console.warn('Error fetching cloud config:', e));
        } catch (e) { }
    } else {
        if (!CLOUD_TOKEN) CLOUD_TOKEN = 'live_' + Math.random().toString(36).substring(2, 10);
        updateCloudTokenUI();
    }
}

function updateCloudTokenUI() {
    const tokenDisplay = document.getElementById('cloud-token-display');
    if (tokenDisplay) {
        tokenDisplay.innerText = CLOUD_TOKEN || 'cargando...';
    }
}

async function regenerateCloudToken() {
    if (!confirm("¿Deseas generar un nuevo Token de Sala Privada?\n\nAl cambiar de token, deberás actualizar la URL de tus overlays en OBS para que sigan recibiendo tus alertas.")) {
        return;
    }
    if (window.require) {
        try {
            const { ipcRenderer } = window.require('electron');
            const res = await ipcRenderer.invoke('regenerate-cloud-token');
            if (res && res.cloudToken) {
                CLOUD_TOKEN = res.cloudToken;
                localStorage.setItem('s4e_cloud_token', CLOUD_TOKEN);
                updateCloudTokenUI();
                setOverlayHostMode(currentOverlayHostMode);
                alert("¡Nuevo token generado exitosamente!\n\nTu nueva sala privada es: " + CLOUD_TOKEN + "\nCopia los enlaces actualizados a tu OBS.");
            }
        } catch (e) {
            console.error('Error al regenerar token:', e);
            alert("Error al regenerar token: " + e.message);
        }
    } else {
        CLOUD_TOKEN = 'live_' + Math.random().toString(36).substring(2, 10);
        localStorage.setItem('s4e_cloud_token', CLOUD_TOKEN);
        updateCloudTokenUI();
        setOverlayHostMode(currentOverlayHostMode);
    }
}

function setOverlayHostMode(mode) {
    currentOverlayHostMode = mode;
    localStorage.setItem('s4e_overlay_host_mode', mode);

    const btnLocal = document.getElementById('btn-host-local');
    const btnCloud = document.getElementById('btn-host-cloud');
    const badge = document.getElementById('cloud-status-badge');
    const tokenContainer = document.getElementById('cloud-token-container');

    if (mode === 'cloud') {
        if (btnCloud) {
            btnCloud.className = 'btn btn-blue btn-sm';
            btnCloud.style.background = '#00d2d3';
            btnCloud.style.color = '#000';
            btnCloud.style.fontWeight = 'bold';
        }
        if (btnLocal) {
            btnLocal.className = 'btn btn-outline btn-sm';
            btnLocal.style.background = '';
            btnLocal.style.color = '';
            btnLocal.style.fontWeight = 'normal';
        }
        if (badge) {
            badge.style.display = 'inline-block';
            badge.innerText = 'En línea en Render';
            badge.style.borderColor = '#00d2d3';
            badge.style.color = '#00d2d3';
        }
        if (tokenContainer) {
            tokenContainer.style.display = 'flex';
        }
    } else {
        if (btnLocal) {
            btnLocal.className = 'btn btn-blue btn-sm';
            btnLocal.style.background = 'var(--primary-blue)';
            btnLocal.style.color = '#fff';
            btnLocal.style.fontWeight = 'bold';
        }
        if (btnCloud) {
            btnCloud.className = 'btn btn-outline btn-sm';
            btnCloud.style.background = '';
            btnCloud.style.color = '#aaa';
            btnCloud.style.fontWeight = 'normal';
        }
        if (badge) {
            badge.style.display = 'inline-block';
            badge.innerText = 'Local (PC)';
            badge.style.borderColor = '#888';
            badge.style.color = '#aaa';
        }
        if (tokenContainer) {
            tokenContainer.style.display = 'none';
        }
    }

    const effectiveToken = CLOUD_TOKEN || 'hinu';
    document.querySelectorAll('.overlay-link-input').forEach(input => {
        const path = input.getAttribute('data-path');
        if (!path) return;
        if (path === 'chat-widget.html' || input.id === 'chat-widget-link') {
            input.value = getChatWidgetUrl(mode);
            return;
        }
        if (mode === 'cloud') {
            input.value = `${CLOUD_BASE_URL}/${path}?token=${effectiveToken}`;
        } else {
            if (path.includes('overlay-musica')) {
                input.value = `http://localhost:3010/${path}`;
            } else {
                input.value = `http://localhost:3011/${path}`;
            }
        }
    });
    updateChatWidgetLink();
}

function copyOverlayUrl(btn) {
    let input = btn.parentElement ? btn.parentElement.querySelector('input') : null;
    if (!input) {
        const box = btn.closest('.widget-link-box');
        if (box) input = box.querySelector('input');
    }
    if (!input) return;

    input.select();
    navigator.clipboard.writeText(input.value).then(() => {
        const origHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check" style="color: #2ed573;"></i>';
        btn.classList.add('btn-green');
        btn.classList.remove('btn-outline');
        setTimeout(() => {
            btn.innerHTML = origHtml;
            btn.classList.remove('btn-green');
            btn.classList.add('btn-outline');
        }, 1500);
    });
}

// Inicializar enlaces y configuración al cargar la vista
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        loadCloudConfig();
        loadChatWidgetConfig();
        setOverlayHostMode(currentOverlayHostMode);
    });
} else {
    setTimeout(() => {
        loadCloudConfig();
        loadChatWidgetConfig();
        setOverlayHostMode(currentOverlayHostMode);
    }, 100);
}
