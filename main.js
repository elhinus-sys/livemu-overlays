process.on('uncaughtException', (err) => {
    console.error('[CRITICAL] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

const { app, BrowserWindow, ipcMain, shell, MessageChannelMain, globalShortcut, dialog, webContents, session } = require('electron');
let Server;
try {
    ({ Server } = require("socket.io"));
} catch (e) {
    console.warn("Socket.io dependency missing. Run 'npm install socket.io' to enable widgets.");
}
const http = require('http');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const fs = require('node:fs');
const { registerMinecraftIpcEvents } = require("./minecraft/ipcEvents");
const { registerTTLiveEvents } = require("./tiktoklive/ttIpcEvents");
const { registerWebConnectorEvents } = require("./webConnector");
const { registerHttpBridge } = require("./httpBridge/httpBridge");
const { registerFileWriter } = require("./fileWriter/fileWriter");
const { registerWebServer } = require("./webServer/webServer");
const { registerGTA5PluginManagerEvents } = require("./games/gta5");
const { registerWitcher3PluginEvents } = require("./games/witcher3");
const { registerfilesSystemManager } = require("./functions/files-system");
const { registerDeleteMods } = require("./delete-mod/delete-mod");
const { registerMusicBackend, processTikTokChat, setTikTokStreamer, sendTwitchMessage } = require("./music/backend");
const { type } = require('node:os');
const { exec } = require('child_process');
const crypto = require('crypto');
const play = require('play-dl');
const yts = require('yt-search');
const { TikTokLiveConnection } = require("tiktok-live-connector");
const { signProviderConfig } = require("./tiktoklive/ttIpcEvents"); // Reutilizamos la config si es posible, o importamos de manager

// --- PREVENCIÓN DE THROTTLING EN SEGUNDO PLANO ---
// Evita que Chromium congele o ralentice timers (setInterval), WebSockets y eventos al estar en segundo plano o minimizado
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// --- INICIO: Bloqueo de instancia única ---
// Esto previene que la aplicación se abra más de una vez, evitando errores.
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    // Si no se obtiene el bloqueo, significa que ya hay una instancia corriendo.
    // Salimos de inmediato para no duplicar servidores ni puertos.
    console.log('[Main] Otra instancia de LiveMu ya está en ejecución. Enfocando ventana activa.');
    app.quit();
    process.exit(0);
} else {
    // Si obtuvimos el bloqueo, esta es la instancia principal.
    // Escuchamos por si alguien intenta abrir una segunda instancia.
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Cuando esto ocurre, traemos nuestra ventana principal al frente.
        if (win && !win.isDestroyed()) {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
        }
    });
}
// --- FIN: Bloqueo de instancia única ---

// Limpieza garantizada de atajos globales al cerrar la aplicación
app.on('will-quit', () => {
    try {
        globalShortcut.unregisterAll();
        console.log('[Main] Atajos globales liberados exitosamente al salir.');
    } catch (e) {
        console.error('[Main] Error liberando atajos globales:', e);
    }
});

// --- INICIO: Optimización de Motor Gráfico y Rendimiento GPU ---
// Mantener Aceleración por Hardware activada para que la GPU procese overlays y transparencias
// sin sobrecargar la CPU mientras se juega.
// Si hay parpadeo al restaurar, CalculateNativeWinOcclusion y flags de renderizado lo previenen de forma nativa.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');

// [OPTIMIZACIÓN V8] Recolección de basura preventiva para mantener bajo el consumo de RAM (<256MB)
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256');

// [OPTIMIZACIÓN PROCESOS] Compartir procesos de fondo entre URLs para reducir consumo base de RAM
app.commandLine.appendSwitch('disable-site-isolation-trials');

// [OPTIMIZACIÓN CACHÉ] Configurar caché ligera pero suficiente para evitar recargas continuas
app.commandLine.appendSwitch('disk-cache-size', '52428800'); // 50 MB
app.commandLine.appendSwitch('media-cache-size', '52428800'); // 50 MB
app.userAgentFallback = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
// --- FIN: Optimización de Motor Gráfico ---

console.log(`[Main] Electron Version: ${process.versions.electron}`);
console.log(`[Main] Node Version: ${process.versions.node}`);

const dns = require('dns');

let robot = null;
try {
    robot = require('robotjs');
    console.log('[Main] RobotJS cargado correctamente.');
} catch (e) { console.error('Warning: Failed to load robotjs (Keyboard shortcuts will not work):', e.message); }

// --- AUTO ESCRIBIR (JUEGO CONTEXTO) ---
const queueDePalabras = [];
let escribiendo = false;
let autoEscribirActivado = false;
let autoTwitchActivado = false;

ipcMain.on('set-auto-escribir', (event, estado) => {
    autoEscribirActivado = estado;
});

ipcMain.on('set-auto-twitch', (event, estado) => {
    autoTwitchActivado = estado;
});

async function procesarCola() {
    if (escribiendo || queueDePalabras.length === 0 || !robot) return;
    escribiendo = true;
    const palabraActual = queueDePalabras.shift();
    try {
        robot.typeString(palabraActual);
        await new Promise(resolve => setTimeout(resolve, 50));
        robot.keyTap('enter');
        await new Promise(resolve => setTimeout(resolve, 400));
    } catch (error) {
        console.error("Error al escribir con robotjs:", error);
    } finally {
        escribiendo = false;
        procesarCola();
    }
}

function agregarPalabraACola(mensaje) {
    if (!mensaje) return;
    // Si ninguna opción está activa, ignoramos para ahorrar recursos
    if (!autoEscribirActivado && !autoTwitchActivado) return;

    const palabraLimpia = mensaje.trim().split(' ')[0]; // Filtro de una sola palabra
    if (palabraLimpia.length > 0) {
        if (autoEscribirActivado) {
            queueDePalabras.push(palabraLimpia);
            procesarCola();
        }
        if (autoTwitchActivado) {
            if (typeof sendTwitchMessage === 'function') {
                console.log(`[Twitch Auto-escribir] Enviando: ${palabraLimpia}`);
                sendTwitchMessage(palabraLimpia);
            }
        }
    }
}
// --------------------------------------

const { killMinecraftServerProcess, getMinecraftServerProcess, process: runMinecraftServer } = require("./minecraft/minecraft");
const { registerRconEventHandler } = require("./rcon/rcon");
const { registerPluginManagerEvents } = require("./games/mod-installer");
const { registerWebSoket } = require("./socket/socketConnector");
const { signProviderConfig: globalSignConfig } = require("./tiktoklive/signProviderManager");

// --- CARGAR CATÁLOGO DE REGALOS POR DEFECTO ---
let defaultGiftCatalog = [];
try {
    const catalogData = require('./giftcatalog.json');
    defaultGiftCatalog = Object.entries(catalogData).map(([id, gift]) => ({
        id: id,
        name: gift.name,
        diamond_count: gift.diamondCount,
        image: { url_list: [gift.image] }
    }));
} catch (e) { console.log('Info: No se encontró giftcatalog.json o es inválido.'); }

// --- MIGRACIÓN DE DATOS (Stream To Earn v2 -> LiveMu) ---
function migrateOldData() {
    try {
        const newUserDataPath = app.getPath('userData');
        const oldProductName = 'Stream To Earn v2';
        const userDataRoot = path.dirname(newUserDataPath);
        const oldUserDataPath = path.join(userDataRoot, oldProductName);

        // Si existen datos antiguos y NO hay configuración en la nueva carpeta
        if (fs.existsSync(oldUserDataPath) && !fs.existsSync(path.join(newUserDataPath, 'app_config.json'))) {
            console.log(`[Migration] Detectados datos antiguos en: ${oldUserDataPath}`);
            console.log(`[Migration] Migrando a: ${newUserDataPath}`);

            if (!fs.existsSync(newUserDataPath)) {
                fs.mkdirSync(newUserDataPath, { recursive: true });
            }

            // Copiar todo el contenido recursivamente
            fs.cpSync(oldUserDataPath, newUserDataPath, { recursive: true, force: true });
            console.log('[Migration] ¡Migración completada con éxito!');
        }
    } catch (e) {
        console.error('[Migration] Error durante la migración:', e);
    }
}
migrateOldData();

// Глобальные переменные для Minecraft сервера
global.minecraftServerPath = null;
global.minecraftServerXmx = '4G';
global.minecraftServerXms = '2G';
global.javaArgs = '';
global.serverProfiles = [];
global.activeProfileId = null;
global.chatConfig = {
    chat: { enabled: true, format: '/tellraw @a ["",{"text":"<"},{"text":"{nickname}","color":"{colorName}"},{"text":"> {message}"}]' },
    gift: { enabled: true, format: '/tellraw @a ["",{"text":"{nickname}","color":"{colorName}"},{"text":" envió "},{"text":"{giftName} x{count}","color":"gold"}]' },
    follow: { enabled: true, format: '/tellraw @a ["",{"text":"{nickname}","color":"{colorName}"},{"text":" ahora te sigue!","color":"green"}]' },
    subscribe: { enabled: true, format: '/tellraw @a ["",{"text":"{nickname}","color":"{colorName}"},{"text":" se ha suscrito!","color":"light_purple"}]' },
    emote: { enabled: true, format: '/tellraw @a ["",{"text":"{nickname}","color":"{colorName}"},{"text":" envió "},{"text":"{emoteName}","color":"gold"}]' },
    colors: { viewer: 'blue', follower: 'dark_green', friend: 'gold' }
};

// Инициализация глобальных переменных для WebSocket
global.socketConnectionInfo = {
    isConnected: false,
    isLauncher: false,
    clientInfo: null,
    launcherInfo: null,
    connectedAt: null
};
global.s4eLauncherSocket = null;
let currentTikTokUsername = null;

// --- CONFIGURACIÓN PERSISTENTE (Server JAR) ---
const configPath = path.join(app.getPath('userData'), 'app_config.json');
try {
    if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.minecraftServerPath) global.minecraftServerPath = config.minecraftServerPath;
        if (config.minecraftServerXmx) global.minecraftServerXmx = config.minecraftServerXmx;
        if (config.minecraftServerXms) global.minecraftServerXms = config.minecraftServerXms;
        if (config.javaArgs) global.javaArgs = config.javaArgs;
        if (config.serverProfiles) global.serverProfiles = config.serverProfiles;
        if (config.activeProfileId) global.activeProfileId = config.activeProfileId;
        if (config.chatConfig) {
            // Migración simple si la config es antigua (solo chat)
            if (config.chatConfig.enabled !== undefined) {
                let fmt = config.chatConfig.format || global.chatConfig.chat.format;
                if (fmt === 'say <{nickname}> {message}') fmt = global.chatConfig.chat.format; // Actualizar formato antiguo
                global.chatConfig.chat = {
                    enabled: config.chatConfig.enabled,
                    format: fmt
                };
            } else {
                global.chatConfig = { ...global.chatConfig, ...config.chatConfig };
            }
            if (config.chatConfig.colors) global.chatConfig.colors = { ...global.chatConfig.colors, ...config.chatConfig.colors };
        }
    }
} catch (e) { console.error('Error loading config:', e); }

// --- GESTIÓN DE REGALOS (CACHE EN MEMORIA CON GUARDADO ASÍNCRONO) ---
const giftsPath = path.join(app.getPath('userData'), 'saved_gifts.json');
let inMemoryGifts = [];
try {
    if (fs.existsSync(giftsPath)) {
        inMemoryGifts = JSON.parse(fs.readFileSync(giftsPath, 'utf8'));
    }
} catch (e) { console.error('Error cargando saved_gifts.json inicial:', e); }
if (!Array.isArray(inMemoryGifts)) inMemoryGifts = [];

let giftsSaveTimeout = null;
function scheduleGiftsSave() {
    if (giftsSaveTimeout) return;
    giftsSaveTimeout = setTimeout(() => {
        giftsSaveTimeout = null;
        fs.promises.writeFile(giftsPath, JSON.stringify(inMemoryGifts, null, 2), 'utf8')
            .catch(err => console.error("[Gift Cache] Error guardando regalos en disco:", err));
    }, 4000);
}

function updateGiftCache(giftData) {
    try {
        const giftIdStr = String(giftData.giftId);
        const exists = inMemoryGifts.find(g => String(g.id) === giftIdStr);

        if (!exists) {
            let dCount = giftData.diamondCount || giftData.diamond_count || 0;
            let gName = giftData.giftName;

            // Fallback: Check default catalog if price is 0
            if ((dCount === 0 || !gName) && defaultGiftCatalog) {
                const def = defaultGiftCatalog.find(g => String(g.id) === giftIdStr);
                if (def) {
                    if (dCount === 0) dCount = def.diamond_count;
                    if (!gName) gName = def.name;
                }
            }

            // Crear objeto de regalo compatible
            const newGift = {
                id: giftData.giftId,
                name: gName,
                diamond_count: dCount,
                image: { url_list: [giftData.giftPictureUrl || ''] }
            };
            inMemoryGifts.push(newGift);
            widgetData.gifts = inMemoryGifts; // Actualizar para OBS Widget en tiempo real
            scheduleGiftsSave(); // Guardar asíncrono sin bloquear el Event Loop

            if (global.widgetIo) global.widgetIo.emit('update-gifts', inMemoryGifts);
            console.log(`[Gift Cache] Nuevo regalo guardado en RAM: ${newGift.name} (${newGift.id})`);
            return newGift;
        }
    } catch (e) { console.error("Error actualizando caché de regalos:", e); }
    return null;
}

// --- GESTIÓN DE EMOTES (CACHE EN MEMORIA CON GUARDADO ASÍNCRONO) ---
const emotesPath = path.join(app.getPath('userData'), 'saved_emotes.json');
let inMemoryEmotes = [];
try {
    if (fs.existsSync(emotesPath)) {
        inMemoryEmotes = JSON.parse(fs.readFileSync(emotesPath, 'utf8'));
    }
} catch (e) { console.error('Error cargando saved_emotes.json inicial:', e); }
if (!Array.isArray(inMemoryEmotes)) inMemoryEmotes = [];

// Limpieza inicial de duplicados en RAM
const initialSeenEmotes = new Set();
inMemoryEmotes = inMemoryEmotes.filter(e => {
    if (!e.id || initialSeenEmotes.has(String(e.id))) return false;
    initialSeenEmotes.add(String(e.id));
    return true;
});

let emotesSaveTimeout = null;
function scheduleEmotesSave() {
    if (emotesSaveTimeout) return;
    emotesSaveTimeout = setTimeout(() => {
        emotesSaveTimeout = null;
        fs.promises.writeFile(emotesPath, JSON.stringify(inMemoryEmotes, null, 2), 'utf8')
            .catch(err => console.error("[Emote Cache] Error guardando emotes en disco:", err));
    }, 4000);
}

function updateEmoteCache(emoteData) {
    try {
        if (!emoteData.emoteId) return null;
        const emoteIdStr = String(emoteData.emoteId);
        const existing = inMemoryEmotes.find(e => String(e.id) === emoteIdStr);
        const newImageUrl = emoteData.emoteImageUrl || (emoteData.image && (emoteData.image.url_list ? emoteData.image.url_list[0] : (emoteData.image.url ? emoteData.image.url[0] : ''))) || '';
        const newName = `#${emoteData.emoteId}`;

        if (existing) {
            let updated = false;
            if (newImageUrl && (!existing.image || !existing.image.url_list || existing.image.url_list[0] !== newImageUrl)) {
                existing.image = { url_list: [newImageUrl] };
                updated = true;
            }
            if (existing.name !== newName) {
                existing.name = newName;
                updated = true;
            }
            if (updated) {
                scheduleEmotesSave();
                return existing;
            }
        } else {
            const newEmote = {
                id: emoteData.emoteId,
                name: newName,
                image: { url_list: [newImageUrl] }
            };
            inMemoryEmotes.push(newEmote);
            scheduleEmotesSave();
            console.log(`[Emote Cache] Nuevo emote registrado en RAM: ${newEmote.name} (${newEmote.id})`);
            return newEmote;
        }
    } catch (e) { console.error("Error actualizando caché de emotes:", e); }
    return null;
}

// --- FUNCIÓN DE LOGS PARA EL UPDATER ---
function logUpdater(message) {
    const logPath = path.join(app.getPath('userData'), 'updater_logs.txt');
    try {
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
    } catch (e) { console.error('Log error:', e); }
}

async function setupUpdates(retry = false) {
    if (!retry) {
        const isInternetConnected = await checkInternetConnection();
        if (!isInternetConnected) {
            console.error('No internet connection');
            if (!win) createWindow(); // Abrir app si no hay internet
            return;
        }
    }


    if (!app.isPackaged) {
        logUpdater('App no empaquetada (Modo Dev). Saltando actualizaciones.');
        if (!win) createWindow();
        return;  // Прервать выполнение функции setupUpdates, если это режим разработки
    }

    // Configuración explícita para evitar error de app-update.yml faltante
    autoUpdater.setFeedURL({
        provider: 'github',
        owner: 'lockzz1',
        repo: 'LiveMu'
    });

    // Desactivar descarga automática para que sea opcional
    autoUpdater.autoDownload = false;

    // Limpiar listeners anteriores para evitar duplicados si se reintenta
    autoUpdater.removeAllListeners();

    autoUpdater.on('checking-for-update', () => {
        logUpdater('Buscando actualizaciones...');
    });

    autoUpdater.on('update-available', (info) => {
        logUpdater(`Actualización disponible encontrada: ${info.version}`);
        // Si la ventana no existe (inicio de app), la creamos primero
        if (!win) {
            createWindow();
            win.webContents.once('did-finish-load', () => {
                win.webContents.send('update-message', { status: 'available', version: info.version });
            });
        } else {
            win.webContents.send('update-message', { status: 'available', version: info.version });
        }
    });

    autoUpdater.on('download-progress', (progress) => {
        if (win) win.webContents.send('update-message', { status: 'downloading', progress: progress.percent });
    });

    autoUpdater.on('update-downloaded', (info) => {
        logUpdater(`Actualización descargada: ${info.version}. Instalando y reiniciando automáticamente...`);
        if (win) win.webContents.send('update-message', { status: 'installing', version: info.version });

        // Damos 2 segundos para que el usuario lea el mensaje en la interfaz antes de forzar el cierre
        setTimeout(() => {
            autoUpdater.quitAndInstall();
        }, 2000);
    });

    autoUpdater.on('update-not-available', (info) => {
        logUpdater(`No hay actualizaciones. Versión actual: ${app.getVersion()}. Remota: ${info ? info.version : '?'}`);
        if (win) {
            win.webContents.send('update-message', { status: 'no-update', version: info ? info.version : '' });
        } else {
            createWindow();
        }
    });

    autoUpdater.on('error', (error) => {
        logUpdater(`ERROR en auto-updater: ${error}`);
        if (win) {
            win.webContents.send('update-message', { status: 'error', error: error.toString() });
        } else {
            createWindow(); // Abrir app si falla la actualización
        }
    });

    logUpdater(`Iniciando chequeo. Versión actual instalada: ${app.getVersion()}`);
    autoUpdater.checkForUpdates();
}

