const CACHE_NAME = "shaft-additionality-v1";
const ASSETS = [
  "./",
  "index.html",
  "favicon.ico",
  "favicon.png",
  "textures/grass_top.png",
  "textures/grass_side.png",
  "textures/dirt.png",
  "textures/stone.png",
  "textures/sand.png",
  "textures/water.png",
  "textures/snow.png",
  "textures/wood_side.png",
  "textures/wood_top.png",
  "textures/leaves.png",
  "textures/cactus_top.png",
  "textures/cactus_side.png",
  "textures/cactus_bottom.png",
  "textures/planks.png",
  "textures/ct_top.png",
  "textures/ct_side.png",
  "textures/cobblestone.png",
  "textures/coal_ore.png",
  "textures/iron_ore.png",
  "textures/furnace_tbs.png",
  "textures/furnace_front.png",
  "textures/wfurnace_front.png",
  "textures/cowtexture.png",
  "textures/sticks.png",
  "textures/wp.png",
  "textures/wa.png",
  "textures/sp.png",
  "textures/sa.png",
  "textures/beef.png",
  "textures/coal.png",
  "textures/raw_iron.png",
  "textures/iron_ingot.png",
  "sounds/break.mp3",
  "sounds/place.mp3",
  "sounds/footstep.mp3",
  "sounds/bg_music.mp3"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});