import { BLOCK, ITEM, ITEM_INFO, isItem } from './config.js';
import {
  player, inventory, selectedIndex, setSelectedIndex, keys, gamemode, mobs, getIsNightTime
} from './core.js';
import {
  getTargetedBlock, startBreaking, setBreaking, placeBlockAt, isSolid
} from './mining.js';
import { getTargetedMob } from './mobs.js';
import { addToInventory, removeFromInventory, rebuildHotbar } from './inventory.js';
import { openCraftingTable, openInventory, closeInventory, isInventoryOpen, isCraftingOpen } from './crafting.js';
import { openFurnaceUI, isFurnaceOpen, closeFurnaceUI } from './furnace.js';
import { openChestUI, isChestOpen, closeChestUI } from './chest.js';
import { toggleMusic, playSound, soundHit } from './audio.js';
import { setWorldTimeGlobal } from './daynight.js';

export let mouseLook = false;
export let leftMouseDown = false;

// Touch UI constants
const JOY_DEADZONE = 0.15;
const JOY_SNEAK_MIN = 0.1;
const JOY_SNEAK_MAX = 0.35;
const JOY_SPRINT_MIN = 0.85;
const JUMP_DOUBLE_TAP_MS = 300;

// Touch state
let joyPointerId = null;
let joyCenterX = 0, joyCenterY = 0, joyRadius = 0;
let joyDX = 0, joyDY = 0;

let lookPointerId = null;
let lookLastX = 0, lookLastY = 0;
let lookMoveX = 0, lookMoveY = 0;

let breakPointerId = null;
let breakHeld = false;

let lastJumpTap = 0;
let jumpHeld = false;

function anyPanelOpen() {
  return isInventoryOpen() || isCraftingOpen() || isFurnaceOpen() || isChestOpen() ||
    document.getElementById('gamemode-menu').style.display === 'block' ||
    document.getElementById('settings-menu').style.display === 'block';
}

function closeAllPanels() {
  if (isFurnaceOpen()) closeFurnaceUI();
  if (isChestOpen()) closeChestUI();
  if (isInventoryOpen() || isCraftingOpen()) closeInventory();
}

function resetJoystick() {
  joyPointerId = null;
  joyDX = 0;
  joyDY = 0;
  const knob = document.getElementById('joystick-knob');
  if (knob) knob.style.transform = 'translate(0,0)';
}

function resetLook() {
  lookPointerId = null;
}

function handleBreakHold() {
  if (!breakHeld) return;
  if (anyPanelOpen()) { breakHeld = false; return; }
  if (player.health <= 0) return;

  const mob = getTargetedMob();
  if (mob) {
    const killed = mob.damage(2, player.pos.x, player.pos.z);
    playSound(soundHit);
    if (killed) {
      const i = mobs.indexOf(mob);
      if (i >= 0) mobs.splice(i, 1);
      if (mob.type === 'zombie') addToInventory(ITEM.ROTTEN_FLESH, 1 + Math.floor(Math.random() * 2));
      else addToInventory(ITEM.BEEF, 1 + Math.floor(Math.random() * 2));
    }
    return;
  }

  const target = getTargetedBlock();
  if (target) {
    // In creative, this breaks instantly. In survival, start the timed break.
    startBreaking(target);
  }
}

function handlePlace() {
  if (anyPanelOpen()) return;
  if (player.health <= 0) return;

  const target = getTargetedBlock();
  if (!target) return;
  const pb = target.block;

  if (pb === BLOCK.CRAFTING_TABLE) { openCraftingTable(target.x, target.y, target.z); return; }
  if (pb === BLOCK.FURNACE || pb === BLOCK.WORKING_FURNACE) { openFurnaceUI(target.x, target.y, target.z); return; }
  if (pb === BLOCK.CHEST) { openChestUI(target.x, target.y, target.z); return; }
  if (pb === BLOCK.BED_FOOT || pb === BLOCK.BED_HEAD) {
    if (getIsNightTime()) {
      player.health = player.maxHealth;
      player.hunger = Math.max(player.hunger, 10);
      setWorldTimeGlobal(600 * 0.25);
    }
    return;
  }

  const selectedItem = inventory[selectedIndex];
  const bid = selectedItem && selectedItem.id !== null && selectedItem.id !== undefined ? selectedItem.id : null;
  if (bid === null) return;

  if (bid === ITEM.BEEF || bid === ITEM.STEAK || bid === ITEM.ROTTEN_FLESH) {
    if (gamemode === 'survival') {
      if (player.hunger < player.maxHunger) {
        player.hunger = Math.min(player.maxHunger, player.hunger + ITEM_INFO[bid].food);
        removeFromInventory(bid, 1);
      }
    }
    return;
  }
  if (isItem(bid)) return;
  placeBlockAt(target.placeX, target.placeY, target.placeZ, bid);
}

