/*
 * rv-level-card: top-down Class C motorhome with a level ball.
 *
 * Reads the raw axis sensors from the LevelMate Pro integration by timsys512
 * (https://github.com/timsys512/home-assistant-levelmate), in inches:
 *   front: < 0 = front HIGH,  > 0 = front LOW
 *   side:  > 0 = passenger LOW (driver high), < 0 = driver LOW
 * mode "ball" (default): ball rolls DOWNHILL toward the low side.
 * mode "bubble": like a bubble level, it floats toward the HIGH side.
 *
 * type: custom:rv-level-card
 * front_entity: sensor.xxx_raw_front_reading
 * side_entity:  sensor.xxx_raw_side_reading
 * corners: {driver_front, passenger_front, driver_back, passenger_back}  (optional sensor ids)
 * connection_entity: switch.xxx_bluetooth_connection   (optional)
 * title, mode (ball|bubble), max_inches (default 6), level_tolerance (default 0.5)
 */
const VERSION = "0.5.1";

class RvLevelCard extends HTMLElement {
  setConfig(config) {
    if (!config.front_entity || !config.side_entity) {
      throw new Error("front_entity and side_entity are required");
    }
    this._config = {
      title: "Level",
      mode: "ball",
      max_inches: 6,
      level_tolerance: 0.5,
      corners: {},
      ...config,
    };
    this._built = false;
  }

  getCardSize() { return 8; }
  getGridOptions() { return { columns: 6, min_columns: 4, rows: "auto" }; }

