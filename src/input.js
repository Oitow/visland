// Controls for keyboard and mouse, and for touch screens: a joystick under the left thumb, looking with the right,
// and buttons to jump, dig and build.

export class Input {
  constructor(canvas, ui, actions) {
    this.canvas = canvas;
    this.actions = actions; // { dig(), build(), select(i), cycle(d) }
    this.keys = new Set();
    this.look = [0, 0];
    this.stick = [0, 0];
    this.jumpHeld = false;
    this.digHeld = false;
    this.digTimer = 0;
    this.enabled = false;
    this.touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    document.body.classList.toggle('touch', this.touch);
    this.keyboard();
    if (this.touch) this.touchControls(ui);
    else this.mouse();
  }

  keyboard() {
    addEventListener('keydown', (e) => {
      if (!this.enabled || e.target.tagName === 'INPUT') return;
      this.keys.add(e.code);
      if (e.code.startsWith('Digit')) this.actions.select(+e.code.slice(5) - 1);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  mouse() {
    const c = this.canvas;
    let drag = null;
    const locked = () => document.pointerLockElement === c;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!locked() && !this.noLock) {
        c.requestPointerLock?.();
        // some pages (inside frames) may not lock the pointer: then dragging looks, and a click acts
        setTimeout(() => {
          if (!locked()) this.noLock = true;
        }, 400);
        return;
      }
      if (locked()) this.press(e.button);
      else drag = { x: e.clientX, y: e.clientY, moved: 0, button: e.button };
    });
    addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (locked()) {
        this.look[0] += e.movementX * 0.0025;
        this.look[1] += e.movementY * 0.0025;
      } else if (drag) {
        const dx = e.clientX - drag.x,
          dy = e.clientY - drag.y;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        drag.x = e.clientX;
        drag.y = e.clientY;
        this.look[0] += dx * 0.005;
        this.look[1] += dy * 0.005;
      }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.digHeld = false;
      if (drag && drag.moved < 6) this.press(drag.button, true);
      drag = null;
    });
    c.addEventListener(
      'wheel',
      (e) => {
        if (this.enabled) this.actions.cycle(Math.sign(e.deltaY));
      },
      { passive: true },
    );
  }

  press(button, once = false) {
    if (button === 0) {
      this.actions.dig();
      this.digHeld = !once;
      this.digTimer = 0.28;
    } else if (button === 2) this.actions.build();
  }

  touchControls(ui) {
    const base = ui.stickBase,
      knob = ui.stickKnob;
    let stickId = null,
      lookId = null,
      origin = [0, 0],
      last = [0, 0];
    const R = 56;
    const layer = ui.touchLayer;
    layer.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      if (e.clientX < innerWidth * 0.45 && stickId === null) {
        stickId = e.pointerId;
        origin = [e.clientX, e.clientY];
        base.style.transform = `translate(${e.clientX - R}px, ${e.clientY - R}px)`;
        knob.style.transform = `translate(${e.clientX - 24}px, ${e.clientY - 24}px)`;
        base.classList.add('on');
        knob.classList.add('on');
      } else if (lookId === null) {
        lookId = e.pointerId;
        last = [e.clientX, e.clientY];
      }
      layer.setPointerCapture(e.pointerId);
    });
    layer.addEventListener('pointermove', (e) => {
      if (e.pointerId === stickId) {
        let dx = e.clientX - origin[0],
          dy = e.clientY - origin[1];
        const d = Math.hypot(dx, dy);
        if (d > R) {
          dx *= R / d;
          dy *= R / d;
        }
        this.stick = [dx / R, -dy / R];
        knob.style.transform = `translate(${origin[0] + dx - 24}px, ${origin[1] + dy - 24}px)`;
      } else if (e.pointerId === lookId) {
        this.look[0] += (e.clientX - last[0]) * 0.0065;
        this.look[1] += (e.clientY - last[1]) * 0.0065;
        last = [e.clientX, e.clientY];
      }
    });
    const end = (e) => {
      if (e.pointerId === stickId) {
        stickId = null;
        this.stick = [0, 0];
        base.classList.remove('on');
        knob.classList.remove('on');
      }
      if (e.pointerId === lookId) lookId = null;
    };
    layer.addEventListener('pointerup', end);
    layer.addEventListener('pointercancel', end);

    const hold = (el, down, up) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.add('down');
        down();
      });
      const release = () => {
        el.classList.remove('down');
        up?.();
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('pointerleave', release);
    };
    hold(ui.btnJump, () => (this.jumpHeld = true), () => (this.jumpHeld = false));
    hold(ui.btnDig, () => this.press(0), () => (this.digHeld = false));
    hold(ui.btnBuild, () => this.press(2));
  }

  // what the player wants to do this moment
  state(dt) {
    const k = this.keys;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
      z = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const n = Math.hypot(x, z);
    if (n > 1) {
      x /= n;
      z /= n;
    }
    if (this.touch) {
      x += this.stick[0];
      z += this.stick[1];
    }
    if (this.digHeld) {
      this.digTimer -= dt;
      if (this.digTimer <= 0) {
        this.digTimer = 0.28;
        this.actions.dig();
      }
    }
    return {
      x,
      z,
      jump: k.has('Space') || this.jumpHeld,
      sprint: k.has('ShiftLeft') || k.has('ShiftRight') || Math.hypot(...this.stick) > 0.95,
    };
  }

  takeLook() {
    const l = this.look;
    this.look = [0, 0];
    return l;
  }
}
