// The screens over the game: the title with its seed, the HUD (crystals, clock, hotbar) and short messages.
import { itemName } from './materials.js';
import { drawItemIcon } from './icons.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    for (const id of [
      'menu',
      'seed',
      'dice',
      'play',
      'resume',
      'hud',
      'menuBtn',
      'seedLabel',
      'crystals',
      'clock',
      'hotbar',
      'toast',
      'blockName',
      'underwater',
      'touchLayer',
      'stickBase',
      'stickKnob',
      'btnJump',
      'btnDig',
      'btnBuild',
      'help',
      'loading',
    ])
      this[id] = $(id);
    this.toastTimer = 0;
    this.nameTimer = 0;
  }

  showMenu(on, playing) {
    this.menu.classList.toggle('hidden', !on);
    this.hud.classList.toggle('hidden', on);
    this.resume.classList.toggle('hidden', !playing);
  }

  hotbarSet(inv, selected, onPick) {
    this.hotbar.innerHTML = '';
    inv.forEach(([block, count], i) => {
      const slot = document.createElement('button');
      slot.className = 'slot' + (i === selected ? ' sel' : '') + (count ? '' : ' empty');
      slot.title = itemName(block);
      const c = document.createElement('canvas');
      c.width = c.height = 40;
      drawItemIcon(c.getContext('2d'), block, 40);
      slot.append(c);
      const n = document.createElement('span');
      n.textContent = count;
      slot.append(n);
      slot.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        onPick(i);
      });
      this.hotbar.append(slot);
    });
    this.hotbar.children[selected]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  toastShow(text, secs = 2.5) {
    this.toast.textContent = text;
    this.toast.classList.add('on');
    this.toastTimer = secs;
  }

  nameShow(text) {
    this.blockName.textContent = text;
    this.blockName.classList.add('on');
    this.nameTimer = 1.4;
  }

  tick(dt) {
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.toast.classList.remove('on');
    if (this.nameTimer > 0 && (this.nameTimer -= dt) <= 0) this.blockName.classList.remove('on');
  }

  setClock(t) {
    const mins = Math.floor(t * 24 * 60),
      h = Math.floor(mins / 60),
      m = mins % 60;
    const icon = t > 0.24 && t < 0.77 ? '☀' : '☾';
    this.clock.textContent = `${icon} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