function checkInternetConnection() {
    return new Promise((resolve) => {
        dns.lookup('google.com', (err) => {
            if (err && err.code === "ENOTFOUND") {
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}


// console.log('app.whenReady');
const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
app.whenReady().then(setupUpdates).then(async () => {
    const { session } = require('electron');

    // Cambiar UA a nivel de sesión completa para que YouTube no detecte Electron
    // Esto afecta TODAS las peticiones, incluyendo las del iframe de YouTube
    session.defaultSession.setUserAgent(chromeUA);

    // Handler global: un único handler para TODA la sesión (dev y exe empaquetado).
    // Usa youtube.com como Origin para que YouTube acepte las peticiones del reproductor.
    // NOTA: playerVars.origin (localhost:3010) es solo para seguridad de postMessage
    //       y NO afecta la validación HTTP del servidor de YouTube.
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
        if (details.url.includes('youtube.com') || details.url.includes('googlevideo.com')) {
            delete details.requestHeaders['sec-ch-ua'];
            delete details.requestHeaders['sec-ch-ua-mobile'];
            delete details.requestHeaders['sec-ch-ua-platform'];
            details.requestHeaders['User-Agent'] = chromeUA;
            details.requestHeaders['Referer'] = 'https://www.youtube.com/';
            details.requestHeaders['Origin'] = 'https://www.youtube.com';
        }
        callback({ cancel: false, requestHeaders: details.requestHeaders });
    });

    // Verificación de permisos de Administrador (Windows)
    if (process.platform === 'win32') {
        require('child_process').exec('net session', { windowsHide: true, stdio: 'ignore' }, function (err) {
            if (err) {
                console.warn('[ADVERTENCIA] La aplicación NO se está ejecutando como Administrador. Los atajos podrían fallar dentro de ciertos juegos.');
            } else {
                console.log('[INFO] Permisos de Administrador confirmados. Los atajos globales deberían funcionar.');
            }
        });
    }
    // Регистрируем горячие клавиши Alt + 0 до Alt + 9
    registerAltHotkeys();
    globalShortcut.register('Alt+CommandOrControl+I', () => {
        win.webContents.openDevTools()
    });
    // Atajo para mostrar/enfocar la interfaz principal
    globalShortcut.register('Alt+CommandOrControl+L', () => {
        if (win && !win.isDestroyed()) {
            win.show();
            win.focus();
        } else {
            createWindow();
        }
    });
});

let win;
// const angularPath = process.env.ANGULAR_PATH || path.resolve(__dirname, '..', 'angular', 'dist', 'streamwarps-client');
const currentPath = __dirname;
const angularPath = path.resolve(currentPath, '..', 'dist', 'streamwarps-client');
let musicBackendRegistered = false;
// console.log(angularPath,'---------------')
async function createWindow() {
    if (win) return;

    // [OPTIMIZACIÓN RAM] La ventana de overlays (canvasWin ~95MB) ya no se inicia
    // innecesariamente al arrancar. Se creará bajo demanda cuando se use la pestaña Overlays.
    // createCanvasWindow();

    // El handler de sesión global (registrado en app.whenReady) ya cubre YouTube.
    // No se necesita un handler adicional aquí.

    win = new BrowserWindow({
        title: 'LiveMu',
        width: 1400,
        height: 1000,
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webviewTag: true,
            webSecurity: false,
            allowRunningInsecureContent: true,
            backgroundThrottling: false,
            preload: path.join(__dirname, 'music', 'preload.js'),
        }
    });

    if (win.webContents && win.webContents.setBackgroundThrottling) {
        win.webContents.setBackgroundThrottling(false);
    }

        registerMusicBackend(win);
        musicBackendRegistered = true;
        win.setMenu(null);

        win.webContents.on('did-finish-load', () => {
            const sendGifts = () => {
                if (win && !win.isDestroyed()) {
                    let gifts = (inMemoryGifts && inMemoryGifts.length > 0) ? inMemoryGifts : defaultGiftCatalog;
                    if (gifts && gifts.length > 0) win.webContents.send('getAvailableGifts', { success: true, gifts: gifts });
                }
            };
            sendGifts();
            setTimeout(sendGifts, 1500);
        });

        win.webContents.on('before-input-event', (event, input) => {
            if (input.type === 'keyDown' && ((input.control && input.shift && input.key.toLowerCase() === 'i') || input.key === 'F12')) {
                win.webContents.toggleDevTools();
                event.preventDefault();
            }
        });

        if (win && !win.isDestroyed()) {
            win.loadURL('http://localhost:3010/local-interface.html').catch(() => {
                if (win && !win.isDestroyed()) {
                    win.loadFile(path.join(__dirname, 'local-interface.html')).catch(() => {});
                }
            });
            win.show();
            win.focus();

            win.on('minimize', () => {
                if (win && !win.isDestroyed()) win.webContents.send('window-minimized-state', true);
            });
            win.on('restore', () => {
                if (win && !win.isDestroyed()) win.webContents.send('window-minimized-state', false);
            });
        }

        win.on('closed', function () {
            win = null;
            app.quit();
        });

        win.on('close', function (cevent) {
            try { saveWidgetState(true); } catch (e) { }
            killMinecraftServerProcess();
        });

        win.webContents.setWindowOpenHandler(({ url }) => {
            const googleAccountsRegex = /^(https?:\/\/)?(www\.)?(accounts\.google\.com)/i;
            const kickOAuthRegex = /^(https?:\/\/)?(id\.)?(kick\.com\/oauth|kick\.com\/api\/v1\/oauth)/i;

            if (googleAccountsRegex.test(url) || kickOAuthRegex.test(url)) {
                return { action: 'allow' };
            } else {
                if (!url.startsWith("bytedance://")) {
                    try {
                        const parsed = new URL(url);
                        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                            shell.openExternal(url).catch((err) => {
                                console.warn("[Main] shell.openExternal failed:", err.message);
                            });
                        }
                    } catch (e) {
                        console.warn("[Main] Blocked invalid URL in window handler:", url);
                    }
                }
                return { action: 'deny' };
            }
        });
}

let chatPopoutWin = null;
ipcMain.on('local-open-chat-popout', () => {
    if (chatPopoutWin && !chatPopoutWin.isDestroyed()) {
        chatPopoutWin.show();
        chatPopoutWin.focus();
        return;
    }
    chatPopoutWin = new BrowserWindow({
        width: 400, height: 600, title: 'Multi-Chat',
        icon: path.join(__dirname, 'icon.ico'),
        autoHideMenuBar: true,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
    chatPopoutWin.loadURL('http://localhost:3011/multichat.html');
    chatPopoutWin.on('closed', () => {
        chatPopoutWin = null;
    });
});

let lastDigitPressed = null;

function sendToAllWindows(channel, ...args) {
    webContents.getAllWebContents().forEach(wc => {
        if (!wc.isDestroyed()) {
            const url = wc.getURL();
            // [OPTIMIZACIÓN] Filtrar ventanas que no necesitan recibir eventos globales (ahorro de RAM/CPU)
            if (url.startsWith('devtools://') || url.includes('kick.com') || url.includes('google.com')) return;
            try { wc.send(channel, ...args); } catch (e) { }
        }
    });
    if (global.widgetIo) {
        global.widgetIo.emit(channel, ...args);
    }
}


function registerAltHotkeys() {
    // Atajos predefinidos desactivados
}

// Выводим последнюю нажатую цифру в консоль
ipcMain.on('getLastDigitPressed', (event) => {
    console.log('getLastDigitPressed', lastDigitPressed)
    // event.reply('lastDigitPressed', lastDigitPressed);
});

// --- GESTIÓN DE ATAJOS GLOBALES DINÁMICOS ---
let registeredShortcuts = [];
let configuredShortcuts = [];
let shortcutsPaused = false;

// --- ROBOTJS PASS-THROUGH (Solución para escribir mientras se detecta) ---
function handleShortcutTrigger(sc) {
    // 1. Desregistrar temporalmente para evitar bucle infinito (Electron bloquea -> RobotJS envía -> Electron detecta...)
    try { globalShortcut.unregister(sc); } catch (e) { }

    // 2. Simular la tecla original para que el sistema la reciba (Escribir)
    try {
        const lowerSc = sc.toLowerCase();
        const parts = lowerSc.split('+');
        let key = parts.pop();
        const modifiers = parts.map(m => {
            if (m === 'ctrl' || m === 'control' || m === 'commandorcontrol') return 'control';
            if (m === 'alt') return 'alt';
            if (m === 'shift') return 'shift';
            if (m === 'meta' || m === 'super' || m === 'win' || m === 'command') return 'command';
            return null;
        }).filter(x => x);

        // Mapeos básicos para RobotJS
        const map = {
            'esc': 'escape', 'return': 'enter', 'ins': 'insert', 'del': 'delete',
            'space': 'space', 'plus': 'audio_vol_up', 'minus': 'audio_vol_down',
            'num0': 'numpad_0', 'num1': 'numpad_1', 'num2': 'numpad_2', 'num3': 'numpad_3',
            'num4': 'numpad_4', 'num5': 'numpad_5', 'num6': 'numpad_6', 'num7': 'numpad_7',
            'num8': 'numpad_8', 'num9': 'numpad_9', 'numdec': 'numpad_decimal',
            'numadd': 'numpad_add', 'numsub': 'numpad_subtract', 'nummult': 'numpad_multiply',
            'numdiv': 'numpad_divide', 'up': 'up', 'down': 'down', 'left': 'left', 'right': 'right'
        };
        if (map[key]) key = map[key];

        if (robot) {
            // Usar keyToggle con delay para que los juegos detecten la pulsación
            robot.keyToggle(key, 'down', modifiers);
            setTimeout(() => {
                if (robot) robot.keyToggle(key, 'up', modifiers);
            }, 100);
        }
    } catch (e) {
        console.error('[Shortcuts] Error re-enviando tecla:', e);
    }

    // 3. Notificar a la UI (Ejecutar Acción)
    sendToAllWindows('global-shortcut-pressed', sc);

    // 4. Reactivar el atajo después de un breve delay (para que no capture su propia simulación)
    setTimeout(() => {
        try {
            if (!shortcutsPaused && configuredShortcuts.includes(sc)) {
                globalShortcut.register(sc, () => handleShortcutTrigger(sc));
            }
        } catch (e) { }
    }, 150);
}

function refreshShortcuts() {
    // 1. Limpiar registrados
    registeredShortcuts.forEach(sc => {
        try { globalShortcut.unregister(sc); } catch (e) { }
    });
    registeredShortcuts = [];

    // 2. Si está pausado, no registrar nada
    if (shortcutsPaused) return;

    // 3. Registrar configurados
    configuredShortcuts.forEach(sc => {
        if (!sc) return;

        // SAFETY: Si robotjs falló al cargar, NO registrar teclas simples (ej: "A")
        // Esto evita que el usuario pierda la capacidad de escribir esa letra.
        if (!robot) {
            const isSimpleKey = !sc.includes('+') && !['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'PrintScreen', 'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown'].includes(sc);
            if (isSimpleKey) {
                console.warn(`[Shortcuts] OMITIDO: '${sc}' - RobotJS no está activo. Revisa la consola para errores.`);
                sendToAllWindows('shortcut-error', sc);
                return;
            }
        }

        try {
            if (globalShortcut.isRegistered(sc)) return;

            const ret = globalShortcut.register(sc, () => handleShortcutTrigger(sc));
            if (ret) registeredShortcuts.push(sc);
        } catch (e) { console.error('[Shortcuts] Error:', sc, e); }
    });
}

ipcMain.on('update-global-shortcuts', (event, shortcuts) => {
    configuredShortcuts = Array.isArray(shortcuts) ? shortcuts : [];
    refreshShortcuts();
});

ipcMain.on('pause-global-shortcuts', (event, paused) => {
    if (shortcutsPaused !== paused) {
        shortcutsPaused = paused;
        refreshShortcuts();
    }
});

// Handler para logs desde el renderer (Modo Fantasma)
ipcMain.on('renderer-log', (event, ...args) => {
    console.log('[Renderer]', ...args);
    sendToAllWindows('minecraft-log', `[Cloud] ${args.join(' ')}`);
});

ipcMain.on('retry-update', () => {
    console.log('retry-update')
    setupUpdates(true); // Повторный вызов функции setupUpdates
    appErrorWin.close()
});

ipcMain.on('check-for-updates', () => {
    setupUpdates(true);
});

ipcMain.on('start-download-update', () => {
    autoUpdater.downloadUpdate();
});

ipcMain.on('install-update-now', () => {
    autoUpdater.quitAndInstall();
});

// --- FIX DIALOGOS NATIVOS Y PERDIDA DE FOCO ---
ipcMain.on('native-alert', (event, message) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    dialog.showMessageBoxSync(window, {
        type: 'info',
        buttons: ['Aceptar'],
        title: 'Atención',
        message: message
    });
    event.returnValue = true;
});

ipcMain.on('native-confirm', (event, message) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = dialog.showMessageBoxSync(window, {
        type: 'question',
        buttons: ['Cancelar', 'Aceptar'],
        defaultId: 1,
        cancelId: 0,
        title: 'Confirmación',
        message: message
    });
    event.returnValue = (result === 1);
});

ipcMain.on('getJavaVersion', (event) => {
    function getJavaVersion(callback) {
        var spawn = require('child_process').spawn('java', ['-version']);
        var javaVersionReceived = false;

        spawn.on('error', function (err) {
            callback(err, null);
        });

        spawn.stderr.on('data', function (data) {
            if (!javaVersionReceived) {
                data = data.toString().split('\n')[0];
                var javaVersion = new RegExp('(java|openjdk) version').test(data) ? data.split(' ')[2].replace(/"/g, '') : false;
                if (javaVersion) {
                    javaVersionReceived = true;
                    callback(null, javaVersion);
                    spawn.kill(); // Закрыть процесс после получения версии
                }
            }
        });

        spawn.on('exit', function (code) {
            if (code !== 0 && !javaVersionReceived) {
                callback(new Error(`Java process exited with code ${code}`), null);
            }
        });
    }


    getJavaVersion((error, javaVersion) => {
        if (error) {
            // console.error('Error getting Java version:', error);
            event.reply('getJavaVersion', null);
        } else {
            // console.log('Java Version:', javaVersion);
            event.reply('getJavaVersion', javaVersion);
        }
    });
});

registerMinecraftIpcEvents();
registerTTLiveEvents();
registerHttpBridge();
registerFileWriter();
registerWebServer();
registerWebConnectorEvents(processAndBroadcastEvent);
registerGTA5PluginManagerEvents();
registerfilesSystemManager();
registerWitcher3PluginEvents();
// registerKeyboardEventHandler();
registerRconEventHandler();
// registerKeyboardEventHandler();
registerDeleteMods();
registerPluginManagerEvents();
registerWebSoket(onWin, onLose);

// Kick OAuth handler
ipcMain.on('openKickOAuth', (event, { url, userId, state }) => {
    // Логуємо URL для діагностики
    // console.log('Kick OAuth - Opening window with URL:', url);
    // console.log('Kick OAuth - URL length:', url?.length);
    // console.log('Kick OAuth - Has scope in URL:', url?.includes('scope'));

    // Перевіряємо scope в URL
    try {
        const urlObj = new URL(url);
        const scopeParam = urlObj.searchParams.get('scope');
        // console.log('Kick OAuth - Scope from URL:', scopeParam ? 'PRESENT' : 'MISSING', {
        //   length: scopeParam?.length || 0,
        //   value: scopeParam?.substring(0, 50) || 'empty'
        // });

        if (!scopeParam || scopeParam.trim() === '') {
            console.error('CRITICAL: Scope is empty in OAuth URL!', { url });
        }
    } catch (err) {
        console.error('Error parsing OAuth URL:', err);
    }

    const authWindow = new BrowserWindow({
        width: 600,
        height: 700,
        modal: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    authWindow.setTitle('Kick OAuth');
    authWindow.loadURL(url);

    let callbackHandled = false;

    function tryHandleCallback(navigationUrl, source) {
        if (callbackHandled) return false;
        try {
            const urlObj = new URL(navigationUrl);

            // Проверяем, что URL содержит streamtoearn (это наш redirect_uri для Kick OAuth)
            // Это предотвращает перехват других OAuth callbacks (например, Google)
            const lowerUrl = navigationUrl.toLowerCase();
            if (!lowerUrl.includes('streamtoearn') && !lowerUrl.includes('localhost') && !lowerUrl.includes('127.0.0.1')) {
                return false; // Это не наш callback, игнорируем
            }

            const hasCode = urlObj.searchParams.has('code');
            const receivedState = urlObj.searchParams.get('state');
            if (hasCode) {
                const code = urlObj.searchParams.get('code');
                if (!receivedState) {
                    console.warn('Kick OAuth: state missing on callback (' + source + '), but will be handled by server');
                }
                // Убираем проверку state на клиенте - проверка должна происходить на сервере
                // где state сохранен в базе данных для пользователя
                // Сервер может найти state по userId, если он не передан
                callbackHandled = true;
                authWindow.close();
                event.reply('kickOAuthCallback', { success: true, code, state: receivedState || state });
                return true;
            }
            if (urlObj.searchParams.has('error')) {
                const error = urlObj.searchParams.get('error');
                callbackHandled = true;
                authWindow.close();
                event.reply('kickOAuthCallback', { error: `Kick OAuth error: ${error}` });
                return true;
            }
        } catch (e) {
            console.error('Kick OAuth: parse error (' + source + '):', e);
        }
        return false;
    }

    // Перехоплюємо всі можливі сценарії редиректів
    authWindow.webContents.on('will-navigate', (navigationEvent, navigationUrl) => {
        if (tryHandleCallback(navigationUrl, 'will-navigate')) {
            navigationEvent.preventDefault();
        }
    });

    authWindow.webContents.on('will-redirect', (_event, urlTo, _isInPlace, _isMainFrame, _frameProcessId, _frameRoutingId) => {
        tryHandleCallback(urlTo, 'will-redirect');
    });

    authWindow.webContents.on('did-redirect-navigation', (_event, urlTo) => {
        tryHandleCallback(urlTo, 'did-redirect-navigation');
    });

    authWindow.webContents.on('did-navigate', (_event, urlTo) => {
        tryHandleCallback(urlTo, 'did-navigate');
    });

    authWindow.webContents.on('did-navigate-in-page', (_event, urlTo) => {
        tryHandleCallback(urlTo, 'did-navigate-in-page');
    });

    // Також перевіряємо URL після завантаження сторінки
    authWindow.webContents.on('did-finish-load', () => {
        const currentUrl = authWindow.webContents.getURL();
        tryHandleCallback(currentUrl, 'did-finish-load');
    });

    authWindow.on('closed', () => {
        // Якщо вікно закрито без callback, відправляємо подію для прибирання spinner
        if (!callbackHandled && win && !win.isDestroyed()) {
            win.webContents.send('kickOAuthWindowClosed');
        }
    });
});

ipcMain.on('getElectronVersion', (event) => {
    // console.log('getElectronVersion: ', app.getVersion())
    event.reply('electronVersionReply', app.getVersion());
});

ipcMain.on('getRoomInfo', (event, args) => {
    const { username } = args;
    // Usar la configuración global de firma para evitar errores 10011
    const options = {
        processInitialData: false,
        fetchRoomInfoOnConnect: false,
        enableExtendedGiftInfo: false,
        clientParams: {
            app_language: 'es',
            webcast_language: 'es',
            display_language: 'es',
            language: 'es',
            locale: 'es-ES',
            sys_region: 'ES'
        },
        requestOptions: {
            headers: {
                'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
            }
        },
        signProviderOptions: {
            host: globalSignConfig.signProviderHost,
            fallbackHosts: globalSignConfig.signProviderFallbackHosts
        }
    };
    const tiktokLiveConnection = new TikTokLiveConnection(username, options);

    tiktokLiveConnection.fetchRoomInfo().then(roomInfo => {
        // console.log('roomInfo: ', roomInfo); // Silenciado para reducir ruido
        event.reply('getRoomInfo', roomInfo);
    }).catch(err => {
        // console.error(err); // Silenciado
    })
});

// Quit when all windows are closed.
app.on('window-all-closed', function () {
    // On macOS specific close process
    if (process.platform !== 'darwin') {
        app.quit()
    }
    killMinecraftServerProcess();
})

app.on('activate', function () {
    // macOS specific close process
    if (win === null) {
        createWindow()
    }
})

function onWin() {
    const lastDigitPressed = '=';
    sendToAllWindows('lastDigitPressed', lastDigitPressed);
}

function onLose() {
    const lastDigitPressed = '-';
    sendToAllWindows('lastDigitPressed', lastDigitPressed);
}

// Set global para almacenar los últimos eventos y evitar duplicados (Fantasmas de WebConnector)
const processedEventIds = new Set();
// Mapa para rastrear el progreso de regalos en racha/combo y sumar únicamente el incremento real (delta)
const activeGiftStreaks = new Map();

// --- SISTEMA DE BATCHING / THROTTLING DE LIKES (REDUCCIÓN 90% IPC Y WEBSOCKET) ---
let likeBatchBuffer = {
    totalLikes: 0,
    userLikes: new Map(), // uid -> { data, count, nickname, avatar }
    timeout: null
};

function flushLikeBatch() {
    likeBatchBuffer.timeout = null;
    if (likeBatchBuffer.totalLikes === 0 && likeBatchBuffer.userLikes.size === 0) return;

    if (!widgetData.topLikers) widgetData.topLikers = {};

    for (const [uid, uInfo] of likeBatchBuffer.userLikes.entries()) {
        if (!widgetData.topLikers[uid]) {
            widgetData.topLikers[uid] = { uid, nickname: uInfo.nickname, avatar: uInfo.avatar, count: 0 };
        } else if (uInfo.avatar) {
            widgetData.topLikers[uid].avatar = uInfo.avatar;
        }
        widgetData.topLikers[uid].count += uInfo.count;

        const batchedEventData = {
            ...uInfo.data,
            likeCount: uInfo.count,
            totalLikeCount: widgetData.sessionGlobalLikes
        };

        if (global.widgetIo) {
            global.widgetIo.emit('like_event', batchedEventData);
        }
        sendToAllWindows('tiktok-event', { type: 'like', data: batchedEventData });
    }

    likeBatchBuffer.totalLikes = 0;
    likeBatchBuffer.userLikes.clear();
}

function queueBatchedLike(data) {
    const likeCount = parseInt(data.likeCount || 1, 10);
    widgetData.sessionGlobalLikes = (widgetData.sessionGlobalLikes || 0) + likeCount;

    const uid = data.uniqueId || data.userId || (data.user && data.user.userId) || (data.user && data.user.id) || (data.user && data.user.uniqueId) || (data.sender && data.sender.userId) || 'unknown';
    const nickname = data.nickname || data.uniqueId || (data.user && data.user.nickname) || (data.sender && data.sender.nickname) || 'Viewer';

    let realAvatarUrl = null;
    const extractUrl = (obj) => {
        if (!obj) return null;
        if (obj.url && Array.isArray(obj.url) && obj.url.length > 0) return obj.url[0];
        if (typeof obj === 'string') return obj;
        return null;
    };
    if (data.user && data.user.profilePicture) realAvatarUrl = extractUrl(data.user.profilePicture);
    if (!realAvatarUrl && data.profilePictureUrl) realAvatarUrl = data.profilePictureUrl;
    if (!realAvatarUrl && data.sender && data.sender.avatar) realAvatarUrl = data.sender.avatar;

    likeBatchBuffer.totalLikes += likeCount;
    if (likeBatchBuffer.userLikes.has(uid)) {
        const item = likeBatchBuffer.userLikes.get(uid);
        item.count += likeCount;
        if (realAvatarUrl) item.avatar = realAvatarUrl;
    } else {
        likeBatchBuffer.userLikes.set(uid, {
            uid,
            nickname,
            avatar: realAvatarUrl,
            count: likeCount,
            data
        });
    }

    if (!likeBatchBuffer.timeout) {
        likeBatchBuffer.timeout = setTimeout(flushLikeBatch, 250);
    }
}

// --- FUNCIÓN CENTRALIZADA DE EVENTOS TIKTOK ---
function processAndBroadcastEvent(type, data) {
    // --- SISTEMA ANTI-DUPLICADOS ---
    if (data) {
        let eventId = data.msgId || data.id || data.messageId;

        // Si no hay un ID único (ej. regalos por WebConnector), creamos uno sintético
        if (!eventId) {
            const uid = data.uniqueId || data.userId || (data.user && data.user.uniqueId) || 'unk';
            const coarseTime = Math.floor(Date.now() / 1000); // Ventana de 1 segundo para fantasmas
            const ts = data.timestamp || data.createTime || coarseTime;

            if (type === 'gift') {
                eventId = `gift_${uid}_${data.giftId}_${data.groupId || ts}_${data.repeatCount || 1}`;
            } else if (type === 'like') {
                eventId = `like_${uid}_${data.likeCount || 1}_${ts}`;
            } else if (['follow', 'share', 'join', 'subscribe'].includes(type)) {
                eventId = `${type}_${uid}_${ts}`;
            }
        }

        if (eventId) {
            let uniqueKey = `${type}_${eventId}`;
            if (type === 'gift') {
                const rCount = data.repeatCount || data.repeat_count || 1;
                const rEnd = (data.repeatEnd || data.repeat_end) ? 1 : 0;
                uniqueKey = `gift_${eventId}_${rCount}_${rEnd}`;
            }
            if (processedEventIds.has(uniqueKey)) {
                // Es un evento duplicado proveniente de una conexión fantasma, lo ignoramos
                return;
            }
            processedEventIds.add(uniqueKey);
            // Mantener la memoria limpia (guardar solo los últimos 500 eventos)
            if (processedEventIds.size > 500) processedEventIds.delete(processedEventIds.values().next().value);
        }
    }

    switch (type) {
        case 'connection':
            if (data.isConnected) {
                let avatar = '';
                const roomInfo = data.state && data.state.roomInfo;
                if (roomInfo) {
                    const owner = roomInfo.owner || (roomInfo.data && roomInfo.data.owner);
                    if (owner) {
                        const thumb = owner.avatar_thumb || owner.avatar_medium || owner.avatar_large;
                        if (thumb) {
                            avatar = (thumb.url_list && thumb.url_list[0]) || thumb;
                        }
                    }
                }
                // Notificar a todas las ventanas que la conexión (vía WebConnector) fue exitosa.
                sendToAllWindows('tiktok-status', { connected: true, username: currentTikTokUsername, avatar: avatar });
                sendToAllWindows('tiktok-connection-status', { type: 'connected', username: currentTikTokUsername, avatar: avatar });
            } else {
                // Notificar desconexión si la ventana fue cerrada
                sendToAllWindows('tiktok-status', { connected: false, error: data.err || 'Desconectado' });
                sendToAllWindows('tiktok-connection-status', { type: 'disconnected', reason: data.err || 'Desconectado' });
            }
            break;
        case 'chat':
            data.uniqueId = data.uniqueId || data.userId || (data.user && data.user.uniqueId);
            data.nickname = data.nickname || (data.user && data.user.nickname) || data.uniqueId;
            console.log(`[TikTok] Chat: ${data.uniqueId} > ${data.comment}`);

            // Enviar palabra a la cola si la opción está activada (Juego Contexto)
            agregarPalabraACola(data.comment);

            // Enviar el mensaje al backend de música para los comandos (!sr, !skip, !borrar, etc.)
            if (typeof processTikTokChat === 'function') processTikTokChat(data);

            if (data.emotes && Array.isArray(data.emotes)) {
                data.emotes.forEach(item => {
                    if (!item || !item.emote) return;
                    const emote = item.emote;
                    if (emote && emote.emoteId) {
                        const enrichedData = {
                            ...data,
                            emoteId: emote.emoteId,
                            emoteImageUrl: (emote.image && (emote.image.imageUrl || (emote.image.url_list && emote.image.url_list[0]) || (emote.image.url && emote.image.url[0]))) || '',
                            emoteName: `#${emote.emoteId}`
                        };
                        const newEmote = updateEmoteCache(enrichedData);
                        if (newEmote) sendToAllWindows('new-emote-discovered', newEmote);
                        sendToAllWindows('tiktok-event', { type: 'emote', data: enrichedData });
                        sendToMinecraft('emote', enrichedData);
                    }
                });
            }
            sendToAllWindows('tiktok-event', { type: 'chat', data: data });
            sendToMinecraft('chat', data);
            break;

        case 'gift':
            // Normalizar usuario para evitar que llegue vacío a la interfaz
            data.uniqueId = data.uniqueId || data.userId || (data.user && data.user.uniqueId) || (data.sender && data.sender.uniqueId);
            data.nickname = data.nickname || (data.user && data.user.nickname) || (data.sender && data.sender.nickname) || data.uniqueId;

            const newGift = updateGiftCache(data);
            if (newGift) {
                sendToAllWindows('new-gift-discovered', newGift);
            }
            // Re-enriquecer datos para asegurar que la UI tenga todo
            let enrichedData = { ...data };
            let gName = enrichedData.giftName;
            let coins = enrichedData.diamondCount || enrichedData.diamond_count || 0;

            if (enrichedData.giftId) {
                const cachedGift = (widgetData.gifts || []).find(g => String(g.id) === String(enrichedData.giftId));
                if (cachedGift) {
                    if (!gName) enrichedData.giftName = cachedGift.name;
                    if (coins === 0) coins = cachedGift.diamond_count || cachedGift.cost || 0;

                    // ENRIQUECER IMAGEN DEL REGALO SI FALTA
                    if (!enrichedData.giftPictureUrl && cachedGift.image && cachedGift.image.url_list) {
                        enrichedData.giftPictureUrl = cachedGift.image.url_list[0];
                    }
                }
            }

            let count = enrichedData.repeatCount || enrichedData.repeat_count || 1;
            let deltaCount = count;

            // Manejo de rachas / combos (giftType === 1 o regalos con repeatCount / repeatEnd)
            const isStreakable = (enrichedData.giftType === 1 || (enrichedData.gift && enrichedData.gift.gift_type === 1) || (count > 1) || enrichedData.repeatEnd !== undefined || enrichedData.repeat_end !== undefined);
            if (isStreakable) {
                const streakKey = `${enrichedData.uniqueId || 'u'}_${enrichedData.giftId || 'g'}_${enrichedData.groupId || ''}`;
                const prevCount = activeGiftStreaks.get(streakKey) || 0;
                deltaCount = Math.max(0, count - prevCount);

                const isRepeatEnd = (enrichedData.repeatEnd === true || enrichedData.repeatEnd === 1 || enrichedData.repeat_end === true || enrichedData.repeat_end === 1);
                if (isRepeatEnd) {
                    activeGiftStreaks.delete(streakKey);
                } else {
                    activeGiftStreaks.set(streakKey, count);
                    setTimeout(() => activeGiftStreaks.delete(streakKey), 60000);
                }
            }

            // Si es un paquete repetido de fin de racha o sin nuevas monedas, no sumamos doble
            if (isStreakable && deltaCount === 0) {
                console.log(`[TikTok Gift] Paquete de fin de racha/duplicado para ${enrichedData.giftName} (sin monedas adicionales)`);
                return;
            }

            enrichedData.diamondCount = coins;
            enrichedData.diamond_count = coins;
            enrichedData.coins = coins;
            enrichedData.deltaCount = deltaCount;
            enrichedData.calculatedCoins = coins * deltaCount;

            sendToAllWindows('tiktok-event', { type: 'gift', data: enrichedData });
            sendToMinecraft('gift', enrichedData);

            if (global.widgetIo) {
                const uid = data.uniqueId || data.userId || (data.user && data.user.userId) || (data.user && data.user.id) || (data.user && data.user.uniqueId) || (data.sender && data.sender.userId) || 'unknown';
                const nickname = data.nickname || data.uniqueId || (data.user && data.user.nickname) || (data.sender && data.sender.nickname) || 'Viewer';

                let realAvatarUrl = null;
                const extractUrl = (obj) => { if (!obj) return null; if (obj.url && Array.isArray(obj.url) && obj.url.length > 0) return obj.url[0]; if (typeof obj === 'string') return obj; return null; };
                if (data.user && data.user.profilePicture) realAvatarUrl = extractUrl(data.user.profilePicture);
                if (!realAvatarUrl && data.profilePictureUrl) realAvatarUrl = data.profilePictureUrl;
                if (!realAvatarUrl && data.sender && data.sender.avatar) realAvatarUrl = data.sender.avatar;

                if (!widgetData.topGifters) widgetData.topGifters = {};
                if (!widgetData.topGifters[uid]) widgetData.topGifters[uid] = { uid, nickname, avatar: realAvatarUrl, count: 0 };
                else if (realAvatarUrl) widgetData.topGifters[uid].avatar = realAvatarUrl;

                if (enrichedData.calculatedCoins > 0) {
                    widgetData.topGifters[uid].count += enrichedData.calculatedCoins;
                    global.widgetIo.emit('gift_event', enrichedData);
                }
            }
            break;

        case 'like':
            queueBatchedLike(data);
            break;

        case 'share':
            sendToAllWindows('tiktok-event', { type: 'share', data: data });
            break;

        case 'follow':
            sendToAllWindows('tiktok-event', { type: 'follow', data: data });
            sendToMinecraft('follow', data);
            break;

        case 'join': // 'member' from tiktok-live-connector maps to 'join'
            sendToAllWindows('tiktok-event', { type: 'join', data: data });
            break;

        case 'roomUser':
            if (data && data.viewerCount !== undefined) {
                widgetData.viewerCount = data.viewerCount;
                if (global.widgetIo) global.widgetIo.emit('viewer_count', data.viewerCount);
            }
            sendToAllWindows('tiktok-event', { type: 'roomUser', data: data });
            break;

        case 'subscribe':
            sendToAllWindows('tiktok-event', { type: 'subscribe', data: data });
            sendToMinecraft('subscribe', data);
            break;

        case 'streamEnd':
            console.log('[TikTok] Stream ended.');
            sendToAllWindows('tiktok-connection-status', { type: 'disconnected', reason: 'El Live terminó' });
            if (widgetData) { widgetData.topLikers = {}; widgetData.topGifters = {}; }
            if (global.widgetIo) global.widgetIo.emit('reset_like_stats');
            break;
    }
}

// --- FUNCIONES PARA EL PANEL DE EVENTOS INFINITOS ---

ipcMain.on('local-send-command', async (event, command) => {
    const proc = getMinecraftServerProcess();
    if (proc && proc.stdin) {
        const match = String(command).match(/^\$x(\d+)\s*-\s*(.+)$/i);
        if (match) {
            const count = Math.max(1, parseInt(match[1], 10));
            let baseCmd = match[2];
            if (baseCmd.startsWith('/')) baseCmd = baseCmd.substring(1);
            for (let i = 0; i < count; i++) {
                proc.stdin.write(baseCmd + '\n');
                await new Promise(r => setTimeout(r, 50));
            }
        } else {
            const cmdToSend = command.startsWith('/') ? command.substring(1) : command;
            proc.stdin.write(cmdToSend + '\n');
        }
    } else {
        console.log('No se pudo enviar comando, servidor no iniciado o no accesible.');
    }
});

ipcMain.handle('local-get-chat-config', (event) => {
    return global.chatConfig;
});

ipcMain.on('local-save-chat-config', (event, config) => {
    global.chatConfig = config;
    try {
        const currentConfig = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
        currentConfig.chatConfig = global.chatConfig;
        fs.writeFileSync(configPath, JSON.stringify(currentConfig, null, 2));
    } catch (e) { console.error('Error saving chat config:', e); }
});

// --- UTILIDADES DE COLOR MINECRAFT ---
const MC_COLORS = [
    { name: 'dark_blue', code: '§1' }, { name: 'dark_green', code: '§2' }, { name: 'dark_aqua', code: '§3' },
    { name: 'dark_red', code: '§4' }, { name: 'dark_purple', code: '§5' }, { name: 'gold', code: '§6' },
    { name: 'gray', code: '§7' }, { name: 'dark_gray', code: '§8' }, { name: 'blue', code: '§9' },
    { name: 'green', code: '§a' }, { name: 'aqua', code: '§b' }, { name: 'red', code: '§c' },
    { name: 'light_purple', code: '§d' }, { name: 'yellow', code: '§e' }, { name: 'white', code: '§f' }
];

function getRoleColor(data) {
    const colors = global.chatConfig.colors || { viewer: 'blue', follower: 'dark_green', friend: 'gold' };
    let colorName = colors.viewer;

    // Detectar Rol (Prioridad: Amigo > Seguidor > Espectador)
    // followRole: 0=none, 1=follower, 2=friends
    if (data.followRole === 2 || data.isFriend) {
        colorName = colors.friend;
    } else if (data.followRole === 1 || data.isFollower) {
        colorName = colors.follower;
    }

    // Buscar código de color (§) para soporte legacy
    const colorObj = MC_COLORS.find(c => c.name === colorName) || { name: colorName, code: '§f' };

    return colorObj;
}

function sendToMinecraft(eventType, data) {
    if (!global.chatConfig || !global.chatConfig[eventType] || !global.chatConfig[eventType].enabled) return;

    const proc = getMinecraftServerProcess();
    if (proc && proc.stdin) {
        let msg = global.chatConfig[eventType].format;

        // Fallback si el formato está vacío (por si el usuario lo borró)
        if (!msg || msg.trim() === '') {
            if (eventType === 'chat') msg = '/tellraw @a ["",{"text":"<"},{"text":"{nickname}","color":"{colorName}"},{"text":"> {message}"}]';
            else if (eventType === 'gift') msg = '/tellraw @a ["",{"text":"{nickname}","color":"{colorName}"},{"text":" envió "},{"text":"{giftName} x{count}","color":"gold"}]';
            else if (eventType === 'follow') msg = '/tellraw @a ["",{"text":"{nickname}","color":"{colorName}"},{"text":" ahora te sigue!","color":"green"}]';
            else if (eventType === 'subscribe') msg = '/tellraw @a ["",{"text":"{nickname}","color":"{colorName}"},{"text":" se ha suscrito!","color":"light_purple"}]';
            else if (eventType === 'emote') msg = '/tellraw @a ["",{"text":"{nickname}","color":"{colorName}"},{"text":" envió "},{"text":"{emoteName}","color":"gold"}]';
        }

        const uniqueId = data.uniqueId || data.userId || (data.user && data.user.uniqueId) || 'User';
        const nickname = data.nickname || (data.user && data.user.nickname) || uniqueId;
        const colorInfo = getRoleColor(data);

        // Reemplazo de variables
        msg = msg.replace(/{nickname}/g, nickname);
        msg = msg.replace(/{uniqueId}/g, uniqueId);
        msg = msg.replace(/{color}/g, colorInfo.code); // Código legacy (§a)
        msg = msg.replace(/{colorName}/g, colorInfo.name); // Nombre JSON (green)

        // Variables específicas
        if (eventType === 'chat') {
            // Limpiar saltos de línea y escapar comillas
            let cleanMessage = (data.comment || '').replace(/(\r\n|\n|\r)/g, ' ').replace(/"/g, '\\"');
            cleanMessage = cleanMessage.replace(/\[emote:(\d+)(?::([^\]]+))?\]/g, (match, id, name) => name ? `:${name}:` : '');
            cleanMessage = cleanMessage.replace(/\[kick_emote:([^\]]+)\]/g, ''); // Evitar que el link salga en Minecraft
            msg = msg.replace(/{message}/g, cleanMessage);
        }
        if (eventType === 'gift') {
            let gName = data.giftName || (data.gift && data.gift.name) || (data.extendedGiftInfo && data.extendedGiftInfo.name);

            // Si no viene el nombre, buscar en el caché en memoria de regalos guardados o catálogo
            if (!gName && data.giftId) {
                const giftIdStr = String(data.giftId);
                const cachedGift = inMemoryGifts.find(g => String(g.id) === giftIdStr);
                if (cachedGift && cachedGift.name) gName = cachedGift.name;

                if (!gName && defaultGiftCatalog) {
                    const defGift = defaultGiftCatalog.find(g => String(g.id) === giftIdStr);
                    if (defGift && defGift.name) gName = defGift.name;
                }
            }

            gName = gName || (data.giftId ? `Gift ${data.giftId}` : 'Gift');

            msg = msg.replace(/{giftName}/g, gName);
            msg = msg.replace(/{giftname}/g, gName);
            msg = msg.replace(/{count}/g, data.repeatCount || 1);
        }
        if (eventType === 'emote') {
            const eName = data.emoteName || 'Emote';
            msg = msg.replace(/{emoteName}/g, eName);
        }

        // Enviar comando
        // Quitar la barra inicial '/' si existe, ya que la consola del servidor no la necesita
        if (msg.startsWith('/')) msg = msg.substring(1);
        proc.stdin.write(msg + '\n');
    }
}

let activeTikTok = null;
ipcMain.on('local-connect-tiktok', (event, args) => {
    const username = typeof args === 'object' ? args.username : args;
    const mode = typeof args === 'object' ? args.mode : 'server';
    if (setTikTokStreamer) setTikTokStreamer(username);
    currentTikTokUsername = username;

    // Limpiar ranking al conectar a un nuevo live
    if (widgetData) widgetData.topLikers = {};
    if (global.widgetIo) global.widgetIo.emit('reset_like_stats');

    if (mode === 'browser') {
        event.reply('tiktok-status', { connected: false, error: 'El modo Navegador (WebConnector) no está disponible en esta versión local.' });
        return;
    }

    if (activeTikTok) activeTikTok.disconnect();
    try {
        const options = {
            processInitialData: false,
            fetchRoomInfoOnConnect: true,
            enableExtendedGiftInfo: false,
            clientParams: {
                app_language: 'es',
                webcast_language: 'es',
                display_language: 'es',
                language: 'es',
                locale: 'es-ES',
                sys_region: 'ES'
            },
            requestOptions: {
                headers: {
                    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
                }
            },
            signProviderOptions: {
                host: globalSignConfig.signProviderHost,
                fallbackHosts: globalSignConfig.signProviderFallbackHosts
            }
        };
        let isChatConnected = false;
        activeTikTok = new TikTokLiveConnection(username, options);
        activeTikTok.connect().then(async state => {
            let avatar = '';
            try {
                const info = state.roomInfo;
                const owner = info.owner || (info.data && info.data.owner);
                if (owner) {
                    const thumb = owner.avatar_thumb || owner.avatar_medium || owner.avatar_large;
                    if (thumb) {
                        avatar = (thumb.url_list && thumb.url_list[0]) || thumb;
                    }
                }

                // [FIX] EXTRACCIÓN TOTAL DE LIKES DEL DIRECTO
                let totalLikes = 0;
                if (info && info.stats && info.stats.likeCount) totalLikes = info.stats.likeCount;
                else if (info && info.stats && info.stats.like_count) totalLikes = info.stats.like_count;
                else if (info && info.data && info.data.stats && info.data.stats.likeCount) totalLikes = info.data.stats.likeCount;
                else if (info && info.data && info.data.stats && info.data.stats.like_count) totalLikes = info.data.stats.like_count;

                if (totalLikes > 0) {
                    widgetData.sessionGlobalLikes = parseInt(totalLikes);
                    if (global.widgetIo) global.widgetIo.emit('data', { sessionGlobalLikes: widgetData.sessionGlobalLikes });
                    sendToAllWindows('sync-total-likes', parseInt(totalLikes));
                }
            } catch (e) { }

            event.reply('tiktok-status', { connected: true, roomId: state.roomId, avatar: avatar });
            sendToAllWindows('tiktok-connection-status', { type: 'connected', username: username, avatar: avatar });

            // Ignorar eventos iniciales (historial) durante 1.5 segundos
            setTimeout(() => { isChatConnected = true; }, 1500);

            // --- 1. INTENTO DE EXTRACCIÓN AUTOMÁTICA DE EMOTES (NUEVO) ---
            try {
                const roomInfo = state.roomInfo || activeTikTok.roomInfo;
                let foundEmotes = [];

                console.log('[TikTok] Buscando emotes en RoomInfo...');
                event.reply('tiktok-log', '[TikTok] Buscando emotes en información de la sala...');

                if (roomInfo) {
                    event.reply('tiktok-debug-roominfo', roomInfo);
                } else {
                    event.reply('tiktok-log', '[Debug] ¡ALERTA! roomInfo es null o undefined.');
                }

                // Buscar emotes en la información pública de la sala
                // FIX: Normalizar acceso a datos (wrapper vs data directa)
                const infoData = (roomInfo && roomInfo.data) ? roomInfo.data : roomInfo;

                if (infoData) {
                    if (Array.isArray(infoData.emotes)) foundEmotes = infoData.emotes;
                    else if (infoData.owner && Array.isArray(infoData.owner.emotes)) foundEmotes = infoData.owner.emotes;
                    else if (Array.isArray(infoData.emotes_set)) foundEmotes = infoData.emotes_set;
                    else if (Array.isArray(infoData.all_emoji_list)) foundEmotes = infoData.all_emoji_list;
                    else if (Array.isArray(infoData.emoji_list)) foundEmotes = infoData.emoji_list;
                    else if (Array.isArray(infoData.room_sticker_list)) foundEmotes = infoData.room_sticker_list;
                    else if (Array.isArray(infoData.sticker_list)) foundEmotes = infoData.sticker_list;
                    else if (Array.isArray(infoData.biz_sticker_list)) foundEmotes = infoData.biz_sticker_list;
                }

                if (foundEmotes.length > 0) {
                    const seen = new Set(inMemoryEmotes.map(e => String(e.id)));
                    let added = false;
                    foundEmotes.forEach(e => {
                        const eId = e.emote_id || e.id;
                        // Solo agregar si no existe
                        if (eId && !seen.has(String(eId))) {
                            const img = (e.image && e.image.url_list) ? e.image.url_list[0] : (e.icon && e.icon.url_list ? e.icon.url_list[0] : '');
                            inMemoryEmotes.push({
                                id: eId,
                                name: e.emote_name || e.name || 'Emote',
                                image: { url_list: [img] }
                            });
                            seen.add(String(eId));
                            added = true;
                        }
                    });

                    if (added) {
                        scheduleEmotesSave();
                        console.log(`[TikTok] Guardados ${foundEmotes.length} emotes encontrados al conectar.`);
                        event.reply('tiktok-log', `[TikTok] ¡Éxito! Se guardaron ${foundEmotes.length} emotes nuevos.`);
                    } else {
                        console.log(`[TikTok] Se encontraron ${foundEmotes.length} emotes (ya estaban guardados).`);
                        event.reply('tiktok-log', `[TikTok] Se detectaron ${foundEmotes.length} emotes (ya conocidos).`);
                    }
                } else {
                    console.log('[TikTok] No se encontraron emotes en la estructura roomInfo.');
                    event.reply('tiktok-log', '[TikTok] No se encontraron emotes en la información pública. Esperando uso en chat...');
                }
            } catch (e) {
                console.error("Error extrayendo emotes iniciales:", e);
                event.reply('tiktok-log', `[TikTok] Error buscando emotes: ${e.message}`);
            }

            // --- 2. ENVIAR EMOTES A LA INTERFAZ ---
            try {
                event.reply('getAvailableEmotes', { success: true, emotes: inMemoryEmotes });
            } catch (e) { }

            // Al conectar, descargamos los regalos disponibles para ESTA sesión específica.
            const getGiftsFn = activeTikTok.getAvailableGifts
                ? activeTikTok.getAvailableGifts.bind(activeTikTok)
                : (activeTikTok.fetchAvailableGifts ? activeTikTok.fetchAvailableGifts.bind(activeTikTok) : null);

            if (getGiftsFn) {
                getGiftsFn().then(giftList => {
                    inMemoryGifts = giftList;
                    scheduleGiftsSave();
                    widgetData.gifts = giftList; // Actualizar para OBS Widget en tiempo real
                    if (global.widgetIo) global.widgetIo.emit('update-gifts', giftList);
                    console.log(`[TikTok] Regalos actualizados para ${username} (${giftList.length} encontrados).`);
                    if (giftList.length > 0) {
                        const rose = giftList.find(g => String(g.id) === '5655');
                        console.log(`[TikTok Debug] Ejemplo regalo recibido al conectar: ${giftList[0].name} (ID: ${giftList[0].id})`);
                        if (rose) console.log(`[TikTok Debug] 🌹 Comprobación de idioma (ID 5655): ${rose.name}`);
                    }
                    event.reply('getAvailableGifts', { success: true, gifts: giftList });
                }).catch(e => console.warn("Error actualizando regalos al conectar:", e));
            }
            // --------------------------------------------------

        }).catch(err => {
            event.reply('tiktok-status', { connected: false, error: err.toString() });
        });

        activeTikTok.on('gift', (data) => {
            if (!isChatConnected) return;
            processAndBroadcastEvent('gift', data);
        });
        activeTikTok.on('chat', (data) => {
            if (!isChatConnected) return;
            processAndBroadcastEvent('chat', data);
        });
        activeTikTok.on('like', (data) => {
            if (isChatConnected) processAndBroadcastEvent('like', data);
        });
        activeTikTok.on('share', (data) => { if (isChatConnected) processAndBroadcastEvent('share', data); });
        activeTikTok.on('follow', (data) => { if (isChatConnected) processAndBroadcastEvent('follow', data); });
        activeTikTok.on('member', (data) => { if (isChatConnected) processAndBroadcastEvent('join', data); });
        activeTikTok.on('roomUser', (data) => { if (isChatConnected) processAndBroadcastEvent('roomUser', data); });
        activeTikTok.on('subscribe', (data) => { if (isChatConnected) processAndBroadcastEvent('subscribe', data); });
        activeTikTok.on('emote', (data) => {
            if (!isChatConnected) return;
            // Soporte para estructura WebcastEmoteChatMessage (array de emotes)
            if (data.emotes && Array.isArray(data.emotes)) {
                data.emotes.forEach(emote => {
                    const enrichedData = {
                        ...data,
                        emoteId: emote.emoteId,
                        emoteImageUrl: (emote.image && (emote.image.imageUrl || (emote.image.url_list && emote.image.url_list[0]) || (emote.image.url && emote.image.url[0]))) || emote.emoteImageUrl,
                        emoteName: `#${emote.emoteId}` // El evento no suele traer nombre
                    };
                    console.log('[TikTok] Emote recibido:', enrichedData.emoteId);
                    const newEmote = updateEmoteCache(enrichedData);
                    if (newEmote) sendToAllWindows('new-emote-discovered', newEmote);
                    sendToAllWindows('tiktok-event', { type: 'emote', data: enrichedData });
                    sendToMinecraft('emote', enrichedData);
                });
            } else {
                console.log('[TikTok] Emote recibido (Legacy):', data.emoteId);
                const newEmote = updateEmoteCache(data);
                if (newEmote) sendToAllWindows('new-emote-discovered', newEmote);
                sendToAllWindows('tiktok-event', { type: 'emote', data: data });
                sendToMinecraft('emote', data);
            }
        });
    } catch (e) {
        event.reply('tiktok-status', { connected: false, error: e.toString() });
        sendToAllWindows('tiktok-connection-status', { type: 'disconnected', reason: e.toString() });
    }
});

ipcMain.on('local-disconnect-tiktok', () => {
    if (activeTikTok) {
        activeTikTok.disconnect();
        activeTikTok = null;
        sendToAllWindows('tiktok-connection-status', { type: 'disconnected' });
    }

    // Limpiar ranking al desconectar manualmente
    if (widgetData) widgetData.topLikers = {};
    if (widgetData) { widgetData.topLikers = {}; widgetData.topGifters = {}; }
    if (global.widgetIo) global.widgetIo.emit('reset_like_stats');
});

ipcMain.on('getAvailableGifts', (event, username) => {
    // Optimización: Si ya estamos conectados, usar la conexión activa para asegurar la misma región
    if (activeTikTok && currentTikTokUsername === username && (activeTikTok.isConnected || activeTikTok.state === 'CONNECTED')) {
        console.log(`[TikTok] Solicitando regalos usando conexión activa para ${username}...`);
        const getGiftsFn = activeTikTok.getAvailableGifts
            ? activeTikTok.getAvailableGifts.bind(activeTikTok)
            : (activeTikTok.fetchAvailableGifts ? activeTikTok.fetchAvailableGifts.bind(activeTikTok) : null);

        if (getGiftsFn) {
            getGiftsFn().then(giftList => {
                try {
                    console.log(`[TikTok] ¡Éxito! Se obtuvieron ${giftList.length} regalos vía WebSocket.`);
                    if (giftList.length > 0) {
                        const rose = giftList.find(g => String(g.id) === '5655');
                        console.log(`[TikTok Debug] Regalo #1: ${giftList[0].name} (ID: ${giftList[0].id})`);
                        if (rose) console.log(`[TikTok Debug] 🌹 Comprobación de idioma (ID 5655): ${rose.name}`);
                    }
                    inMemoryGifts = giftList;
                    scheduleGiftsSave();
                    widgetData.gifts = giftList; // Actualizar para OBS Widget en tiempo real
                    if (global.widgetIo) global.widgetIo.emit('update-gifts', giftList);
                } catch (e) { }
                event.reply('getAvailableGifts', { success: true, gifts: giftList });
            }).catch(err => {
                event.reply('getAvailableGifts', { success: false, error: err.toString() });
            });
            return;
        }
    }

    const options = {
        processInitialData: false,
        fetchRoomInfoOnConnect: false,
        enableExtendedGiftInfo: true,
        clientParams: {
            app_language: 'es',
            webcast_language: 'es',
            display_language: 'es',
            language: 'es',
            locale: 'es-ES',
            sys_region: 'ES'
        },
        requestOptions: {
            headers: {
                'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
            }
        },
        signProviderOptions: {
            host: globalSignConfig.signProviderHost,
            fallbackHosts: globalSignConfig.signProviderFallbackHosts
        }
    };

    const connection = new TikTokLiveConnection(username, options);

    // Detectar la función correcta (algunas versiones usan fetchAvailableGifts)
    const getGiftsFn = connection.getAvailableGifts
        ? connection.getAvailableGifts.bind(connection)
        : (connection.fetchAvailableGifts ? connection.fetchAvailableGifts.bind(connection) : null);

    // Estrategia mejorada: Intentar obtener regalos vía HTTP (fetchRoomInfo) primero
    // Esto evita el error "Unexpected server response: 200" del WebSocket
    console.log(`[TikTok] Solicitando información de sala para obtener regalos de ${username}...`);
    connection.fetchRoomInfo().then(async (roomInfo) => {
        try {
            if (!getGiftsFn) throw new Error("Función getAvailableGifts no encontrada en la librería.");
            const giftList = await getGiftsFn();
            console.log(`[TikTok] ¡Éxito HTTP! Se obtuvieron ${giftList.length} regalos.`);
            if (giftList.length > 0) {
                const rose = giftList.find(g => String(g.id) === '5655');
                console.log(`[TikTok Debug] Regalo #1: ${giftList[0].name} (ID: ${giftList[0].id})`);
                if (rose) console.log(`[TikTok Debug] 🌹 Comprobación de idioma (ID 5655): ${rose.name}`);
            }
            try {
                inMemoryGifts = giftList;
                scheduleGiftsSave();
                widgetData.gifts = giftList; // Actualizar para OBS Widget en tiempo real
                if (global.widgetIo) global.widgetIo.emit('update-gifts', giftList);
                console.log('[TikTok] Regalos cacheados en memoria.');
            } catch (e) {
                console.error('Error saving gifts:', e);
            }
            event.reply('getAvailableGifts', { success: true, gifts: giftList });
        } catch (err) {
            console.warn("Fallo al obtener regalos vía HTTP, intentando conexión completa...", err);
            fallbackConnect();
        }
    }).catch(err => {
        console.warn("Fallo al obtener info de sala, intentando conexión completa...", err);
        fallbackConnect();
    });

    function fallbackConnect() {
        connection.connect().then(state => {
            if (!getGiftsFn) return; // No intentar si no existe la función
            getGiftsFn().then(giftList => {
                try {
                    inMemoryGifts = giftList;
                    scheduleGiftsSave();
                    widgetData.gifts = giftList; // Actualizar para OBS Widget en tiempo real
                    if (global.widgetIo) global.widgetIo.emit('update-gifts', giftList);
                } catch (e) { console.error('Error saving gifts:', e); }
                event.reply('getAvailableGifts', { success: true, gifts: giftList });
                connection.disconnect();
            }).catch(err => {
                event.reply('getAvailableGifts', { success: false, error: err.toString() });
                connection.disconnect();
            });
        }).catch(err => {
            event.reply('getAvailableGifts', { success: false, error: err.toString() });
        });
    }
});

ipcMain.on('getAvailableEmotes', (event) => {
    try {
        event.reply('getAvailableEmotes', { success: true, emotes: inMemoryEmotes });
    } catch (e) {
        event.reply('getAvailableEmotes', { success: false, error: e.toString() });
    }
});

ipcMain.on('manual-emote-added', (event, data) => {
    updateEmoteCache(data);
});

ipcMain.on('delete-emote', (event, emoteId) => {
    try {
        const initialLen = inMemoryEmotes.length;
        inMemoryEmotes = inMemoryEmotes.filter(e => String(e.id) !== String(emoteId));
        if (inMemoryEmotes.length < initialLen) {
            scheduleEmotesSave();
        }
    } catch (e) { console.error("Error deleting emote:", e); }
});

// --- OBS WIDGET SERVER (Puerto 3011) ---
let widgetData = {
    templates: [], activeTemplateId: null, gifts: [], viewerCount: 0,
    sessionGlobalLikes: 0, sessionGlobalCoins: 0, winCounter: 0,
    extensible: { time: 0, active: false, label: "EXTENSIBLE" },
    goals: {
        likes: { target: 1000, label: "Likes Goal" },
        coins: { target: 1000, label: "Gift Goal" }
    }
};

// --- [FIX] PERSISTENCIA DE ESTADO DEL WIDGET (ASÍNCRONA Y DEBOUNCED) ---
// Evita bloquear el hilo principal durante streams intensos
const widgetStatePath = path.join(app.getPath('userData'), 'widget_state.json');
let widgetStateSaveTimeout = null;

function saveWidgetState(immediate = false) {
    const doSave = () => {
        try {
            const state = {
                activeTemplateId: widgetData.activeTemplateId,
                sessionGlobalLikes: widgetData.sessionGlobalLikes,
                sessionGlobalCoins: widgetData.sessionGlobalCoins,
                winCounter: widgetData.winCounter,
                extensible: widgetData.extensible,
                goals: widgetData.goals
            };
            fs.promises.writeFile(widgetStatePath, JSON.stringify(state, null, 2), 'utf8')
                .catch(e => console.error('Error guardando widget state asíncrono:', e));
        } catch (e) { console.error('Error saving widget state:', e); }
    };

    if (immediate) {
        if (widgetStateSaveTimeout) { clearTimeout(widgetStateSaveTimeout); widgetStateSaveTimeout = null; }
        doSave();
    } else {
        if (widgetStateSaveTimeout) return;
        widgetStateSaveTimeout = setTimeout(() => {
            widgetStateSaveTimeout = null;
            doSave();
        }, 5000);
    }
}

try {
    // 1. Cargar plantillas al inicio
    const tplPath = path.join(app.getPath('userData'), 'templates.json');
    if (fs.existsSync(tplPath)) {
        widgetData.templates = JSON.parse(fs.readFileSync(tplPath, 'utf8'));
    } else {
        // --- CARGAR PLANTILLAS POR DEFECTO DESDE src/plantillas ---
        const defaultsDir = path.join(__dirname, 'plantillas');
        let defaultTemplates = [];
        if (fs.existsSync(defaultsDir)) {
            const files = fs.readdirSync(defaultsDir);
            for (const file of files) {
                if (file.toLowerCase().endsWith('.json')) {
                    try {
                        const content = fs.readFileSync(path.join(defaultsDir, file), 'utf8');
                        const parsed = JSON.parse(content);
                        if (Array.isArray(parsed)) defaultTemplates.push(...parsed);
                        else defaultTemplates.push(parsed);
                    } catch (e) { console.error(`[Templates] Error parseando ${file}:`, e); }
                }
            }
        }

        if (defaultTemplates.length > 0) {
            widgetData.templates = defaultTemplates;
            fs.writeFileSync(tplPath, JSON.stringify(defaultTemplates, null, 2));
            console.log(`[Sistema] Creado archivo templates.json inicial con ${defaultTemplates.length} plantillas predeterminadas.`);
        }
    }

    // 2. Cargar estado activo (ID de plantilla, metas, contadores)
    if (fs.existsSync(widgetStatePath)) {
        const s = JSON.parse(fs.readFileSync(widgetStatePath, 'utf8'));
        if (s.activeTemplateId) widgetData.activeTemplateId = s.activeTemplateId;
        if (s.goals) widgetData.goals = { ...widgetData.goals, ...s.goals };
        if (s.sessionGlobalLikes !== undefined) widgetData.sessionGlobalLikes = s.sessionGlobalLikes;
        if (s.sessionGlobalCoins !== undefined) widgetData.sessionGlobalCoins = s.sessionGlobalCoins;
        if (s.winCounter !== undefined) widgetData.winCounter = s.winCounter;
        if (s.viewerCount !== undefined) widgetData.viewerCount = s.viewerCount;
        if (s.extensible) widgetData.extensible = s.extensible;
    }
} catch (e) { console.error('Error loading widget state:', e); }

// Forzar que el ranking de likes comience vacío cada vez que se abre la app
widgetData.topLikers = {};

// [FIX] Auto-activar primera plantilla si no hay ninguna seleccionada (evita widgets vacíos)
if (!widgetData.activeTemplateId && widgetData.templates && widgetData.templates.length > 0) {
    widgetData.activeTemplateId = widgetData.templates[0].id;
}

// Cargar regalos iniciales para el widget
try {
    if (inMemoryGifts && inMemoryGifts.length > 0) {
        widgetData.gifts = inMemoryGifts;
    } else if (defaultGiftCatalog && defaultGiftCatalog.length > 0) {
        widgetData.gifts = defaultGiftCatalog;
    }
} catch (e) { }

// Recibir actualizaciones de la interfaz
ipcMain.on('update-widget-data', (event, data) => {
    // --- Eventos directos para el WIDGET DEL TTS / MULTI-CHAT ---
    if (data.event && global.widgetIo) {
        global.widgetIo.emit(data.event, data.data);
        return;
    }

    // [OPTIMIZACIÓN RED/CPU] Si solo es un tick de extensible, emitir canal liviano sin retransmitir megabytes de templates
    if (data.onlyExtensible && data.extensible) {
        widgetData.extensible = data.extensible;
        if (global.widgetIo) global.widgetIo.emit('extensible_data', data.extensible);
        saveWidgetState(false);
        return;
    }

    if (data.templates) widgetData.templates = data.templates;
    if (data.activeTemplateId) widgetData.activeTemplateId = data.activeTemplateId;
    if (data.sessionGlobalLikes !== undefined) widgetData.sessionGlobalLikes = data.sessionGlobalLikes;
    if (data.sessionGlobalCoins !== undefined) widgetData.sessionGlobalCoins = data.sessionGlobalCoins;
    if (data.sessionGlobalViewers !== undefined) widgetData.viewerCount = data.sessionGlobalViewers;
    if (data.winCounter !== undefined) widgetData.winCounter = data.winCounter;
    if (data.extensible) widgetData.extensible = data.extensible;
    if (data.goals) widgetData.goals = { ...widgetData.goals, ...data.goals };

    // Actualizar estado en disco de forma diferida (no bloqueante)
    if (data.saveToDisk !== false) {
        saveWidgetState(false);
    }
    if (global.widgetIo) {
        global.widgetIo.emit('data', widgetData);
        if (data.extensible) {
            global.widgetIo.emit('extensible_data', data.extensible);
        }
    }
});

ipcMain.on('update-goals', (event, newGoals) => {
    widgetData.goals = { ...widgetData.goals, ...newGoals };
    saveWidgetState(); // [FIX] Guardar cambios
    if (global.widgetIo) {
        global.widgetIo.emit('data', widgetData); // Emitir a los overlays para actualización en vivo
        global.widgetIo.emit('reload_overlays'); // Forzar recarga visual para ajustar límites en el canvas
    }
});

ipcMain.on('test-like-widget', () => {
    let totalAdded = 0;
    let totalGifts = 0;
    if (global.widgetIo) {
        const demoUsers = [
            { userId: 'u1', nickname: 'Alex_Gamer', profilePictureUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alex' },
            { userId: 'u2', nickname: 'Maria_Vibes', profilePictureUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Maria' },
            { userId: 'u3', nickname: 'JohnDoe99', profilePictureUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=John' },
            { userId: 'u4', nickname: 'Luna_Sky', profilePictureUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Luna' },
            { userId: 'u5', nickname: 'PixelMaster', profilePictureUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Pixel' }
        ];

        // Enviar todos los usuarios para llenar el ranking
        demoUsers.forEach(u => {
            const likeCount = Math.floor(Math.random() * 50) + 10;
            const coinsCount = Math.floor(Math.random() * 500) + 10;
            totalAdded += likeCount;
            totalGifts += coinsCount;

            if (!widgetData.topLikers) widgetData.topLikers = {};
            if (!widgetData.topLikers[u.userId]) {
                widgetData.topLikers[u.userId] = { uid: u.userId, nickname: u.nickname, avatar: u.profilePictureUrl, count: 0 };
            }
            widgetData.topLikers[u.userId].count += likeCount;

            if (!widgetData.topGifters) widgetData.topGifters = {};
            if (!widgetData.topGifters[u.userId]) {
                widgetData.topGifters[u.userId] = { uid: u.userId, nickname: u.nickname, avatar: u.profilePictureUrl, count: 0 };
            }
            widgetData.topGifters[u.userId].count += coinsCount;

            global.widgetIo.emit('like_event', {
                userId: u.userId,
                nickname: u.nickname,
                profilePictureUrl: u.profilePictureUrl,
                likeCount: likeCount
            });

            global.widgetIo.emit('gift_event', {
                userId: u.userId,
                nickname: u.nickname,
                profilePictureUrl: u.profilePictureUrl,
                calculatedCoins: coinsCount
            });
        });
    }
    widgetData.sessionGlobalLikes += totalAdded;
    widgetData.sessionGlobalCoins += 150; // Sumar regalos para que se mueva la barra de meta
    widgetData.sessionGlobalCoins += totalGifts; // Sumar regalos para que se mueva la barra de meta
    saveWidgetState();
    if (global.widgetIo) global.widgetIo.emit('data', widgetData);
});

ipcMain.on('reset-like-stats', () => {
    if (global.widgetIo) global.widgetIo.emit('reset_like_stats');
});

ipcMain.on('reset-likes-progress', () => {
    widgetData.sessionGlobalLikes = 0;
    saveWidgetState();
    if (global.widgetIo) {
        global.widgetIo.emit('data', widgetData);
        global.widgetIo.emit('reload_overlays');
    }
    sendToAllWindows('reset-session-counters', 'likes');
});

ipcMain.on('reset-coins-progress', () => {
    widgetData.sessionGlobalCoins = 0;
    saveWidgetState();
    if (global.widgetIo) {
        global.widgetIo.emit('data', widgetData);
        global.widgetIo.emit('reload_overlays');
    }
    sendToAllWindows('reset-session-counters', 'coins');
});

// --- CANVAS LAYOUT STATE ---
let canvasState = {
    activeId: 'default',
    activeResolution: '16/9',
    profiles: [
        { id: 'default', name: 'Perfil Principal', layouts: { '16/9': [], '9/16': [] } }
    ]
};

try {
    const layoutPath = path.join(app.getPath('userData'), 'canvas_layout.json');
    if (fs.existsSync(layoutPath)) {
        const parsed = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
        if (parsed.profiles && Array.isArray(parsed.profiles)) {
            // Ya está en el formato nuevo
            canvasState = parsed;
        } else if (Array.isArray(parsed)) {
            // Migración desde Array muy antiguo
            canvasState.profiles[0].layouts['16/9'] = parsed;
        } else {
            // Migración desde formato de objeto de resoluciones
            canvasState.profiles[0].layouts['16/9'] = parsed['16/9'] || [];
            canvasState.profiles[0].layouts['9/16'] = parsed['9/16'] || [];
        }

        if (!canvasState.activeResolution) {
            canvasState.activeResolution = '16/9';
        }
    }
} catch (e) { }

ipcMain.handle('get-canvas-layout', () => {
    const active = canvasState.profiles.find(p => p.id === canvasState.activeId) || canvasState.profiles[0];
    return active.layouts || { '16/9': [], '9/16': [] };
});

ipcMain.on('save-canvas-layout', (event, layout) => {
    const active = canvasState.profiles.find(p => p.id === canvasState.activeId);
    if (active) {
        active.layouts = layout;
        saveCanvasProfilesToDisk();
    }
});

function saveCanvasProfilesToDisk() {
    try {
        const layoutPath = path.join(app.getPath('userData'), 'canvas_layout.json');
        fs.writeFileSync(layoutPath, JSON.stringify(canvasState, null, 2));
    } catch (e) { }
}

ipcMain.handle('get-canvas-profiles-state', () => canvasState);

ipcMain.on('save-canvas-profiles-state', (event, newState) => {
    // [FIX] Proteger la resolución actual guardada en el backend.
    // Evita que el frontend la borre si envía un estado local desactualizado al mover/guardar widgets.
    if (newState && canvasState.activeResolution) {
        newState.activeResolution = canvasState.activeResolution;
    }
    canvasState = newState;
    saveCanvasProfilesToDisk();
    sendToAllWindows('canvas-profile-changed');
});

// --- MEDIA OVERLAY EVENTS ---
let lastMediaEvent = null;
ipcMain.on('dispatch-media-event', (event, data) => {
    const eventData = { id: Date.now(), ...data };

    // --- FIX: Re-enriquecer datos para Alertas (Safety Net) ---
    // Si la UI envía el evento sin nombre de regalo (por caché vacío), lo rellenamos aquí.
    // Esto asegura que la ventana de alertas siempre tenga datos, igual que el editor.
    if (data.giftId) {
        let gName = eventData.giftName;
        let dCount = eventData.diamondCount || 0;
        let gFile = eventData.file;

        // FIX: Limpiar valores inválidos (strings "undefined"/"null") que pueden venir del renderer
        if (gName === 'undefined' || gName === 'null') gName = null;
        if (gFile === 'undefined' || gFile === 'null') gFile = null;
        if (dCount === 'undefined' || dCount === 'null') dCount = 0;

        // 1. Buscar en caché de regalos guardados (en memoria)
        try {
            const cachedGift = inMemoryGifts.find(g => String(g.id) === String(data.giftId));
            if (cachedGift) {
                if (!gName) gName = cachedGift.name;
                if (!dCount) dCount = cachedGift.diamond_count;
                // FIX: Si falta la imagen (file), usar la del regalo
                if ((!gFile || gFile === '') && cachedGift.image && cachedGift.image.url_list && cachedGift.image.url_list.length > 0) {
                    gFile = cachedGift.image.url_list[0];
                }
            }
        } catch (e) { }

        // 2. Buscar en catálogo por defecto (giftcatalog.json)
        if ((!gName || !dCount || !gFile || gFile === '') && defaultGiftCatalog.length > 0) {
            const defGift = defaultGiftCatalog.find(g => String(g.id) === String(data.giftId));
            if (defGift) {
                if (!gName) gName = defGift.name;
                if (!dCount) dCount = defGift.diamond_count;
                if ((!gFile || gFile === '') && defGift.image && defGift.image.url_list && defGift.image.url_list.length > 0) gFile = defGift.image.url_list[0];
            }
        }

        if (gName) eventData.giftName = gName;
        if (dCount) eventData.diamondCount = dCount;
        if (gFile) eventData.file = gFile;

        // Fallback final para asegurar que siempre tenga nombre
        if (!eventData.giftName) eventData.giftName = `Gift ${data.giftId}`;
    }

    lastMediaEvent = eventData;
    if (global.widgetIo) {
        global.widgetIo.emit('media-event', eventData);
    }
});

let lastCurrentSongData = null;
ipcMain.on('update-current-song', (event, data) => {
    lastCurrentSongData = data;
    if (global.widgetIo) {
        global.widgetIo.emit('music-update', data);
    }
});

const htmlFileCache = new Map();

const obsServer = http.createServer((req, res) => {
    // Permitir que socket.io maneje sus propias peticiones
    if (req.url.startsWith('/socket.io/')) return;

    res.setHeader('Access-Control-Allow-Origin', '*');
    const reqUrl = new URL(req.url, 'http://localhost:3011');

    if (reqUrl.pathname === '/local-file') {
        const filePath = reqUrl.searchParams.get('path');
        if (filePath) {
            try {
                let cleanPath = filePath;
                if (cleanPath.startsWith('file:')) {
                    let decodedPath = null;
                    try {
                        decodedPath = require('url').fileURLToPath(cleanPath);
                    } catch (e) { }

                    // Si fileURLToPath falla o el archivo no existe (ej. caracteres especiales), usar fallback
                    if (!decodedPath || !fs.existsSync(decodedPath)) {
                        let manualPath = cleanPath.replace(/^file:\/\//, '');
                        if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(manualPath)) {
                            manualPath = manualPath.substring(1);
                        }
                        manualPath = decodeURIComponent(manualPath);
                        cleanPath = fs.existsSync(manualPath) ? manualPath : (decodedPath || manualPath);
                    } else {
                        cleanPath = decodedPath;
                    }
                } else {
                    cleanPath = decodeURIComponent(cleanPath);
                }

                // Normalizar ruta para evitar path traversal
                cleanPath = path.normalize(cleanPath);

                const allowedMediaExts = {
                    '.png': 'image/png',
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.gif': 'image/gif',
                    '.webp': 'image/webp',
                    '.svg': 'image/svg+xml',
                    '.mp3': 'audio/mpeg',
                    '.wav': 'audio/wav',
                    '.ogg': 'audio/ogg',
                    '.mp4': 'video/mp4',
                    '.webm': 'video/webm'
                };
                const ext = path.extname(cleanPath).toLowerCase();

                // Seguridad: solo servir extensiones multimedia permitidas y verificar existencia real
                if (allowedMediaExts[ext] && fs.existsSync(cleanPath) && fs.statSync(cleanPath).isFile()) {
                    res.writeHead(200, { 'Content-Type': allowedMediaExts[ext] });
                    fs.createReadStream(cleanPath).pipe(res);
                    return;
                } else {
                    res.writeHead(403, { 'Content-Type': 'text/plain' });
                    res.end('Forbidden: Invalid file type or file not found');
                    return;
                }
            } catch (e) { console.error('Error serving local file:', e); }
        }
        res.writeHead(404);
        res.end();
        return;
    }

    const serveHtmlFile = (filePath, res) => {
        if (htmlFileCache.has(filePath)) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(htmlFileCache.get(filePath));
            return;
        }
        fs.readFile(path.join(__dirname, filePath), (err, content) => {
            if (err) {
                res.writeHead(500);
                res.end(`Error loading ${filePath}`);
            } else {
                htmlFileCache.set(filePath, content);
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(content);
            }
        });
    };

    const routes = {
        '/': 'gift-overlay.html',
        '/index.html': 'gift-overlay.html',
        '/gift-overlay.html': 'gift-overlay.html',
        '/gift-overlay': 'gift-overlay.html',
        '/likes-goal-overlay.html': 'likes-goal-overlay.html',
        '/likes-goal-overlay': 'likes-goal-overlay.html',
        '/gift-goal-overlay.html': 'gift-goal-overlay.html',
        '/gift-goal-overlay': 'gift-goal-overlay.html',
        '/extensible-overlay.html': 'extensible-overlay.html',
        '/extensible-overlay': 'extensible-overlay.html',
        '/overlay-canvas.html': 'overlay-canvas.html',
        '/overlay-canvas': 'overlay-canvas.html',
        '/alerts.html': 'alerts.html',
        '/alerts': 'alerts.html',
        '/top-likes-overlay.html': 'top-likes-overlay.html',
        '/top-likes-overlay': 'top-likes-overlay.html',
        '/top-gifter-overlay.html': 'top-gifter-overlay.html',
        '/top-gifter-overlay': 'top-gifter-overlay.html',
        '/chat-widget.html': 'chat-widget.html',
        '/chat-widget': 'chat-widget.html',
        '/multichat.html': 'multichat.html',
        '/overlay-musica.html': 'overlay-musica.html',
        '/overlay-musica': 'overlay-musica.html',
        '/widget.html': 'overlay-musica.html',
        '/widget': 'overlay-musica.html'
    };

    if (routes[reqUrl.pathname]) {
        serveHtmlFile(routes[reqUrl.pathname], res);
    } else if (reqUrl.pathname === '/media-event') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(lastMediaEvent));
    } else if (reqUrl.pathname === '/data') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(widgetData));
    } else if (reqUrl.pathname === '/canvas-layout') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const active = canvasState.profiles.find(p => p.id === canvasState.activeId) || canvasState.profiles[0];
        res.end(JSON.stringify(active.layouts || { '16/9': [], '9/16': [] }));
        return;
    } else {
        try {
            const relativePath = reqUrl.pathname.startsWith('/') ? reqUrl.pathname.substring(1) : reqUrl.pathname;
            const filePath = path.join(__dirname, relativePath);
            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                const ext = path.extname(filePath).toLowerCase();
                if (ext === '.js' || ext === '.css' || ext === '.png' || ext === '.jpg') {
                    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' }[ext] || 'text/plain';
                    res.writeHead(200, { 'Content-Type': mime });
                    fs.createReadStream(filePath).pipe(res);
                    return;
                }
            }
        } catch (e) { console.error('Error serving static file:', e); }

        res.writeHead(404);
        res.end('Not found');
    }
});

obsServer.on('error', (e) => {
    console.error('OBS Widget Server Error (Port 3011):', e.message);
    if (e.code === 'EADDRINUSE') {
        console.log('[Main] Puerto 3011 ocupado. Reintentando en 2 segundos...');
        setTimeout(() => {
            try { obsServer.close(); } catch(err) {}
            obsServer.listen(3011, '127.0.0.1', () => {
                console.log('✅ OBS Widget Server recuperado en http://localhost:3011');
            });
        }, 2000);
    }
});

if (Server) {
    const io = new Server(obsServer, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });
    global.widgetIo = io;

    // --- CONEXIÓN CLOUD RELAY (RENDER) ---
    // Desactivado: la app y OBS se usan en la misma PC. Los widgets se conectan directamente
    // a http://localhost:3011 vía token-bridge.js, ahorrando 100% del ancho de banda y CPU en Render.
    const ENABLE_CLOUD_RELAY = false;
    const cloudConfigPath = path.join(app.getPath('userData'), 'livemu_cloud_config.json');
    let cloudSocket = null;
    let cloudToken = '';
    let cloudServerUrl = 'https://livemu-overlays.onrender.com';

    function generateUniqueToken() {
        return 'live_' + crypto.randomBytes(4).toString('hex');
    }

    try {
        if (fs.existsSync(cloudConfigPath)) {
            const cfg = JSON.parse(fs.readFileSync(cloudConfigPath, 'utf8'));
            if (cfg.cloudToken) cloudToken = cfg.cloudToken;
            if (cfg.cloudServerUrl) cloudServerUrl = cfg.cloudServerUrl;
        }
    } catch (e) { }

    if (!cloudToken || cloudToken === 'hinu') {
        cloudToken = generateUniqueToken();
        try {
            fs.writeFileSync(cloudConfigPath, JSON.stringify({ cloudToken, cloudServerUrl }, null, 2));
        } catch (e) { }
    }

    function initCloudSocket() {
        if (!ENABLE_CLOUD_RELAY) return;
        if (cloudSocket) {
            try { cloudSocket.disconnect(); } catch (e) { }
        }
        try {
            const { io: ClientIo } = require('socket.io-client');
            cloudSocket = ClientIo(cloudServerUrl, {
                query: { token: cloudToken },
                reconnection: true,
                reconnectionAttempts: Infinity,
                reconnectionDelay: 3000,
                transports: ['polling', 'websocket']
            });
        } catch (err) {
            console.warn('[Cloud Relay] No se pudo iniciar el cliente Cloud:', err.message);
        }
    }

    initCloudSocket();

    // IPC Handlers para consultar y regenerar token desde la interfaz
    ipcMain.handle('get-cloud-config', () => {
        return { cloudToken, cloudServerUrl };
    });

    ipcMain.handle('regenerate-cloud-token', () => {
        cloudToken = generateUniqueToken();
        try {
            fs.writeFileSync(cloudConfigPath, JSON.stringify({ cloudToken, cloudServerUrl }, null, 2));
        } catch (e) { }
        initCloudSocket();
        return { cloudToken, cloudServerUrl };
    });

    let lastTwitchStatusCached = null;
    let lastTwitchBadgesCached = null;

    // Conexión local pura: se emiten los eventos solo al socket local (localhost:3011)
    const originalEmit = io.emit.bind(io);
    io.emit = function (event, ...args) {
        originalEmit(event, ...args);
        if (event === 'twitch-connection-status') lastTwitchStatusCached = args[0];
        if (event === 'twitch-badges') lastTwitchBadgesCached = args[0];
    };
    let activeWidgetClients = 0;
    io.on('connection', (socket) => {
        activeWidgetClients++;
        const origin = socket.handshake.headers.origin || 'Local/OBS Directo';
        if (activeWidgetClients <= 3 || activeWidgetClients % 10 === 0) {
            console.log(`[Widget] Cliente conectado desde [${origin}]. (Conexiones activas: ${activeWidgetClients})`);
        }

        socket.on('disconnect', () => {
            activeWidgetClients = Math.max(0, activeWidgetClients - 1);
        });

        // [FIX] Enviar datos inmediatos al conectar (Unicast)
        socket.emit('data', widgetData);
        socket.emit('update-gifts', widgetData.gifts || []);

        // Escuchar cuando el widget pide recuperar la información
        socket.on('get_data', () => {
            if (widgetData.topLikers) {
                socket.emit('sync_likers', Object.values(widgetData.topLikers));
            }
            if (widgetData.topGifters) {
                socket.emit('sync_gifters', Object.values(widgetData.topGifters));
            }
        });

        socket.on('tts-control', (data) => {
            sendToAllWindows('tts-control', data);
        });
    });
}

obsServer.listen(3011, '127.0.0.1', () => {
    console.log('OBS Widget Server running on http://localhost:3011');
});

// --- MINECRAFT SERVER LOCAL CONTROL (Mejorado) ---

ipcMain.on('local-start-minecraft', (event) => {
    let proc = getMinecraftServerProcess();

    // Limpieza: Si el proceso existe pero ya terminó (zombie), forzar limpieza para permitir reiniciar
    if (proc && typeof proc.exitCode === 'number') {
        try { killMinecraftServerProcess(); } catch (e) { }
        proc = null;
    }

    if (proc) {
        event.reply('minecraft-status', { running: true, message: 'El servidor ya está corriendo.' });
        return;
    }

    // Asegurar que la configuración esté cargada (por si se perdió o no cargó al inicio)
    if (!global.minecraftServerPath) {
        try {
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                if (config.minecraftServerPath) global.minecraftServerPath = config.minecraftServerPath;
            }
        } catch (e) { }
    }

    if (!global.minecraftServerPath) {
        event.reply('minecraft-status', { running: false, error: 'No hay archivo de servidor seleccionado. Ve a la configuración principal para seleccionarlo.' });
        return;
    }

    // Creamos un objeto evento simulado para capturar los logs del proceso de Minecraft
    // y redirigirlos a la ventana local
    const mockEvent = {
        sender: {
            send: (channel, data) => {
                if (channel === 'minecraftServerOutput') {
                    sendToAllWindows('minecraft-log', data);
                }
                if (channel === 'checkMinecraftServerStatus') {
                    sendToAllWindows('minecraft-status', data);
                }
            }
        }
    };

    try {
        runMinecraftServer(global.minecraftServerPath, global.minecraftServerXmx || '4G', global.minecraftServerXms || '2G', mockEvent)
            .then(() => { })
            .catch(err => {
                sendToAllWindows('minecraft-status', { running: false, error: err.toString() });
            });

        event.reply('minecraft-status', { running: true, message: 'Iniciando servidor...' });
    } catch (e) {
        event.reply('minecraft-status', { running: false, error: e.toString() });
    }
});

