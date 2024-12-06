const CACHE_NAME = 'crud_php_cache_v1';
const urlsToCache = [
  './',
  './index.php',
  './detalles.php',
  './config.php',
  './manifest.json',
  './formEditar.php',
  './action.php',
  './css/home.css',
  './imgs/logo.png',
];

// Instalar el Service Worker y cachear recursos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
      .catch((err) => console.error('Error en la instalación del cache:', err))
  );
});

// Activar el Service Worker y limpiar caches antiguos
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames.map((cacheName) => {
          if (!cacheWhitelist.includes(cacheName)) {
            return caches.delete(cacheName);
          }
        })
      ))
      .then(() => self.clients.claim())
  );
});

// Interceptar solicitudes de red
self.addEventListener('fetch', (event) => {
  const { method } = event.request;

  if (!navigator.onLine && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
    // Si está offline y la solicitud es CRUD, manejar offline
    event.respondWith(handleOfflineRequest(event.request));
  } else {
    // Manejo normal (online o solicitudes GET)
    event.respondWith(
      caches.match(event.request)
        .then((response) => response || fetch(event.request))
        .catch(() => new Response('Sin conexión a Internet', { status: 503 }))
    );
  }
});

// Manejar solicitudes CRUD offline
async function handleOfflineRequest(request) {
  const db = await openDatabase();
  const tx = db.transaction('requests', 'readwrite');
  const store = tx.objectStore('requests');

  // Clonar la solicitud y guardarla en IndexedDB
  const clonedRequest = await request.clone();
  const body = await clonedRequest.text();
  store.put({
    url: clonedRequest.url,
    method: clonedRequest.method,
    body,
  });

  return new Response(
    JSON.stringify({ success: false, message: 'Guardado para sincronizar más tarde' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

// Abrir o crear la base de datos IndexedDB
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('offlineRequestsDB', 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('requests')) {
        db.createObjectStore('requests', { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

// Sincronizar solicitudes pendientes
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-pending-requests') {
    event.waitUntil(syncPendingRequests());
  }
});

// Procesar solicitudes almacenadas en IndexedDB
async function syncPendingRequests() {
  const db = await openDatabase();
  const tx = db.transaction('requests', 'readonly');
  const store = tx.objectStore('requests');
  const requests = await store.getAll();

  for (const req of requests) {
    try {
      const requestOptions = {
        method: req.method,
        headers: { 'Content-Type': 'application/json' },
        body: req.body,
      };

      // Intentar enviar la solicitud
      await fetch(req.url, requestOptions);

      // Si tiene éxito, eliminarla de IndexedDB
      const deleteTx = db.transaction('requests', 'readwrite');
      const deleteStore = deleteTx.objectStore('requests');
      deleteStore.delete(req.id);
    } catch (error) {
      console.error('Error al sincronizar:', error);
    }
  }
}
