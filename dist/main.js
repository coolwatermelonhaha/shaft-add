import * as THREE from 'three';
import {
  HOTBAR_SIZE, TOTAL_SLOTS, INVENTORY_MAX_STACK, CHUNK_SIZE, RENDER_DISTANCE,
  SEA_LEVEL, BLOCK, ITEM, BLOCK_INFO, ITEM_INFO, isItem, getInfo, CRAFT_RECIPES
} from './config.js';
import {
  scene, camera, renderer, player, mobs, particles, chunks,
  blockChanges, blockFacings, inventory, selectedIndex, gamemode, keys,
  chunkBuildQueue, queuedChunks, chunkRebuildQueue, queuedRebuilds,
  caveCache, oreCache, treeCache, cactusCache, SEED, setSeed, setBiomeBlend,
  cursorItem, setCursorItem
} from './core.js';
import { loadAllTextures, material, overlayMaterial, getIconHTML, getDurabilityHTML, itemTextures } from './textures.js';
import { getHeight, getBiome, queryBlock, getPlayerBlock } from './worldgen.js';
import { buildChunkGeometry, queueChunkForBuild, processChunkQueues, ensureChunksAround, rebuildAllChunks, chunkKey } from './chunks.js';
import { rebuildHotbar, updateHotbar, addToInventory, removeFromInventory, getSelectedItemId, getInventory, updateCursorDisplay } from './inventory.js';
import { refreshUI, isInventoryOpen, isCraftingOpen, closeInventory, renderInventory } from './crafting.js';
import { updateFurnaces, isFurnaceOpen, renderFurnace, closeFurnaceUI } from './furnace.js';
import { isChestOpen, renderChest, closeChestUI } from './chest.js';
import { updateMining, updateFallDamage, updateParticles, highlightBox, getTargetedBlock, isSolid, setBreaking } from './mining.js';
import { Mob, Zombie, updateMobs, trySpawnCows, loadAllModels } from './mobs.js';
import { updateDayNight } from './daynight.js';
import { setGamemode, updateHealthBar, updateHungerBar, updateHunger } from './ui.js';
import { setupInput } from './input.js';
import { playSound, soundFootstep, music, musicEnabled } from './audio.js';

window.setGamemode=setGamemode;
window.closeGamemodeMenu=()=>import('./ui.js').then(u=>u.closeGamemodeMenu());

export function spawnPlayer(){
  const h=getHeight(0,0);
  player.pos.set(.5,Math.max(h,SEA_LEVEL)+1.8+5,.5);
  player.vel.set(0,0,0);
  player.yaw=0;player.pitch=0;
  player.health=20;player.hunger=20;
  player.hungerTimer=0;player.starveTimer=0;
  player.fallStartY=null;
  player.sneaking=false;player.sprinting=false;player.flying=false;
}

const CREATIVE_ITEMS_BASE=[
  {id:BLOCK.GRASS,name:"Grass"},{id:BLOCK.DIRT,name:"Dirt"},{id:BLOCK.DIRT_DARK,name:"Dark Dirt"},
  {id:BLOCK.STONE,name:"Stone"},{id:BLOCK.COBBLESTONE,name:"Cobblestone"},
  {id:BLOCK.SAND,name:"Sand"},{id:BLOCK.SNOW,name:"Snow"},
  {id:BLOCK.LOG,name:"Wood"},{id:BLOCK.LEAVES,name:"Leaves"},
  {id:BLOCK.CACTUS,name:"Cactus"},{id:BLOCK.PLANKS,name:"Planks"},
  {id:BLOCK.CRAFTING_TABLE,name:"Crafting Table"},
  {id:BLOCK.COAL_ORE,name:"Coal Ore"},{id:BLOCK.IRON_ORE,name:"Iron Ore"},
  {id:BLOCK.FURNACE,name:"Furnace"},{id:BLOCK.CHEST,name:"Chest"},
  {id:BLOCK.BED_FOOT,name:"Bed"},{id:BLOCK.TORCH,name:"Torch"},
  {id:ITEM.STICK,name:"Stick"},{id:ITEM.WP,name:"Wooden Pickaxe"},{id:ITEM.WA,name:"Wooden Axe"},
  {id:ITEM.SP,name:"Stone Pickaxe"},{id:ITEM.SA,name:"Stone Axe"},
  {id:ITEM.BEEF,name:"Raw Beef"},{id:ITEM.STEAK,name:"Steak"},
  {id:ITEM.COAL,name:"Coal"},{id:ITEM.RAW_IRON,name:"Raw Iron"},{id:ITEM.IRON_INGOT,name:"Iron Ingot"},
  {id:ITEM.ROTTEN_FLESH,name:"Rotten Flesh"}
];