ipcMain.on('local-stop-minecraft', (event) => {
    const proc = getMinecraftServerProcess();
    if (proc && proc.stdin && !proc.killed && typeof proc.exitCode !== 'number') {
        try {
            console.log('Enviando comando stop al servidor...');
            proc.stdin.write('stop\n');
            event.reply('minecraft-status', { running: true, message: 'Deteniendo servidor (Guardando mundo)...' });

            // Forzar cierre si tarda mucho (15s)
            setTimeout(() => {
                const p = getMinecraftServerProcess();
                if (p && !p.killed && typeof p.exitCode !== 'number') {
                    try { killMinecraftServerProcess(); } catch (e) { }
                    event.reply('minecraft-status', { running: false, message: 'Servidor detenido (Forzado).' });
                }
            }, 15000);
            return;
        } catch (e) { console.error('Error sending stop:', e); }
    }

    try {
        killMinecraftServerProcess();
    } catch (e) { console.error('Error stopping server:', e); }
    event.reply('minecraft-status', { running: false, message: 'Deteniendo servidor...' });
});

ipcMain.on('local-check-minecraft-status', (event) => {
    const proc = getMinecraftServerProcess();
    event.reply('minecraft-status', { running: !!proc });
});

ipcMain.handle('local-pick-server-jar', async (event) => {
    const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'Minecraft Server Jar', extensions: ['jar'] }],
        title: 'Selecciona el archivo .jar del servidor'
    });
    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

