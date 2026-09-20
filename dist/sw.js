const CACHE_VERSION = "shaft-v2";
const CACHE_NAME = "shaft-additionality-" + CACHE_VERSION;
const ASSETS = [
  "./", "index.html", "manifest.json", "favicon.ico", "favicon.png",
  "textures/grass_top.png","textures/grass_side.png","textures/dirt.png","textures/stone.png",
  "textures/sand.png","textures/water.png","textures/snow.png","textures/wood_side.png",
  "textures/wood_top.png","textures/leaves.png","textures/cactus_top.png","textures/cactus_side.png",
  "textures/cactus_bottom.png","textures/planks.png","textures/ct_top.png","textures/ct_side.png",
  "textures/cobblestone.png","textures/coal_ore.png","textures/iron_ore.png",
  "textures/furnace_tbs.png","textures/furnace_front.png","textures/wfurnace_front.png",
  "textures/cowtexture.png","textures/sticks.png","textures/wp.png","textures/wa.png",
  "textures/sp.png","textures/sa.png","textures/beef.png","textures/coal.png",
  "textures/raw_iron.png","textures/iron_ingot.png",
  "sounds/break.mp3","sounds/place.mp3","sounds/footstep.mp3","sounds/bg_music.mp3"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const isHTML = e.request.mode === "navigate" ||
                 url.pathname.endsWith("/") ||
                 url.pathname.endsWith("index.html") ||
                 url.pathname.endsWith("sw.js") ||
                 url.pathname.endsWith("manifest.json");

  if (isHTML) {
    // Network-first for HTML: always try fresh, fall back to cache if offline
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request))
    );
  } else {
    // Cache-first for assets: fast
    e.respondWith(
      caches.match(e.request).then((res) => res || fetch(e.request).then((net) => {
        const copy = net.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, copy));
        return net;
      }))
    );
  }
});

// When the page tells us to skip waiting, do it
self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});