function makeCreativeSlot(item){
  const s=document.createElement('div');
  s.className='inv-slot';
  s.innerHTML=getIconHTML(item.id);
  s.addEventListener('mousedown',e=>{
    e.preventDefault();e.stopPropagation();
    if(gamemode!=='creative')return;
    const amount=e.button===2?64:1;
    addToInventory(item.id,amount);
    renderCreativePanel();
  });
  s.addEventListener('contextmenu',e=>e.preventDefault());
  return s;
}

export function renderCreativePanel(){
  const panel=document.getElementById('creative-panel');
  const grid=document.getElementById('creative-grid');
  if(!panel||!grid)return;
  if(gamemode!=='creative'){panel.style.display='none';return}
  panel.style.display='flex';
  grid.innerHTML='';
  CREATIVE_ITEMS_BASE.forEach(it=>grid.appendChild(makeCreativeSlot(it)));
}

window._renderCreativePanel=renderCreativePanel;
window._isFurnaceOpen=isFurnaceOpen;
window._renderFurnace=renderFurnace;
window._isChestOpen=isChestOpen;
window._renderChest=renderChest;

const heldScene=new THREE.Scene();
const heldCamera=new THREE.PerspectiveCamera(50,1,.1,10);
heldCamera.position.set(0,0,3);
const heldLight=new THREE.DirectionalLight(0xffffff,1.5);
heldLight.position.set(1,2,2);
heldScene.add(heldLight);
heldScene.add(new THREE.AmbientLight(0xffffff,.8));
let heldMesh=null;
const heldMat=new THREE.MeshLambertMaterial({map:null});

export function updateHeldItem(){
  if(heldMesh){heldScene.remove(heldMesh);heldMesh.geometry.dispose();heldMesh=null}
  const item=inventory[selectedIndex];
  if(!item||item.id===null||item.id===undefined)return;
  if(isItem(item.id)){
    const g=new THREE.BoxGeometry(.15,.15,.5);
    heldMat.map=null;
    heldMat.color=new THREE.Color(getInfo(item.id).color);
    heldMesh=new THREE.Mesh(g,heldMat);
    heldMesh.rotation.set(-.2,.6,.1);
    heldScene.add(heldMesh);
    return;
  }
  const g=new THREE.BoxGeometry(.6,.6,.6);
  heldMat.map=material.map;
  heldMat.color=new THREE.Color(0xffffff);
  heldMat.needsUpdate=true;
  heldMesh=new THREE.Mesh(g,heldMat);
  heldMesh.rotation.set(-.2,.6,.1);
  heldScene.add(heldMesh);
}
window.updateHeldItem=updateHeldItem;

const clickHint=document.getElementById('click-hint');
clickHint.addEventListener('click',e=>{
  if(e.target.id==='btn-settings')return;
  clickHint.style.display='none';
  document.getElementById('crosshair').style.display='block';
  renderer.domElement.requestPointerLock().catch(()=>{});
  if(musicEnabled)music.play().catch(()=>{});
});
document.getElementById('btn-settings').addEventListener('click',e=>{
  e.stopPropagation();
  clickHint.style.display='none';
  document.getElementById('settings-menu').style.display='block';
});
document.getElementById('btn-close-settings').addEventListener('click',()=>{
  document.getElementById('settings-menu').style.display='none';
  clickHint.style.display='block';
});
const blendSlider=document.getElementById('blend-slider');
const blendVal=document.getElementById('blend-val');
blendSlider.addEventListener('input',()=>{blendVal.textContent=blendSlider.value});
blendSlider.addEventListener('change',()=>{
  setBiomeBlend(parseInt(blendSlider.value));
  rebuildAllChunks();
});