ipcMain.handle('local-get-server-profiles', (event) => {
    // Migración: Si no hay perfiles pero hay una config global, crear perfil default
    if ((!global.serverProfiles || global.serverProfiles.length === 0) && global.minecraftServerPath) {
        const defaultProfile = {
            id: Date.now(),
            name: "Default Server",
            path: global.minecraftServerPath,
            xmx: global.minecraftServerXmx,
            xms: global.minecraftServerXms,
            args: global.javaArgs
        };
        global.serverProfiles = [defaultProfile];
        global.activeProfileId = defaultProfile.id;
    }
    return { profiles: global.serverProfiles || [], activeId: global.activeProfileId };
});

ipcMain.on('local-save-server-profiles', (event, data) => {
    global.serverProfiles = data.profiles;
    global.activeProfileId = data.activeId;

    // Actualizar variables globales activas
    const active = global.serverProfiles.find(p => String(p.id) === String(global.activeProfileId));
    if (active) {
        global.minecraftServerPath = active.path;
        global.minecraftServerXmx = active.xmx;
        global.minecraftServerXms = active.xms;
        global.javaArgs = active.args;
    }

    try {
        const currentConfig = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
        currentConfig.serverProfiles = global.serverProfiles;
        currentConfig.activeProfileId = global.activeProfileId;
        // Guardar también en formato legacy por compatibilidad
        currentConfig.minecraftServerPath = global.minecraftServerPath;
        currentConfig.minecraftServerXmx = global.minecraftServerXmx;
        currentConfig.minecraftServerXms = global.minecraftServerXms;
        currentConfig.javaArgs = global.javaArgs;

        fs.writeFileSync(configPath, JSON.stringify(currentConfig, null, 2));
    } catch (e) { console.error('Error saving server profiles:', e); }

    event.reply('minecraft-status', { running: false, message: 'Perfiles de servidor actualizados.' });
});

