'use strict';
// Registra el service worker (sw.js) lo antes posible: va con async y de primero en index.html,
// para que ya esté activo cuando el mapa pide su primera tesela. Si el navegador no lo permite
// (modo privado, http) no pasa nada: el visor sigue igual, solo sin caché propio.
// Con ?sw=0 en la dirección se desregistra y se borra lo guardado, para pedir todo de nuevo.
(function () {
  if (!('serviceWorker' in navigator)) return;
  if (/[?&]sw=0(&|$)/.test(location.search)) {
    navigator.serviceWorker.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.unregister())))
      .then(() => window.caches && caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('bogotwin-')).map((k) => caches.delete(k)))))
      .catch(() => {});
    return;
  }
  navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' }).catch(() => {});
})();