document.getElementById('btn-respawn').addEventListener('click',()=>{
  spawnPlayer();
  updateHealthBar();
  updateHungerBar();
  document.getElementById('death-screen').style.display='none';
  renderer.domElement.requestPointerLock().catch(()=>{});
});
document.getElementById('btn-title').addEventListener('click',()=>{location.reload()});

// Trash slot — deletes held item (creative only)
const trashSlot=document.getElementById('trash-slot');
if(trashSlot){
  trashSlot.addEventListener('mouseenter',()=>{if(gamemode==='creative')trashSlot.classList.add('hover')});
  trashSlot.addEventListener('mouseleave',()=>{trashSlot.classList.remove('hover')});
  trashSlot.addEventListener('mousedown',e=>{
    e.preventDefault();
    e.stopPropagation();
    if(gamemode!=='creative')return;
    if(cursorItem){
      setCursorItem(null);
      updateCursorDisplay();
    }
  });
}

let lastTime=performance.now(),chunkUpdateTimer=0,heldBob=0,footstepTimer=0;

function animate(){
  requestAnimationFrame(animate);
  const now=performance.now();
  let dt=(now-lastTime)/1000;dt=Math.min(dt,.05);
  lastTime=now;

  updateDayNight(dt);
  updateParticles(dt);
  updateFurnaces(dt);

  if(isInventoryOpen()||isCraftingOpen()||isFurnaceOpen()||isChestOpen()||
     document.getElementById('gamemode-menu').style.display==='block'||
     document.getElementById('settings-menu').style.display==='block'||
     document.getElementById('death-screen').style.display==='flex'){
    renderer.setViewport(0,0,renderer.domElement.clientWidth,renderer.domElement.clientHeight);
    renderer.render(scene,camera);
    return;
  }

  player.sneaking=!!keys['ShiftLeft']||!!keys['ShiftRight'];
  player.sprinting=(!!keys['ControlLeft']||!!keys['ControlRight'])&&!player.sneaking&&!player.flying;
  const forward=new THREE.Vector3(-Math.sin(player.yaw),0,-Math.cos(player.yaw));
  const right=new THREE.Vector3(Math.cos(player.yaw),0,-Math.sin(player.yaw));
  const move=new THREE.Vector3();
  if(keys['KeyW'])move.add(forward);
  if(keys['KeyS'])move.sub(forward);
  if(keys['KeyA'])move.sub(right);
  if(keys['KeyD'])move.add(right);
  if(move.length()>0)move.normalize();
  const isMoving=move.length()>0;

  if(player.flying){
    player.vel.x=move.x*12;player.vel.z=move.z*12;player.vel.y=0;
    if(keys['Space'])player.vel.y=12;
    if(keys['ShiftLeft']||keys['ShiftRight'])player.vel.y=-12;
  }else{
    let speed=6;
    if(player.sneaking)speed=2.5;
    else if(player.sprinting)speed=9;
    player.vel.x=move.x*speed;
    player.vel.z=move.z*speed;
    player.vel.y-=25*dt;
    if(keys['Space']&&player.onGround){player.vel.y=9;player.onGround=false}
  }

  let newX=player.pos.x+player.vel.x*dt;
  if(!isSolid(newX,player.pos.y,player.pos.z)&&!isSolid(newX,player.pos.y+1.6,player.pos.z))player.pos.x=newX;
  else player.vel.x=0;

  let newZ=player.pos.z+player.vel.z*dt;
  if(!isSolid(player.pos.x,player.pos.y,newZ)&&!isSolid(player.pos.x,player.pos.y+1.6,newZ))player.pos.z=newZ;
  else player.vel.z=0;

  let newY=player.pos.y+player.vel.y*dt;
  player.onGround=false;
  if(player.flying)player.pos.y=newY;
  else if(player.vel.y<=0){
    if(isSolid(player.pos.x,newY,player.pos.z)){player.pos.y=Math.floor(newY)+1;player.vel.y=0;player.onGround=true}
    else player.pos.y=newY;
  }else{
    if(isSolid(player.pos.x,newY+1.8,player.pos.z))player.vel.y=0;
    else player.pos.y=newY;
  }

  updateFallDamage(dt);
  updateHunger(dt);

  if(isMoving&&player.onGround&&!player.flying){
    const interval=player.sprinting?.32:.52;
    footstepTimer-=dt;
    if(footstepTimer<=0){footstepTimer=interval;playSound(soundFootstep)}
  }else footstepTimer=0;

  updateMining(dt);
  updateMobs(dt);

  chunkUpdateTimer+=dt;
  if(chunkUpdateTimer>.2){chunkUpdateTimer=0;ensureChunksAround(player.pos.x,player.pos.z)}
  processChunkQueues();

  const eyeH=player.sneaking?1.35:1.6;
  camera.position.copy(player.pos);
  camera.position.y+=eyeH;
  camera.rotation.order='YXZ';
  camera.rotation.y=player.yaw;
  camera.rotation.x=player.pitch;

  const camInside=isSolid(camera.position.x,camera.position.y,camera.position.z);
  document.getElementById('blackout').style.opacity=camInside?'1':'0';

  if(highlightBox){
    const target=getTargetedBlock();
    if(target){highlightBox.position.set(target.x+.5,target.y+.5,target.z+.5);highlightBox.visible=true}
    else highlightBox.visible=false;
  }

  const biomeNames=['Plains','Forest','Mountain','Desert','Snowy Plains','Old Growth Forest'];
  const bi=getBiome(Math.floor(player.pos.x),Math.floor(player.pos.z));
  const bEl=document.getElementById('biome-state');
  if(bEl)bEl.textContent=`Biome: ${biomeNames[bi]||'?'}${player.flying?' · FLYING':''}`;

  const iEl=document.getElementById('info');
  if(iEl)iEl.innerHTML=`Late Alpha 1.0.9 | Seed: ${SEED} | X: ${player.pos.x.toFixed(1)} Y: ${player.pos.y.toFixed(1)} Z: ${player.pos.z.toFixed(1)} | Mobs: ${mobs.length}`;

  renderer.setViewport(0,0,renderer.domElement.clientWidth,renderer.domElement.clientHeight);
  renderer.render(scene,camera);

  if(heldMesh){
    heldBob+=dt*(isMoving?(player.sprinting?14:9):2);
    heldMesh.position.y=Math.sin(heldBob)*.03;
    heldMesh.rotation.z=.1+Math.sin(heldBob*.5)*.05;
    const w=renderer.domElement.clientWidth,h=renderer.domElement.clientHeight;
    const size=Math.min(w,h)*.18;
    const x=w-size-20,y=h-size-90;
    renderer.setViewport(x,y,size,size);
    renderer.setScissor(x,y,size,size);
    renderer.setScissorTest(true);
    renderer.clearDepth();
    renderer.render(heldScene,heldCamera);
    renderer.setScissorTest(false);
    renderer.setViewport(0,0,w,h);
  }
}

loadAllTextures(async ()=>{
  await loadAllModels();
  document.getElementById('info').innerHTML='Textures loaded! Click to play.';
  rebuildHotbar();
  spawnPlayer();
  ensureChunksAround(player.pos.x,player.pos.z);
  for(let i=0;i<5;i++)trySpawnCows(0,0);
  updateHealthBar();
  updateHungerBar();
  updateHeldItem();
  setupInput();
  animate();
});