ipcMain.handle('local-create-server-folder', async (event, serverName, existingPath) => {
    try {
        let serverDir;
        if (existingPath && existingPath.trim() !== '' && fs.existsSync(path.dirname(existingPath))) {
            serverDir = path.dirname(existingPath); // Usar carpeta existente si ya hay ruta
        } else {
            const serversDir = path.join(app.getPath('userData'), 'minecraft_servers');
            if (!fs.existsSync(serversDir)) fs.mkdirSync(serversDir, { recursive: true });

            const safeName = (serverName || 'Server').replace(/[^a-z0-9_-]/gi, '_');
            serverDir = path.join(serversDir, safeName);

            // Evitar duplicados añadiendo un número al final solo si es nuevo
            let counter = 1;
            let baseDir = serverDir;
            while (fs.existsSync(serverDir)) {
                serverDir = `${baseDir}_${counter}`;
                counter++;
            }

            fs.mkdirSync(serverDir, { recursive: true });
        }

        // Buscar server.jar incluido en la app (Assets)
        const possiblePaths = [
            path.join(process.resourcesPath, 'server.jar'),
            path.join(__dirname, 'assets', 'server.jar'),
            path.join(__dirname, '..', 'assets', 'server.jar')
        ];

        let sourceJar = possiblePaths.find(p => fs.existsSync(p));
        const destJar = path.join(serverDir, 'server.jar');

        let jarFound = false;
        if (sourceJar) {
            fs.copyFileSync(sourceJar, destJar);
            jarFound = true;
        } else {
            // Intentar descargar si no existe localmente
            try {
                const downloadUrl = 'https://github.com/lockzz1/LiveMu/releases/download/v.1.1.0/server.jar';
                console.log(`[Main] Downloading server.jar from ${downloadUrl}...`);
                const response = await fetch(downloadUrl, {
                    redirect: 'follow',
                    headers: { 'User-Agent': 'LiveMu-App' }
                });
                if (response.ok) {
                    const buffer = await response.arrayBuffer();
                    fs.writeFileSync(destJar, Buffer.from(buffer));
                    jarFound = true;
                    console.log('[Main] server.jar downloaded successfully.');
                } else {
                    console.error(`[Main] Download failed: ${response.status} ${response.statusText}`);
                }
            } catch (e) { console.error('Error downloading server.jar:', e); }
        }

        // Crear eula.txt automáticamente
        fs.writeFileSync(path.join(serverDir, 'eula.txt'), 'eula=true\n');

        return { success: true, path: destJar, dir: serverDir, jarFound: jarFound };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('local-delete-server-folder', async (event, jarPath) => {
    try {
        if (!jarPath) return { success: false, error: "No path provided" };

        const folderPath = path.dirname(jarPath);
        const serversDir = path.join(app.getPath('userData'), 'minecraft_servers');

        // Seguridad: Solo permitir borrar carpetas DENTRO de minecraft_servers
        if (folderPath.startsWith(serversDir) && folderPath !== serversDir) {
            if (fs.existsSync(folderPath)) {
                fs.rmSync(folderPath, { recursive: true, force: true });
                return { success: true };
            }
        }
        return { success: false, error: "Ruta no válida o carpeta no encontrada." };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('local-get-server-config', (event) => {
    return {
        path: global.minecraftServerPath || '',
        xmx: global.minecraftServerXmx || '4G',
        xms: global.minecraftServerXms || '2G',
        args: global.javaArgs || ''
    };
});

ipcMain.on('local-save-server-config', (event, data) => {
    global.minecraftServerPath = data.path;
    global.minecraftServerXmx = data.xmx;
    global.minecraftServerXms = data.xms;
    global.javaArgs = data.args;

    try {
        const config = {
            minecraftServerPath: global.minecraftServerPath,
            minecraftServerXmx: global.minecraftServerXmx,
            minecraftServerXms: global.minecraftServerXms,
            javaArgs: global.javaArgs
        };
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (e) { console.error('Error saving config:', e); }

    event.reply('minecraft-status', { running: false, message: 'Configuración guardada.' });
});

// --- GESTIÓN DE PLUGINS DE MINECRAFT ---
ipcMain.handle('local-get-server-plugins', (event, serverJarPath) => {
    if (!serverJarPath) return { plugins: [] };
    const pluginsDir = path.join(path.dirname(serverJarPath), 'plugins');
    if (!fs.existsSync(pluginsDir)) return { plugins: [] };
    try {
        const files = fs.readdirSync(pluginsDir).filter(f => f.toLowerCase().endsWith('.jar'));
        return { plugins: files };
    } catch (e) { return { error: e.message, plugins: [] }; }
});

ipcMain.handle('local-get-default-plugins', () => {
    // Busca en la carpeta src/plugins (crea esta carpeta y mete tus .jar por defecto ahí)
    const defDir = path.join(__dirname, 'plugins');
    if (!fs.existsSync(defDir)) return { plugins: [] };
    try {
        const files = fs.readdirSync(defDir).filter(f => f.toLowerCase().endsWith('.jar'));
        return { plugins: files.map(f => ({ name: f, path: path.join(defDir, f) })) };
    } catch (e) { return { plugins: [] }; }
});

ipcMain.handle('local-install-plugin', (event, serverJarPath, pluginSourcePath) => {
    if (!serverJarPath || !pluginSourcePath) return { success: false, error: 'Rutas inválidas' };
    const pluginsDir = path.join(path.dirname(serverJarPath), 'plugins');
    if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });
    const dest = path.join(pluginsDir, path.basename(pluginSourcePath));
    try {
        fs.copyFileSync(pluginSourcePath, dest);
        return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('local-remove-plugin', (event, serverJarPath, pluginFileName) => {
    if (!serverJarPath || !pluginFileName) return { success: false };
    const target = path.join(path.dirname(serverJarPath), 'plugins', pluginFileName);
    try {
        if (fs.existsSync(target)) fs.unlinkSync(target);
        return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('local-pick-and-install-plugin', async (event, serverJarPath) => {
    if (!serverJarPath) return { success: false, error: "Selecciona el servidor primero." };
    const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'Minecraft Plugin', extensions: ['jar'] }],
        title: 'Selecciona el plugin (.jar)'
    });
    if (!result.canceled && result.filePaths.length > 0) {
        const sourcePath = result.filePaths[0];

        const pluginsDir = path.join(path.dirname(serverJarPath), 'plugins');
        if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });
        const dest = path.join(pluginsDir, path.basename(sourcePath));
        try {
            fs.copyFileSync(sourcePath, dest);
            return { success: true };
        } catch (e) { return { success: false, error: e.message }; }
    }
    return null; // Cancelado por el usuario
});

ipcMain.on('local-open-server-folder', (event) => {
    if (global.minecraftServerPath) {
        shell.showItemInFolder(global.minecraftServerPath);
    }
});

ipcMain.on('local-open-assets-folder', (event) => {
    const assetsPath = path.join(app.getPath('userData'), 'imported_assets');
    if (!fs.existsSync(assetsPath)) {
        try { fs.mkdirSync(assetsPath, { recursive: true }); } catch (e) { }
    }
    shell.openPath(assetsPath);
});

ipcMain.handle('local-get-assets-path', (event) => {
    const assetsPath = path.join(app.getPath('userData'), 'imported_assets');
    if (!fs.existsSync(assetsPath)) {
        try { fs.mkdirSync(assetsPath, { recursive: true }); } catch (e) { }
    }
    return assetsPath;
});

// --- PROCESAMIENTO DE COMANDOS EN BACKGROUND (Evita throttling) ---
function processCmdString(cmd, context = {}) {
    if (typeof cmd !== 'string') return cmd;
    const val = (k, def) => (context && context[k] !== undefined && context[k] !== null) ? context[k] : def;
    const mcJsonEscape = (s) => JSON.stringify(String(s)).slice(1, -1);

    // Reemplazo de variables
    cmd = cmd.replace(/\{(\w+)(\|json|\|url)?\}/g, (match, key, modifier) => {
        let v;
        switch (key) {
            case 'playername': v = val('playername', '@p'); break;
            case 'nickname': v = val('nickname', 'Viewer'); break;
            case 'username': v = val('nickname', 'User'); break;
            case 'handle': v = val('uniqueId', 'User'); break;
            case 'uniqueId': v = val('uniqueId', 'User'); break;
            case 'sender': v = val('nickname', 'User'); break;
            case 'user': v = val('nickname', 'User'); break;
            case 'giftname': v = val('giftname', 'Gift'); break;
            case 'giftcount': v = val('giftcount', '1'); break;
            case 'coins': v = val('coins', '10'); break;
            case 'count': v = val('count', '1'); break;
            case 'message': v = val('message', ''); break;
            case 'comment': v = val('message', ''); break;
            case 'picture': v = val('picture', ''); break;
            case 'repetition': v = val('repetition', '1'); break;
            case 'index': v = val('index', '1'); break;
            case 'radius': v = val('radius', '3'); break;
            default:
                if (context && context[key] !== undefined) v = context[key];
                else return match;
        }
        if (modifier === '|json') return mcJsonEscape(v);
        if (modifier === '|url') return encodeURIComponent(v);
        return String(v);
    });

    // Math helpers
    cmd = cmd.replace(/\{random:\['(.*?)'\]\}/g, (m, content) => {
        const opts = content.split("','");
        return opts[Math.floor(Math.random() * opts.length)];
    });
    cmd = cmd.replace(/\{random:(-?\d+)\s+(-?\d+)\s+(-?\d+)\}/g, (m, n, min, max) => {
        const val = Math.floor(Math.random() * (parseFloat(max) - parseFloat(min) + 1) + parseFloat(min));
        return (parseFloat(n) + val).toString();
    });
    cmd = cmd.replace(/\{random:([-\d\.]+)\s+([-\d\.]+)\}/g, (m, min, max) => {
        return Math.floor(Math.random() * (parseFloat(max) - parseFloat(min) + 1) + parseFloat(min));
    });
    cmd = cmd.replace(/{mult:([-\\d\\.]+)\\s+([-\\d\\.]+)}/g, (m, x, y) => (parseFloat(x) * parseFloat(y)).toString());
    cmd = cmd.replace(/{plus:([-\\d\\.]+)\\s+([-\\d\\.]+)}/g, (m, x, y) => (parseFloat(x) + parseFloat(y)).toString());

    return cmd;
}

ipcMain.on('local-execute-trigger', (event, { trigger, context }) => {
    const rawCommands = trigger.command || "";
    const repetition = parseInt(trigger.actionRepetition) || 1;
    const delay = parseInt(trigger.actionDelay) || 0;
    const interval = parseInt(trigger.actionInterval) || 0;

    console.log(`[Trigger] Executing ${trigger.type} (x${repetition})`);

    const executeLoop = async () => {
        for (let i = 1; i <= repetition; i++) {
            const loopContext = { ...context, repetition: repetition, index: i };

            if (trigger.actionType === 'gta5') {
                if (trigger.webhookUrl) {
                    // Detectar prefijo especial '!' o '$'
                    let rawUrl = trigger.webhookUrl.trim();
                    let isSpecial = rawUrl.startsWith('!') || rawUrl.startsWith('$');
                    if (isSpecial) rawUrl = rawUrl.substring(1);

                    // Auto-activar lógica especial para puertos de mods conocidos (6720/8082)
                    // Esto soluciona el error 401 si el usuario olvidó el '!'
                    if (!isSpecial && (rawUrl.includes(':6720') || rawUrl.includes(':8082'))) {
                        isSpecial = true;
                    }

                    // Procesar variables en la URL
                    let urlStr = processCmdString(rawUrl, loopContext);

                    let method = trigger.webhookMethod || 'GET';
                    const options = { method, headers: {} };

                    if (isSpecial) {
                        // --- LÓGICA ESPECIAL GTA 5 (StreamToEarn Mod) ---
                        try {
                            const u = new URL(urlStr);

                            // Force IPv4 for local mods to avoid IPv6 issues (Node 17+)
                            if (u.hostname === 'localhost') {
                                u.hostname = '127.0.0.1';
                            }

                            const port = u.port || (u.protocol === 'https:' ? '443' : '80');

                            const TOKEN_BY_PORT = { '8082': 'glory to ukraine', '6720': 'streamtoearn.io' };
                            const TOKEN = TOKEN_BY_PORT[port] || 'streamtoearn.io';

                            const params = new URLSearchParams();
                            for (const [k, v] of u.searchParams.entries()) {
                                // FIX: Limpiar nombres de usuario (Emojis/Caracteres raros) para que se vean bien en el juego
                                if (k === 'username' || k === 'name' || k === 'sender' || k === 'gift_name') {
                                    // Regex para eliminar emojis y símbolos gráficos
                                    let clean = v.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '');
                                    clean = clean.replace(/\s+/g, ' ').trim();
                                    if (!clean) clean = v; // Si el nombre era solo emojis, usar el original
                                    params.append(k, clean);
                                } else {
                                    params.append(k, v);
                                }
                            }

                            // Garantizar username si no existe
                            if (!params.has('username')) {
                                let original = loopContext.nickname || loopContext.uniqueId || 'User';
                                let username = original.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '').replace(/\s+/g, ' ').trim();
                                if (!username) username = original;
                                params.append('username', username);
                            }

                            // Extra params ONLY for StreamToEarn Mod (6720)
                            if (port === '6720') {
                                // Garantizar amount si no existe
                                if (!params.has('amount') && !params.has('count')) {
                                    const count = loopContext.giftcount || loopContext.count || '1';
                                    params.append('amount', count);
                                }

                                // Garantizar gift_name si no existe
                                if (!params.has('gift_name') && loopContext.giftname) {
                                    params.append('gift_name', loopContext.giftname);
                                }
                            }

                            // FIX: Only force POST and move params to body for known GTA 5 ports (6720/8082)
                            if (port === '6720' || port === '8082') {
                                // Configurar petición POST
                                method = 'POST';
                                options.method = 'POST';

                                if (port === '8082') {
                                    // Chaos Mod (JSON)
                                    options.headers = {
                                        'Content-Type': 'application/json',
                                        'Accept': 'application/json, text/plain, */*',
                                        'Superdupertoken': TOKEN,
                                        'Origin': 'https://app.streamtoearn.io',
                                        'Referer': 'https://app.streamtoearn.io/',
                                        'User-Agent': 'AppForwarder/1.0',
                                        'Connection': 'close'
                                    };

                                    const jsonBody = {};
                                    for (const [k, v] of params.entries()) {
                                        jsonBody[k] = v;
                                    }
                                    // Mapping specific for Chaos Mod
                                    if (jsonBody.trigger) jsonBody.effect_id = jsonBody.trigger;
                                    if (jsonBody.username && !jsonBody.sender) jsonBody.sender = jsonBody.username;

                                    options.body = JSON.stringify(jsonBody);
                                } else {
                                    // StreamToEarn Mod (Form UrlEncoded)
                                    options.headers = {
                                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                                        'Accept': 'application/json, text/plain, */*',
                                        'Superdupertoken': TOKEN,
                                        'Origin': 'https://app.streamtoearn.io',
                                        'Referer': 'https://app.streamtoearn.io/',
                                        'User-Agent': 'AppForwarder/1.0',
                                        'Connection': 'close'
                                    };
                                    options.body = params.toString();
                                }

                                // Limpiar query params de la URL destino ya que van en el body
                                u.search = '';
                            } else {
                                // For other ports (like 55001): Try POST with JSON Body + URL Params
                                method = 'POST';
                                options.method = 'POST';
                                u.search = params.toString();

                                options.headers = {
                                    'Content-Type': 'application/json',
                                    'Accept': 'application/json, text/plain, */*',
                                    'Superdupertoken': TOKEN,
                                    'Origin': 'https://app.streamtoearn.io',
                                    'Referer': 'https://app.streamtoearn.io/',
                                    'User-Agent': 'AppForwarder/1.0',
                                    'Connection': 'close'
                                };

                                const jsonBody = {};
                                for (const [k, v] of params.entries()) {
                                    jsonBody[k] = v;
                                }
                                options.body = JSON.stringify(jsonBody);
                            }

                            urlStr = u.toString();

                            console.log(`[GTA5] Special Request: ${urlStr} (Token: ${TOKEN})`);

                        } catch (e) {
                            console.error('[GTA5] Error preparing special request:', e);
                        }
                    } else {
                        // --- LÓGICA ESTÁNDAR (Webhooks genéricos) ---
                        if (trigger.webhookHeaders) {
                            try {
                                const customHeaders = JSON.parse(trigger.webhookHeaders);
                                for (const key in customHeaders) {
                                    options.headers[key] = processCmdString(customHeaders[key], loopContext);
                                }
                            } catch (e) { console.error('[GTA5] Error parsing headers:', e); }
                        }

                        if (method === 'POST' && trigger.webhookPayload) {
                            if (!options.headers['Content-Type']) options.headers['Content-Type'] = 'application/json';
                            options.body = processCmdString(trigger.webhookPayload, loopContext);
                        }
                    }

                    try {
                        const logMsg = `[GTA5] ${method} ${urlStr}`;
                        console.log(logMsg);
                        if (options.body) console.log('[GTA5] Payload:', options.body);

                        sendToAllWindows('minecraft-log', logMsg);
                        const res = await fetch(urlStr, options);
                        const resMsg = `[GTA5] Response: ${res.status} ${res.statusText}`;
                        console.log(resMsg);
                        sendToAllWindows('minecraft-log', resMsg);

                        if (!res.ok) {
                            try {
                                const errText = await res.text();
                                console.log('[GTA5] Server Error Details:', errText);
                            } catch (e) { }
                        }
                    } catch (e) {
                        const errMsg = `[GTA5] Error: ${e}`;
                        console.error(errMsg);
                        sendToAllWindows('minecraft-log', errMsg);
                    }
                }
            } else {
                const lines = rawCommands.split('\n');
                for (let line of lines) {
                    line = line.trim();
                    if (!line) continue;

                    const finalCmd = processCmdString(line, loopContext);

                    if (finalCmd.startsWith('win ')) {
                        widgetData.winCounter += (parseInt(finalCmd.split(' ')[1]) || 0);
                    } else if (finalCmd.startsWith('loss ')) {
                        widgetData.winCounter -= (parseInt(finalCmd.split(' ')[1]) || 0);
                    } else if (finalCmd.startsWith('set ')) {
                        widgetData.winCounter = (parseInt(finalCmd.split(' ')[1]) || 0);
                    } else {
                        const proc = getMinecraftServerProcess();
                        if (proc && proc.stdin) {
                            // Quitar la barra '/' inicial si existe, ya que la consola no la necesita
                            const cmdToSend = finalCmd.startsWith('/') ? finalCmd.substring(1) : finalCmd;
                            console.log('[MC] Sending:', cmdToSend);
                            proc.stdin.write(cmdToSend + '\n');
                        } else {
                            console.warn('[MC] Server not running, cannot send:', finalCmd);
                            sendToAllWindows('minecraft-log', `[MC] Error: Server not running, cannot send: ${finalCmd}`);
                        }
                    }
                }
            }

            if (i < repetition && interval > 0) await new Promise(r => setTimeout(r, interval));
        }
    };

    if (delay > 0) setTimeout(executeLoop, delay);
    else executeLoop();
});

// --- AUDIO SEARCH (MyInstants API) ---
ipcMain.handle('local-search-sounds', async (event, query) => {
    const q = String(query || '').trim();
    if (!q) return { items: [] };

    try {
        // Consultamos la API oficial de MyInstants
        const apiUrl = `https://www.myinstants.com/api/v1/instants/?format=json&name=${encodeURIComponent(q)}`;

        const response = await fetch(apiUrl);

        if (!response.ok) {
            throw new Error(`Error MyInstants API: ${response.status}`);
        }

        const data = await response.json();
        const items = [];
        if (data.results && Array.isArray(data.results)) {
            items.push(...data.results.map(sound => ({
                title: sound.name,
                mp3: sound.sound,
                image: sound.image,
                color: sound.color,
                duration: sound.duration
            })));
        }
        return { items };
    } catch (e) {
        console.error('[SoundLib] Error:', e.message);
        return { items: [], error: e.message };
    }
});

// --- SELECCIONAR IMAGEN LOCAL ---
ipcMain.handle('local-select-image', async (event) => {
    const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'Imágenes', extensions: ['jpg', 'png', 'gif', 'webp', 'jpeg', 'svg'] }]
    });
    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

// --- SELECCIONAR MEDIA LOCAL (Video/Gif) ---
ipcMain.handle('local-select-media', async (event) => {
    const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'Media', extensions: ['jpg', 'png', 'gif', 'webp', 'mp4', 'webm'] }]
    });
    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

