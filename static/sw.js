// Service worker: permite instalar la app y abrirla aunque el servidor tarde.
// Los archivos de la interfaz se guardan en caché; los DATOS (/api) nunca: siempre vienen del servidor.
const VERSION = "diario-v3";
const ARCHIVOS = ["/", "/static/estilos.css", "/static/app.js", "/static/glosario.js", "/static/iconos/icono.svg", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // Red primero (para ver siempre la versión nueva); si no hay servidor, lo guardado.
  e.respondWith(
    fetch(e.request).then((r) => {
      const copia = r.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copia));
      return r;
    }).catch(() => caches.match(e.request))
  );
});