export function setupInput() {
  const joyEl = document.getElementById('joystick');
  const knobEl = document.getElementById('joystick-knob');
  const canvas = document.querySelector('canvas');

  // ============ JOYSTICK ============
  joyEl.addEventListener('pointerdown', e => {
    if (joyPointerId !== null) return;
    e.preventDefault();
    e.stopPropagation();
    try { joyEl.setPointerCapture(e.pointerId); } catch (_) {}
    joyPointerId = e.pointerId;
    const rect = joyEl.getBoundingClientRect();
    joyCenterX = rect.left + rect.width / 2;
    joyCenterY = rect.top + rect.height / 2;
    joyRadius = rect.width / 2;
  });

  joyEl.addEventListener('pointermove', e => {
    if (e.pointerId !== joyPointerId) return;
    e.preventDefault();
    let dx = e.clientX - joyCenterX;
    let dy = e.clientY - joyCenterY;
    const dist = Math.hypot(dx, dy);
    if (dist > joyRadius) {
      dx = dx / dist * joyRadius;
      dy = dy / dist * joyRadius;
    }
    if (knobEl) knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
    joyDX = dx / joyRadius;
    joyDY = dy / joyRadius;
  });

  const releaseJoy = e => {
    if (e.pointerId !== joyPointerId) return;
    resetJoystick();
  };
  joyEl.addEventListener('pointerup', releaseJoy);
  joyEl.addEventListener('pointercancel', releaseJoy);
  joyEl.addEventListener('lostpointercapture', releaseJoy);

  // ============ LOOK-DRAG (anywhere on canvas) ============
  canvas.addEventListener('pointerdown', e => {
    if (lookPointerId !== null) return;
    if (anyPanelOpen()) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    lookPointerId = e.pointerId;
    lookLastX = e.clientX;
    lookLastY = e.clientY;
  });

  canvas.addEventListener('pointermove', e => {
    if (e.pointerId !== lookPointerId) return;
    lookMoveX += (e.clientX - lookLastX) * 2;
    lookMoveY += (e.clientY - lookLastY) * 2;
    lookLastX = e.clientX;
    lookLastY = e.clientY;
  });

  const releaseLook = e => {
    if (e.pointerId === lookPointerId) resetLook();
  };
  canvas.addEventListener('pointerup', releaseLook);
  canvas.addEventListener('pointercancel', releaseLook);
  canvas.addEventListener('lostpointercapture', releaseLook);

  // ============ BUTTONS ============
  const btnBreak = document.getElementById('btn-break');
  btnBreak.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    if (anyPanelOpen()) return;
    breakPointerId = e.pointerId;
    breakHeld = true;
    leftMouseDown = true;
    handleBreakHold();
  });
  const releaseBreak = e => {
    if (e.pointerId !== breakPointerId) return;
    breakPointerId = null;
    breakHeld = false;
    leftMouseDown = false;
    setBreaking(false);
    const mb = document.getElementById('mining-bar-container');
    if (mb) mb.style.display = 'none';
  };
  btnBreak.addEventListener('pointerup', releaseBreak);
  btnBreak.addEventListener('pointercancel', releaseBreak);

  const btnPlace = document.getElementById('btn-place');
  btnPlace.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    handlePlace();
  });

  const btnJump = document.getElementById('btn-jump');
  btnJump.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    if (anyPanelOpen()) return;
    const now = performance.now();
    if (gamemode === 'creative' && now - lastJumpTap < JUMP_DOUBLE_TAP_MS) {
      player.flying = !player.flying;
      player.vel.y = 0;
    } else {
      jumpHeld = true;
    }
    lastJumpTap = now;
  });
  const releaseJump = e => {
    e.preventDefault();
    e.stopPropagation();
    jumpHeld = false;
  };
  btnJump.addEventListener('pointerup', releaseJump);
  btnJump.addEventListener('pointercancel', releaseJump);

  // ============ TOP BUTTONS ============
  const btnInv = document.getElementById('btn-inv');
  btnInv.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    if (anyPanelOpen()) closeAllPanels();
    else openInventory();
  });

  const btnMode = document.getElementById('btn-mode');
  btnMode.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    closeAllPanels();
    import('./ui.js').then(u => u.openGamemodeMenu());
  });

  const btnMusic = document.getElementById('btn-music');
  btnMusic.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    toggleMusic();
  });

  const btnNew = document.getElementById('btn-new');
  btnNew.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    location.reload();
  });

  // ============ HOTBAR TAPS ============
  const hotbarEl = document.getElementById('hotbar');
  hotbarEl.addEventListener('pointerdown', e => {
    const slot = e.target.closest('.slot');
    if (!slot) return;
    const slots = [...hotbarEl.children];
    const index = slots.indexOf(slot);
    if (index >= 0 && index < 9) {
      setSelectedIndex(index);
      rebuildHotbar();
    }
  });

  // ============ BLUR (app lost focus) — reset everything ============
  window.addEventListener('blur', () => {
    resetJoystick();
    resetLook();
    breakHeld = false;
    breakPointerId = null;
    jumpHeld = false;
    leftMouseDown = false;
    setBreaking(false);
  });
}

// ============ INPUT STATE READER ============
// Called by the game loop each frame. Fills `keys` from touch state, so the rest
// of the game (which already reads `keys`) works without modification.

export function updateTouchKeys() {
  // Reset movement keys
  keys['KeyW'] = false;
  keys['KeyS'] = false;
  keys['KeyA'] = false;
  keys['KeyD'] = false;
  keys['ControlLeft'] = false;
  keys['ShiftLeft'] = false;

  // Joystick → movement
  if (joyDY < -JOY_DEADZONE) keys['KeyW'] = true;
  if (joyDY > JOY_DEADZONE) keys['KeyS'] = true;
  if (joyDX < -JOY_DEADZONE) keys['KeyA'] = true;
  if (joyDX > JOY_DEADZONE) keys['KeyD'] = true;

  const mag = Math.hypot(joyDX, joyDY);
  if (mag > JOY_SPRINT_MIN) keys['ControlLeft'] = true;
  else if (mag > JOY_SNEAK_MIN && mag < JOY_SNEAK_MAX) keys['ShiftLeft'] = true;

  // Jump button → Space
  keys['Space'] = jumpHeld;
}

export function consumeLookDelta() {
  const dx = lookMoveX;
  const dy = lookMoveY;
  lookMoveX = 0;
  lookMoveY = 0;
  return { dx, dy };
}