// --- SELECCIONAR AUDIO LOCAL ---
ipcMain.handle('local-select-audio', async (event) => {
    const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg'] }]
    });
    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

ipcMain.on('loadCachedGifts', (event) => {
    try {
        const giftList = (inMemoryGifts && inMemoryGifts.length > 0) ? inMemoryGifts : defaultGiftCatalog;
        widgetData.gifts = giftList; // Actualizar para OBS Widget en tiempo real
        if (global.widgetIo) global.widgetIo.emit('update-gifts', giftList);
        event.reply('getAvailableGifts', { success: true, gifts: giftList });
    } catch (err) {
        console.error('Error loading cached gifts:', err);
        event.reply('getAvailableGifts', { success: false, gifts: defaultGiftCatalog || [] });
    }
});

// --- SISTEMA DE GUARDADO DE PLANTILLAS (FILE SYSTEM) ---
// Esto permite compartir plantillas entre la ventana principal y el webview
ipcMain.handle('local-load-templates', async (event) => {
    const tplPath = path.join(app.getPath('userData'), 'templates.json');
    try {
        if (fs.existsSync(tplPath)) {
            return JSON.parse(fs.readFileSync(tplPath, 'utf8'));
        }
    } catch (e) { console.error('Error loading templates:', e); }
    return null; // Retorna null para indicar que no hay archivo (y permitir migración)
});