  static getStubConfig(hass) {
    const ids = Object.keys(hass.states);
    // Pre-fill from the LevelMate Pro integration's entities when present.
    const front = ids.find((e) => e.startsWith("sensor.") && e.endsWith("raw_front_reading")) || "";
    const base = front.replace(/^sensor\./, "").replace(/raw_front_reading$/, "");
    const has = (id) => (hass.states[id] ? id : undefined);
    const cfg = {
      title: "Level",
      front_entity: front,
      side_entity: has(`sensor.${base}raw_side_reading`) || "",
    };
    const sw = has(`switch.${base}bluetooth_connection`);
    if (sw) cfg.connection_entity = sw;
    const corners = {};
    for (const k of ["driver_front", "passenger_front", "driver_back", "passenger_back"]) {
      const id = has(`sensor.${base}${k}_corner`);
      if (id) corners[k] = id;
    }
    if (Object.keys(corners).length) cfg.corners = corners;
    return cfg;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._built) this._build();
    this._update();
  }

  _num(id) {
    const s = id && this._hass.states[id];
    if (!s || s.state === "unavailable" || s.state === "unknown") return null;
    const v = parseFloat(s.state);
    return Number.isFinite(v) ? v : null;
  }

  _build() {
    const c = this._config;
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        ha-card { padding: 12px 12px 8px; }
        .head { display:flex; justify-content:space-between; align-items:baseline; margin: 0 4px 4px; }
        .title { font-size: 1.15em; font-weight: 500; color: var(--primary-text-color); }
        .status { font-size: 0.9em; font-weight: 500; }
        .right { display:flex; align-items:center; gap: 10px; }
        .recon { display:inline-flex; align-items:center; gap:4px; border: 1px solid var(--divider-color, #ccc);
                 background: transparent; color: var(--primary-color); border-radius: 16px; padding: 3px 10px 3px 6px;
                 font: 500 0.85em var(--ha-font-family-body, sans-serif); cursor: pointer; }
        .recon:hover { background: var(--secondary-background-color); }
        .recon[disabled] { opacity: .5; cursor: default; }
        .recon ha-icon { --mdc-icon-size: 16px; }
        svg { width: 100%; max-height: 520px; display:block; }
        .body { fill: var(--secondary-background-color, #eef0f2); stroke: var(--primary-text-color); stroke-width: 2.5; stroke-linejoin: round; }
        .detail { fill: none; stroke: var(--secondary-text-color); stroke-width: 1.5; opacity: .7; }
        .solid { fill: var(--secondary-text-color); opacity: .35; }
        .glass { fill: var(--primary-color); opacity: .25; stroke: var(--secondary-text-color); stroke-width: 1.2; }
        .tire { fill: var(--primary-text-color); opacity: .85; }
        .ring { fill: var(--card-background-color, #fff); stroke: var(--divider-color, #bbb); stroke-width: 2; }
        .tol { fill: var(--success-color, #43a047); opacity: .15; stroke: var(--success-color, #43a047); stroke-width: 1.5; }
        .cross { stroke: var(--divider-color, #bbb); stroke-width: 1; stroke-dasharray: 3 3; }
        .ball { transition: transform .6s cubic-bezier(.3,1.4,.5,1), fill .4s; stroke: rgba(0,0,0,.35); stroke-width: 1.5; }
        .shine { fill: #fff; opacity: .45; transition: transform .6s cubic-bezier(.3,1.4,.5,1); pointer-events:none; }
        .lbl { fill: var(--secondary-text-color); font: 600 11px sans-serif; text-anchor: middle; letter-spacing: .08em; }
        .cval { font: 600 14px sans-serif; text-anchor: middle; }
        .cname { fill: var(--secondary-text-color); font: 10px sans-serif; text-anchor: middle; }
        .axis { display:flex; justify-content:space-around; color: var(--secondary-text-color); font-size: .9em; margin-top: 2px; }
        .axis b { color: var(--primary-text-color); font-weight: 500; }
        .when { margin: -2px 4px 0; font-size: .85em; color: var(--secondary-text-color); }
        .when:empty { display: none; }
        .off { opacity: .55; filter: grayscale(.6); }
      </style>
      <ha-card>
        <div class="head"><span class="title"></span><span class="right"><span class="status"></span><button class="recon" title="Reload the LevelMate integration and reconnect"><ha-icon icon="mdi:bluetooth-connect"></ha-icon><span class="rl">Reconnect</span></button></span></div>
        <div class="when"></div>
        <svg viewBox="0 0 300 470" role="img" aria-label="RV level">
          <text class="lbl" x="150" y="14">FRONT</text>
          <!-- front tires (stick out past the hood) -->
          <rect class="tire" x="76" y="62" width="12" height="34" rx="4"/>
          <rect class="tire" x="212" y="62" width="12" height="34" rx="4"/>
          <!-- rear duals -->
          <rect class="tire" x="66" y="322" width="14" height="44" rx="4"/>
          <rect class="tire" x="220" y="322" width="14" height="44" rx="4"/>
          <!-- hood / engine compartment -->
          <path class="body" d="M92 112 L92 52 Q92 26 122 24 L178 24 Q208 26 208 52 L208 112 Z"/>
          <path class="detail" d="M108 34 L192 34"/>
          <!-- windshield peeking out under the cabover -->
          <path class="glass" d="M88 100 Q150 88 212 100 L212 116 L88 116 Z"/>
          <!-- mirrors -->
          <path class="body" d="M78 112 L60 104 L58 116 L78 120 Z"/>
          <path class="body" d="M222 112 L240 104 L242 116 L222 120 Z"/>
          <!-- house box with rounded cabover nose -->
          <path class="body" d="M80 140 Q80 108 112 106 L188 106 Q220 108 220 140 L220 430 Q220 446 204 446 L96 446 Q80 446 80 430 Z"/>
          <!-- cabover roof seam -->
          <path class="detail" d="M84 150 Q150 138 216 150"/>
          <!-- roof gear: vents, AC, ladder -->
          <rect class="solid" x="136" y="160" width="28" height="22" rx="3"/>
          <rect class="detail" x="128" y="380" width="44" height="34" rx="5"/>
          <rect class="solid" x="136" y="388" width="28" height="18" rx="3"/>
          <rect class="detail" x="96" y="400" width="18" height="18" rx="2"/>
          <path class="detail" d="M196 420 L196 446 M206 420 L206 446 M196 426 L206 426 M196 434 L206 434 M196 442 L206 442"/>
          <text class="lbl" x="150" y="464">REAR</text>
          <!-- level target -->
          <circle class="ring" cx="150" cy="270" r="62"/>
          <circle class="tol" cx="150" cy="270" r="6"/>
          <line class="cross" x1="88" y1="270" x2="212" y2="270"/>
          <line class="cross" x1="150" y1="208" x2="150" y2="332"/>
          <circle class="ring" cx="150" cy="270" r="31" style="fill:none"/>
          <circle class="ball" cx="150" cy="270" r="15"/>
          <circle class="shine" cx="145" cy="265" r="4.5"/>
          <!-- corner readouts -->
          <g class="corner" data-k="driver_front"><text class="cval" x="34" y="78"></text><text class="cname" x="34" y="92">DRIVER</text></g>
          <g class="corner" data-k="passenger_front"><text class="cval" x="266" y="78"></text><text class="cname" x="266" y="92">PASS.</text></g>
          <g class="corner" data-k="driver_back"><text class="cval" x="34" y="344"></text><text class="cname" x="34" y="358">DRIVER</text></g>
          <g class="corner" data-k="passenger_back"><text class="cval" x="266" y="344"></text><text class="cname" x="266" y="358">PASS.</text></g>
        </svg>
        <div class="axis"><span>Pitch <b class="fv">–</b></span><span>Roll <b class="sv">–</b></span></div>
      </ha-card>`;
    this._el = {
      title: root.querySelector(".title"),
      status: root.querySelector(".status"),
      ball: root.querySelector(".ball"),
      shine: root.querySelector(".shine"),
      tol: root.querySelector(".tol"),
      fv: root.querySelector(".fv"),
      sv: root.querySelector(".sv"),
      svg: root.querySelector("svg"),
      corners: [...root.querySelectorAll(".corner")],
      card: root.querySelector("ha-card"),
      when: root.querySelector(".when"),
    };
    this._el.title.textContent = c.title;
    const btn = root.querySelector(".recon"), rl = root.querySelector(".rl");
    this._el.btn = btn; this._el.rl = rl; this._el.bicon = root.querySelector(".recon ha-icon");
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation(); // don't open more-info
      const disconnecting = this._connected && c.connection_entity;
      this._busy = true; btn.disabled = true;
      rl.textContent = disconnecting ? "Disconnecting…" : "Reconnecting…";
      try {
        if (disconnecting) {
          // Integration's switch: off = release the BLE link (phone app can connect).
          await this._hass.callService("switch", "turn_off", { entity_id: c.connection_entity });
        } else {
          // Reload the config entry that owns front_entity: recovers a dropped link,
          // a paused link, and a failed setup (LevelMate was off when HA started).
          await this._hass.callService("homeassistant", "reload_config_entry", { entity_id: c.front_entity });
        }
        rl.textContent = "Done";
      } catch (err) {
        rl.textContent = "Failed";
        console.warn("rv-level-card connection action failed", err);
      }
      setTimeout(() => { this._busy = false; btn.disabled = false; this._update(); }, 3000);
    });
    this._el.card.addEventListener("click", () => {
      const ev = new Event("hass-more-info", { bubbles: true, composed: true });
      ev.detail = { entityId: c.front_entity };
      this.dispatchEvent(ev);
    });
    this._built = true;
  }

  async _fetchLast() {
    // Last good readings from HA's recorder, so every device shows the same values.
    const c = this._config;
    const ids = [c.front_entity, c.side_entity, ...Object.values(c.corners || {})].filter(Boolean);
    this._fetching = true;
    try {
      const start = new Date(Date.now() - (c.history_days || 30) * 864e5).toISOString();
      const res = await this._hass.callWS({
        type: "history/history_during_period", start_time: start, entity_ids: ids,
        minimal_response: true, no_attributes: true, significant_changes_only: false,
      });
      const lastNum = (id) => {
        const rows = (res && res[id]) || [];
        for (let i = rows.length - 1; i >= 0; i--) {
          const v = parseFloat(rows[i].s);
          if (Number.isFinite(v)) return { v, t: (rows[i].lu || rows[i].lc) * 1000 };
        }
        return null;
      };
      const f = lastNum(c.front_entity), sd = lastNum(c.side_entity);
      if (f && sd) {
        const corners = {};
        for (const [k, id] of Object.entries(c.corners || {})) { const r = lastNum(id); corners[k] = r ? r.v : null; }
        this._last = { front: f.v, side: sd.v, corners, t: Math.max(f.t, sd.t) };
      } else {
        this._last = { none: true };
      }
    } catch (err) {
      console.warn("rv-level-card history fetch failed", err);
      this._last = { none: true };
    }
    this._fetching = false;
    if (this._hass) this._update();
  }

  _when(t) {
    const d = new Date(t), now = new Date();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (d.toDateString() === now.toDateString()) return time;
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
  }

  _update() {
    const c = this._config, e = this._el;
    const R = 62 - 15; // travel radius
    const tolPx = Math.max(4, Math.min(R, (c.level_tolerance / c.max_inches) * R)) + 15;
    e.tol.setAttribute("r", tolPx);

    const conn = c.connection_entity && this._hass.states[c.connection_entity];
    const liveFront = this._num(c.front_entity), liveSide = this._num(c.side_entity);
    this._connected = liveFront !== null && liveSide !== null;
    if (!this._busy) {
      const disc = this._connected && c.connection_entity;
      e.rl.textContent = disc ? "Disconnect" : "Reconnect";
      e.bicon.setAttribute("icon", disc ? "mdi:bluetooth-off" : "mdi:bluetooth-connect");
      e.btn.title = disc
        ? "Release the Bluetooth link so the LevelMate app can connect"
        : "Reload the LevelMate integration and reconnect";
    }

    let front, side, cornerVal, stale = false;
    if (this._connected) {
      this._last = null; // refetch next time it drops
      front = liveFront; side = liveSide;
      cornerVal = (k) => this._num(c.corners[k]);
    } else {
      if (!this._last && !this._fetching) this._fetchLast();
      const L = this._last;
      if (!L || L.none) {
        e.ball.style.transform = e.shine.style.transform = "translate(0px,0px)";
        e.ball.style.fill = "var(--disabled-color, #9e9e9e)";
        e.status.textContent = conn && conn.state === "off" ? "Disconnected" : "LevelMate off";
        e.status.style.color = "var(--secondary-text-color)";
        e.svg.classList.add("off");
        e.fv.textContent = e.sv.textContent = "–";
        e.corners.forEach((g) => (g.querySelector(".cval").textContent = ""));
        e.when.textContent = "";
        return;
      }
      stale = true; front = L.front; side = L.side;
      cornerVal = (k) => (L.corners[k] ?? null);
    }
    e.svg.classList.toggle("off", stale);

    // downhill vector in screen coords (x right = passenger, y down = rear)
    const sign = c.mode === "bubble" ? -1 : 1;
    let px = ((sign * side) / c.max_inches) * R;      // side > 0: passenger low -> right
    let py = ((sign * -front) / c.max_inches) * R;    // front > 0: front low -> up (forward)
    const mag = Math.hypot(px, py);
    if (mag > R) { px *= R / mag; py *= R / mag; }
    e.ball.style.transform = e.shine.style.transform = `translate(${px}px,${py}px)`;

    const worst = Math.max(Math.abs(front), Math.abs(side));
    const tol = c.level_tolerance;
    let color, label;
    if (worst <= tol) { color = "var(--success-color, #43a047)"; label = "Level"; }
    else if (worst <= tol * 4) { color = "var(--warning-color, #ffa000)"; label = "Close"; }
    else { color = "var(--error-color, #e53935)"; label = "Not level"; }
    e.ball.style.fill = color;
    if (stale) {
      e.status.textContent = label;
      e.when.textContent = `Last reading ${this._when(this._last.t)} · not connected`;
      e.status.style.color = "var(--secondary-text-color)";
    } else {
      e.status.textContent = label;
      e.status.style.color = color;
      e.when.textContent = "";
    }

    const fmt = (v) => `${Math.abs(v).toFixed(2).replace(/\.?0+$/, "")}"`;
    e.fv.textContent = Math.abs(front) <= tol ? "level" : `${front > 0 ? "front" : "rear"} ${fmt(front)} low`;
    e.sv.textContent = Math.abs(side) <= tol ? "level" : `${side > 0 ? "pass." : "driver"} ${fmt(side)} low`;

    e.corners.forEach((g) => {
      const v = cornerVal(g.dataset.k);
      const t = g.querySelector(".cval");
      if (v === null || v === undefined) { t.textContent = ""; return; }
      t.textContent = v <= tol ? "✓" : `+${fmt(v)}`;
      t.style.fill = v <= tol ? "var(--success-color, #43a047)" : "var(--primary-text-color)";
    });
  }
}

customElements.define("rv-level-card", RvLevelCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "rv-level-card",
  name: "RV Level Card",
  description: "Top-down Class C RV with a level ball driven by LevelMate Pro sensors",
});
console.info(`%c RV-LEVEL-CARD %c ${VERSION} `, "background:#2e7d32;color:#fff", "");