ipcMain.on('local-save-templates', (event, data) => {
    const tplPath = path.join(app.getPath('userData'), 'templates.json');
    try {
        fs.writeFileSync(tplPath, JSON.stringify(data, null, 2));
        // [FIX] Actualizar widgetData en memoria inmediatamente
        widgetData.templates = data;
        if (global.widgetIo) global.widgetIo.emit('data', widgetData);
    } catch (e) { console.error('Error saving templates:', e); }
});

ipcMain.on('local-save-media-triggers', (event, data) => {
    const mediaPath = path.join(app.getPath('userData'), 'media_triggers.json');
    try {
        fs.writeFileSync(mediaPath, JSON.stringify(data, null, 2));
    } catch (e) { console.error('Error saving media triggers:', e); }
});

// --- OBTENER PLANTILLAS POR DEFECTO PARA USUARIOS ANTIGUOS ---
ipcMain.handle('local-get-default-templates', async () => {
    const defaultsDir = path.join(__dirname, 'plantillas');
    let defaultTemplates = [];
    if (fs.existsSync(defaultsDir)) {
        const files = fs.readdirSync(defaultsDir);
        for (const file of files) {
            if (file.toLowerCase().endsWith('.json')) {
                try {
                    const content = fs.readFileSync(path.join(defaultsDir, file), 'utf8');
                    const parsed = JSON.parse(content);
                    if (Array.isArray(parsed)) defaultTemplates.push(...parsed);
                    else defaultTemplates.push(parsed);
                } catch (e) { console.error(`Error parseando ${file}:`, e); }
            }
        }
    }
    return defaultTemplates;
});

let alertsWin = null; // Referencia global para la ventana de alertas
let alertsEditorWin = null; // Ventana de edición (interfaz visible)

function createAlertsWindow() {
    if (alertsWin && !alertsWin.isDestroyed()) { alertsWin.show(); return; }
    alertsWin = new BrowserWindow({
        title: 'Alertas',   // Nombre para captura en OBS/TikTok Studio
        width: 415,         // Formato TikTok (Vertical 9:16 aprox)
        height: 740,
        x: 99999,           // Mover ventana fuera de la pantalla (invisible al usuario)
        y: 99999,
        resizable: false,   // Bloquear cambio de tamaño de ventana (mantiene 9:16)
        frame: false,       // Sin bordes
        transparent: true,  // Fondo transparente
        alwaysOnTop: false, // Desactivado: Permite que otras ventanas la cubran (para ocultarla)
        skipTaskbar: true,  // Activado: No se muestra en la barra de tareas (solo visible para OBS/TikTok)
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: false // Vital: Sigue reproduciendo alertas aunque esté detrás de tu juego
        }
    });
    alertsWin.setContentProtection(false); // Asegurar que esta ventana SÍ se capture
    alertsWin.setIgnoreMouseEvents(true); // Por defecto: Click-through (no molesta)
    alertsWin.loadURL('http://localhost:3011/alerts');

    // FIX: Forzar actualización de datos al abrir la ventana de alertas y topar a 60 FPS
    alertsWin.webContents.once('did-finish-load', () => {
        try {
            if (typeof alertsWin.webContents.setFrameRate === 'function') {
                alertsWin.webContents.setFrameRate(60);
            }
        } catch(e) {}
        if (global.widgetIo) {
            global.widgetIo.emit('data', widgetData);
            if (widgetData.gifts) global.widgetIo.emit('update-gifts', widgetData.gifts);
        }
    });

    alertsWin.on('closed', () => {
        alertsWin = null;
        if (alertsEditorWin && !alertsEditorWin.isDestroyed()) alertsEditorWin.close();
    });
}

ipcMain.on('local-open-alerts-window', () => {
    createAlertsWindow();
});

ipcMain.on('local-alerts-update-settings', (event, { editMode, alwaysOnTop }) => {
    // 1. Configurar Ventana de Captura (alertsWin)
    if (alertsWin && !alertsWin.isDestroyed()) {
        // Si estamos editando, bajamos la prioridad de la ventana de captura para que no tape al editor
        if (editMode) {
            alertsWin.setAlwaysOnTop(false);
        } else {
            alertsWin.setAlwaysOnTop(alwaysOnTop);
        }
        // La ventana de captura SIEMPRE ignora el mouse ahora, la edición es en la otra ventana
        alertsWin.setIgnoreMouseEvents(true);
    }

    // 2. Gestionar Ventana de Edición (alertsEditorWin)
    if (editMode) {
        if (!alertsEditorWin || alertsEditorWin.isDestroyed()) {
            alertsEditorWin = new BrowserWindow({
                title: 'Editor de Alertas - NO CAPTURAR',
                width: 415,
                height: 740,
                resizable: false,
                frame: false,
                transparent: true,
                alwaysOnTop: true,
                skipTaskbar: true,
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false
                }
            });

            // Forzar que el editor esté por encima de todo (nivel 'screen-saver')
            alertsEditorWin.setAlwaysOnTop(true, 'screen-saver');

            // Sincronizar posición inicial con la ventana de captura
            alertsEditorWin.center(); // Centramos el editor porque la ventana original está oculta

            // Si mueves el editor, la ventana de captura te sigue
            alertsEditorWin.on('move', () => {
                // Ya no hace falta que se sigan porque la ventana de captura está escondida
            });

            alertsEditorWin.loadURL('http://localhost:3011/alerts?edit=true');
            alertsEditorWin.show();
        }
    } else {
        if (alertsEditorWin && !alertsEditorWin.isDestroyed()) {
            alertsEditorWin.close();
        }
    }
});

ipcMain.on('alerts-sync-update', (event, state) => {
    if (alertsWin && !alertsWin.isDestroyed()) {
        alertsWin.webContents.send('alerts-sync-update', state);
    }
});

let canvasWin = null;

// Desactivado: los overlays ahora se usan directamente como fuentes de navegador en OBS / TikTok Studio
function createCanvasWindow() {
    return Promise.resolve();
}

ipcMain.on('local-open-canvas-window', () => {});
ipcMain.on('local-canvas-update-settings', () => {});
ipcMain.on('canvas-sync-update', () => {});
ipcMain.on('resize-canvas-window', (event, ratio) => {
    if (typeof canvasState !== 'undefined' && canvasState) {
        canvasState.activeResolution = ratio;
        if (typeof saveCanvasProfilesToDisk === 'function') saveCanvasProfilesToDisk();
    }
});

// --- PUENTE DE IMPORTACIÓN (Cloud -> Local) ---
ipcMain.on('bridge-import-templates', async (event, importedTemplates) => {
    const tplPath = path.join(app.getPath('userData'), 'templates.json');
    let currentTemplates = [];
    try {
        if (fs.existsSync(tplPath)) {
            currentTemplates = JSON.parse(fs.readFileSync(tplPath, 'utf8'));
        }
    } catch (e) { }

    if (!Array.isArray(importedTemplates)) importedTemplates = [importedTemplates];

    let addedCount = 0;
    importedTemplates.forEach(newTpl => {
        // Sanitizar y evitar colisiones
        if (!newTpl.name) newTpl.name = "Plantilla Importada";
        newTpl.id = Date.now() + Math.floor(Math.random() * 100000) + addedCount;
        newTpl.name = newTpl.name;

        // Regenerar IDs de triggers
        if (newTpl.triggers) {
            newTpl.triggers.forEach(t => t.id = Date.now() + Math.floor(Math.random() * 1000000));
        }

        currentTemplates.push(newTpl);
        addedCount++;
    });

    try {
        fs.writeFileSync(tplPath, JSON.stringify(currentTemplates, null, 2));
        console.log(`[Bridge] Importadas ${addedCount} plantillas desde Cloud.`);
        // Notificar a todas las ventanas para que recarguen
        sendToAllWindows('reload-templates');
        // Confirmación visual (opcional, se puede manejar en renderer)
    } catch (e) { console.error('Error saving imported templates:', e); }
});

// --- DESCARGA DE ASSETS (Audio/Img) ---
ipcMain.handle('local-download-asset', async (event, url) => {
    if (!url || !url.startsWith('http')) return url;
    try {
        const assetsPath = path.join(app.getPath('userData'), 'imported_assets');
        if (!fs.existsSync(assetsPath)) {
            fs.mkdirSync(assetsPath, { recursive: true });
        }

        let fileName = 'download.bin';
        try {
            const u = new URL(url);
            fileName = path.basename(u.pathname);
        } catch (e) { }

        if (!fileName || fileName.length < 2) fileName = `audio_${Date.now()}.mp3`;
        // Limpiar nombre de archivo
        fileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');

        const uniqueName = `${Date.now()}_${fileName}`;
        const filePath = path.join(assetsPath, uniqueName);

        const response = await fetch(url);
        if (!response.ok) throw new Error(`Status ${response.status}`);

        const buffer = await response.arrayBuffer();
        fs.writeFileSync(filePath, Buffer.from(buffer));

        return `file://${filePath.replace(/\\/g, '/')}`;
    } catch (e) {
        console.error('[Main] Error downloading asset:', url, e);
        return url; // Fallback a URL remota si falla
    }
});

ipcMain.handle('local-save-asset', async (event, { url, buffer }) => {
    try {
        const assetsPath = path.join(app.getPath('userData'), 'imported_assets');
        if (!fs.existsSync(assetsPath)) {
            fs.mkdirSync(assetsPath, { recursive: true });
        }

        let fileName = 'download.bin';
        try {
            const u = new URL(url);
            fileName = path.basename(u.pathname);
        } catch (e) { }

        if (!fileName || fileName.length < 2) fileName = `asset_${Date.now()}.bin`;
        fileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');

        const uniqueName = `${Date.now()}_${fileName}`;
        const filePath = path.join(assetsPath, uniqueName);

        fs.writeFileSync(filePath, Buffer.from(buffer));

        return `file://${filePath.replace(/\\/g, '/')}`;
    } catch (e) {
        console.error('[Main] Error saving asset:', e);
        return url;
    }
});

// --- IMPORTAR PLANTILLA ZIP ---
ipcMain.handle('local-import-zip', async (event, zipPath) => {
    try {
        let AdmZip;
        try {
            AdmZip = require('adm-zip');
        } catch (e) {
            return { success: false, error: "Falta la librería 'adm-zip'. Ejecuta: npm install adm-zip" };
        }

        const zip = new AdmZip(zipPath);
        const zipEntries = zip.getEntries();
        const assetsDestPath = path.join(app.getPath('userData'), 'imported_assets');
        if (!fs.existsSync(assetsDestPath)) fs.mkdirSync(assetsDestPath, { recursive: true });

        let importedTemplates = [];
        // Buscar archivos JSON en el ZIP
        const jsonEntries = zipEntries.filter(entry => entry.entryName.toLowerCase().endsWith('.json') && !entry.isDirectory);

        for (const jsonEntry of jsonEntries) {
            const content = jsonEntry.getData().toString('utf8');
            let data;
            try { data = JSON.parse(content); } catch (e) { continue; }

            const tpls = Array.isArray(data) ? data : [data];
            tpls.forEach(tpl => {
                // Función para extraer y remapear assets
                const processAssetPath = (assetPath) => {
                    if (!assetPath || typeof assetPath !== 'string' || assetPath.startsWith('http') || assetPath.startsWith('data:')) return assetPath;

                    // Normalizar nombre del archivo buscado (aplanamos la estructura para encontrarlo fácil)
                    const targetName = path.basename(assetPath);

                    // Buscar en el zip (coincidencia por nombre de archivo)
                    const assetEntry = zipEntries.find(e => !e.isDirectory && path.basename(e.entryName) === targetName);

                    if (assetEntry) {
                        const newFileName = `import_${Date.now()}_${Math.floor(Math.random() * 1000)}_${targetName.replace(/[^a-z0-9.]/gi, '_')}`;
                        const destPath = path.join(assetsDestPath, newFileName);
                        fs.writeFileSync(destPath, assetEntry.getData());
                        return `file://${destPath.replace(/\\/g, '/')}`;
                    }
                    return assetPath;
                };

                const list = tpl.triggers || tpl.events || [];
                if (Array.isArray(list)) {
                    list.forEach(item => {
                        if (item.functionImage) item.functionImage = processAssetPath(item.functionImage);
                        if (item.mediaFile) item.mediaFile = processAssetPath(item.mediaFile);

                        // Fix Audio Import (Legacy/String/Object)
                        if (item.sound && typeof item.sound === 'string') {
                            const p = processAssetPath(item.sound);
                            if (!item.audio) item.audio = { mp3: p, title: path.basename(p) };
                        }
                        if (item.audio) {
                            if (typeof item.audio === 'string') {
                                const p = processAssetPath(item.audio);
                                item.audio = { mp3: p, title: path.basename(p) };
                            } else if (item.audio.mp3) {
                                item.audio.mp3 = processAssetPath(item.audio.mp3);
                            } else if (item.audio.audios && Array.isArray(item.audio.audios)) {
                                item.audio.audios.forEach(a => {
                                    if (a.url) {
                                        a.url = processAssetPath(a.url);
                                        if (!item.audio.mp3) {
                                            item.audio.mp3 = a.url;
                                            item.audio.title = a.name || path.basename(a.url);
                                        }
                                    }
                                });
                            }
                        }

                        if (item.function && item.function.image) item.function.image = processAssetPath(item.function.image);
                    });
                }
                importedTemplates.push(tpl);
            });
        }
        return { success: true, templates: importedTemplates };
    } catch (e) {
        console.error('ZIP Import Error:', e);
        return { success: false, error: e.message };
    }
});

// --- IMPORTACIÓN INTELIGENTE (JSON + ASSETS FOLDER) ---
ipcMain.handle('local-import-json-check-assets', async (event, filePath) => {
    try {
        const sourceDir = path.dirname(filePath);
        // Check for 'assets' or 'Assets'
        let assetsDir = path.join(sourceDir, 'assets');
        if (!fs.existsSync(assetsDir)) {
            const assetsDirCap = path.join(sourceDir, 'Assets');
            if (fs.existsSync(assetsDirCap)) assetsDir = assetsDirCap;
        }

        const hasAssetsDir = fs.existsSync(assetsDir) && fs.statSync(assetsDir).isDirectory();
        console.log(`[Smart Import] Checking assets in: ${assetsDir} (Exists: ${hasAssetsDir})`);

        const content = fs.readFileSync(filePath, 'utf8');
        let data;
        try { data = JSON.parse(content); } catch (e) { return { success: false, error: "JSON inválido" }; }

        const templates = Array.isArray(data) ? data : [data];
        const appAssetsDir = path.join(app.getPath('userData'), 'imported_assets');
        if (!fs.existsSync(appAssetsDir)) fs.mkdirSync(appAssetsDir, { recursive: true });

        let copiedCount = 0;

        templates.forEach(tpl => {
            const list = tpl.triggers || tpl.events || [];
            if (Array.isArray(list)) {
                list.forEach(item => {
                    const processPath = (currentPath) => {
                        if (!currentPath || typeof currentPath !== 'string' || currentPath.startsWith('data:') || currentPath.startsWith('http')) return currentPath;

                        if (hasAssetsDir) {
                            // Robust filename extraction
                            let cleanPath = currentPath.replace(/^file:\/\/\/?/, '');
                            try { cleanPath = decodeURIComponent(cleanPath); } catch (e) { }
                            // Normalize separators to / to handle Windows paths on any OS
                            cleanPath = cleanPath.replace(/\\/g, '/');
                            const fileName = cleanPath.split('/').pop(); // Manual basename

                            if (!fileName) return currentPath;

                            // Intentar encontrar el archivo en la carpeta assets vecina
                            let assetPath = path.join(assetsDir, fileName);

                            // Si no existe directo, probar decodificando (por si tiene espacios %20)
                            if (!fs.existsSync(assetPath)) {
                                try { assetPath = path.join(assetsDir, decodeURIComponent(fileName)); } catch (e) { }
                            }

                            if (fs.existsSync(assetPath)) {
                                const newFileName = `import_${Date.now()}_${Math.floor(Math.random() * 1000)}_${fileName.replace(/[^a-z0-9.]/gi, '_')}`;
                                const destPath = path.join(appAssetsDir, newFileName);
                                try {
                                    fs.copyFileSync(assetPath, destPath);
                                    console.log(`[Smart Import] Copied: ${fileName} -> ${newFileName}`);
                                    copiedCount++;
                                    return `file://${destPath.replace(/\\/g, '/')}`;
                                } catch (e) {
                                    console.error(`[Smart Import] Failed to copy ${fileName}:`, e);
                                }
                            } else {
                                console.log(`[Smart Import] Asset not found in folder: ${fileName}`);
                            }
                        }
                        return currentPath;
                    };

                    if (item.functionImage) item.functionImage = processPath(item.functionImage);
                    if (item.mediaFile) item.mediaFile = processPath(item.mediaFile);

                    // Fix Audio Import (Legacy/String/Object)
                    if (item.sound && typeof item.sound === 'string') {
                        const p = processPath(item.sound);
                        if (!item.audio) item.audio = { mp3: p, title: path.basename(p) };
                    }
                    if (item.audio) {
                        if (typeof item.audio === 'string') {
                            const p = processPath(item.audio);
                            item.audio = { mp3: p, title: path.basename(p) };
                        } else if (item.audio.mp3) {
                            item.audio.mp3 = processPath(item.audio.mp3);
                        } else if (item.audio.audios && Array.isArray(item.audio.audios)) {
                            item.audio.audios.forEach(a => {
                                if (a.url) {
                                    a.url = processPath(a.url);
                                    if (!item.audio.mp3) {
                                        item.audio.mp3 = a.url;
                                        item.audio.title = a.name || path.basename(a.url);
                                    }
                                }
                            });
                        }
                    }

                    if (item.function && item.function.image) item.function.image = processPath(item.function.image);
                });
            }
        });

        console.log(`[Smart Import] Total assets copied: ${copiedCount}`);
        return { success: true, templates: templates };
    } catch (e) {
        console.error('Smart Import Error:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('local-save-asset-base64', async (event, { url, base64 }) => {
    try {
        const assetsPath = path.join(app.getPath('userData'), 'imported_assets');
        if (!fs.existsSync(assetsPath)) {
            fs.mkdirSync(assetsPath, { recursive: true });
        }

        let fileName = 'download.bin';
        try {
            const u = new URL(url);
            fileName = path.basename(u.pathname);
        } catch (e) { }

        if (!fileName || fileName.length < 2) fileName = `asset_${Date.now()}.bin`;
        fileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');

        const uniqueName = `${Date.now()}_${fileName}`;
        const filePath = path.join(assetsPath, uniqueName);

        const data = base64.replace(/^data:.*;base64,/, "");
        fs.writeFileSync(filePath, Buffer.from(data, 'base64'));

        return `file://${filePath.replace(/\\/g, '/')}`;
    } catch (e) {
        console.error('[Main] Error saving asset (base64):', e);
        return url;
    }
});
