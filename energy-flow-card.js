/*!
 * Multi-PV Flow Card
 * A configurable animated energy-flow diagram for Home Assistant Lovelace.
 * Supports any number of individual solar/PV strings, battery, home, grid
 * and an optional "car" node (EV charging), each with its own icon/logo,
 * live power and an optional "today" energy value.
 *
 * https://github.com/JORDANDJ41/ha-energy-flow-card
 * License: MIT
 */

const CARD_VERSION = "1.2.2";

// ---------- helpers ----------

function hasEntity(hass, entityId) {
  return !!entityId && !!hass && !!hass.states[entityId];
}

function getState(hass, entityId) {
  if (!hasEntity(hass, entityId)) return undefined;
  return hass.states[entityId];
}

function numState(hass, entityId) {
  const st = getState(hass, entityId);
  if (!st) return NaN;
  const v = parseFloat(st.state);
  return Number.isNaN(v) ? NaN : v;
}

// Format an instantaneous power value, auto-choosing W / kW based on the
// entity's own unit_of_measurement (so it works whether the source sensor
// already reports in W or kW).
function formatPower(hass, entityId) {
  const st = getState(hass, entityId);
  if (!st) return "—";
  const raw = parseFloat(st.state);
  if (Number.isNaN(raw)) return "—";
  const unit = (st.attributes && st.attributes.unit_of_measurement) || "W";
  let watts = unit.toLowerCase().startsWith("k") ? raw * 1000 : raw;
  const abs = Math.abs(watts);
  if (abs >= 1000) return (watts / 1000).toFixed(2).replace(".", ",") + " kW";
  return Math.round(watts) + " W";
}

function rawWatts(hass, entityId) {
  const st = getState(hass, entityId);
  if (!st) return 0;
  const raw = parseFloat(st.state);
  if (Number.isNaN(raw)) return 0;
  const unit = (st.attributes && st.attributes.unit_of_measurement) || "W";
  return unit.toLowerCase().startsWith("k") ? raw * 1000 : raw;
}

function formatEnergy(hass, entityId) {
  const st = getState(hass, entityId);
  if (!st) return null;
  const raw = parseFloat(st.state);
  if (Number.isNaN(raw)) return null;
  const unit = (st.attributes && st.attributes.unit_of_measurement) || "kWh";
  let kwh = unit.toLowerCase() === "wh" ? raw / 1000 : raw;
  return kwh.toFixed(kwh < 10 ? 2 : 1).replace(".", ",") + " kWh";
}

function formatVoltageCurrent(hass, voltageId, currentId) {
  const parts = [];
  const v = getState(hass, voltageId);
  if (v) {
    const raw = parseFloat(v.state);
    if (!Number.isNaN(raw)) parts.push(raw.toFixed(0) + " V");
  }
  const a = getState(hass, currentId);
  if (a) {
    const raw = parseFloat(a.state);
    if (!Number.isNaN(raw)) parts.push(raw.toFixed(1).replace(".", ",") + " A");
  }
  return parts.join(" · ");
}

// Joins whichever of [entityId, suffix] pairs resolve to a numeric state,
// e.g. formatExtraLine(hass, [[voltageId,"V",0],[freqId,"Hz",1]]) -> "230 V · 50,0 Hz"
function formatExtraLine(hass, pairs) {
  const parts = [];
  pairs.forEach(([entityId, suffix, decimals]) => {
    const st = getState(hass, entityId);
    if (!st) return;
    const raw = parseFloat(st.state);
    if (Number.isNaN(raw)) return;
    parts.push(raw.toFixed(decimals != null ? decimals : 0).replace(".", ",") + " " + suffix);
  });
  return parts.join(" · ");
}

function solarSvg(stroke) {
  return `<g transform="translate(-19 -44) skewX(-8)">
    <rect x="0" y="0" width="38" height="26" rx="2" fill="none" stroke="${stroke}" stroke-width="2"/>
    <line x1="12.7" y1="0" x2="12.7" y2="26" stroke="${stroke}" stroke-width="1.2"/>
    <line x1="25.3" y1="0" x2="25.3" y2="26" stroke="${stroke}" stroke-width="1.2"/>
    <line x1="0" y1="8.7" x2="38" y2="8.7" stroke="${stroke}" stroke-width="1.2"/>
    <line x1="0" y1="17.3" x2="38" y2="17.3" stroke="${stroke}" stroke-width="1.2"/>
  </g>`;
}

const DEFAULT_ICONS = {
  solar: "mdi:white-balance-sunny",
  battery: "mdi:battery-high",
  home: "mdi:home",
  grid: "mdi:transmission-tower",
  car: "mdi:car-electric",
};

// ---------- card ----------

class EnergyFlowCard extends HTMLElement {
  setConfig(config) {
    if (!config) throw new Error("Configuration manquante");
    if (!config.solar && !config.home) {
      throw new Error("Il faut au moins configurer 'solar' ou 'home'.");
    }
    this._config = config;
    this._built = false;
    this._render();
  }

  getCardSize() {
    return 5;
  }

  static getStubConfig(hass) {
    const detected = autoDetectConfig(hass);
    if (detected.solar || detected.pv || detected.home) return detected;
    return {
      type: "custom:energy-flow-card",
      solar: { power: "sensor.solar_power" },
      home: { power: "sensor.home_power" },
    };
  }

  static getConfigElement() {
    return document.createElement("energy-flow-card-editor");
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._render();
    this._update();
  }

  _node(key, icon, label, iconHtml) {
    const cfg = this._config[key] || {};
    const name = cfg.name || label;
    const customIcon = cfg.icon || DEFAULT_ICONS[key];
    let inner;
    if (cfg.image) {
      inner = `<img src="${cfg.image}" alt="${name}" style="width:34px;height:34px;object-fit:contain" />`;
    } else if (iconHtml) {
      inner = iconHtml;
    } else {
      inner = `<ha-icon icon="${customIcon}" style="--mdc-icon-size:30px"></ha-icon>`;
    }
    return { cfg, name, inner };
  }

  _render() {
    if (!this._config) return;
    const pv = Array.isArray(this._config.pv) ? this._config.pv : [];
    const n = pv.length;

    // Layout: pv nodes spread evenly along an arc above the solar node.
    const pvSpots = [];
    if (n === 1) pvSpots.push(320);
    else if (n > 1) {
      const span = Math.min(170 + n * 55, 470);
      const start = 320 - span / 2;
      for (let i = 0; i < n; i++) pvSpots.push(start + (span * i) / (n - 1));
    }
    const topY = 95;
    const solarY = n > 0 ? 205 : 140;
    const midY = solarY + 120;
    const carY = this._config.car ? midY + 140 : null;
    const totalH = (carY || midY) + 110;

    const style = `
      <style>
        :host { display:block; }
        ha-card { padding: 16px 12px 10px; }
        .title { font-size: 1rem; font-weight: 600; color: var(--primary-text-color); margin: 0 4px 8px; }
        svg { width:100%; height:auto; display:block; overflow:visible; }
        .lbl { font-family: var(--paper-font-body1_-_font-family, inherit); font-size:12.5px; fill: var(--secondary-text-color); text-anchor:middle; }
        .val { font-size:16px; font-weight:700; fill: var(--primary-text-color); text-anchor:middle; font-variant-numeric: tabular-nums; }
        .sec { font-size:10.5px; fill: var(--secondary-text-color); text-anchor:middle; font-variant-numeric: tabular-nums; }
        .ring { fill: var(--card-background-color, #1b2340); stroke-width:2.5; cursor:pointer; }
        .ring:hover { filter: brightness(1.15); }
        .ring.alert-ring { stroke: #ef4444 !important; animation: efc-pulse 1.4s ease-in-out infinite; }
        @keyframes efc-pulse { 50% { opacity: .55; } }
        .flow { stroke-width:2.5; fill:none; opacity:.4; }
        .flow-dash { stroke-width:2.5; fill:none; stroke-dasharray:6 10; opacity:0; transition: opacity .3s; }
        .flow-dash.on { opacity:1; animation: efc-dash 1.3s linear infinite; }
        .flow-dash.rev.on { animation-direction: reverse; }
        @keyframes efc-dash { to { stroke-dashoffset: -64; } }
        .legend { display:flex; flex-wrap:wrap; gap:6px 14px; justify-content:center; margin-top:6px; font-size:.68rem; color: var(--secondary-text-color); }
        .legend span { display:inline-flex; align-items:center; gap:5px; }
        .dotkey { width:7px;height:7px;border-radius:50%;display:inline-block; }
        foreignObject ha-icon { color: var(--icon-ring-color, var(--primary-text-color)); }
        @media (prefers-reduced-motion: reduce) { .flow-dash.on { animation:none; } }
      </style>`;

    const colors = {
      solar: "#fbbf24",
      pv: "#fbbf24",
      battery: "#60a5fa",
      home: "#f87171",
      grid: "#c084fc",
      car: "#2dd4bf",
    };

    let svgNodes = "";
    let svgFlows = "";
    const title = this._config.title
      ? `<div class="title">${this._config.title}</div>`
      : "";

    // PV -> solar flows + nodes
    pv.forEach((p, i) => {
      const x = pvSpots[i];
      svgFlows += `
        <path class="flow" stroke="${colors.pv}" d="M${x} ${topY + 35} C ${x} ${topY + 90}, 320 ${solarY - 60}, 320 ${solarY - 42}"/>
        <path class="flow-dash" data-flow="pv${i}" stroke="${colors.pv}" d="M${x} ${topY + 35} C ${x} ${topY + 90}, 320 ${solarY - 60}, 320 ${solarY - 42}"/>`;
      const name = (p.name || `PV${i + 1}`);
      const icon = p.image
        ? `<img x="-17" y="-61" width="34" height="34" href="${p.image}"/>`
        : null;
      svgNodes += `
        <g transform="translate(${x} ${topY})" data-node="pv${i}" data-entity="${p.power || ""}">
          <circle r="58" class="ring" stroke="${colors.pv}"/>
          ${icon ? `<foreignObject x="-20" y="-64" width="40" height="40">${p.image ? `<img src="${p.image}" style="width:100%;height:100%;object-fit:contain"/>` : ""}</foreignObject>` : solarSvg(colors.pv)}
          <text y="4" class="lbl">${name}</text>
          <text y="22" class="val" data-f="pv${i}-power">—</text>
          <text y="37" class="sec" data-f="pv${i}-energy"></text>
          <text y="50" class="sec" data-f="pv${i}-va"></text>
        </g>`;
    });

    // Solar node
    if (this._config.solar) {
      const s = this._config.solar;
      svgNodes += `
        <g transform="translate(320 ${solarY})" data-node="solar" data-entity="${s.power || ""}">
          <circle r="56" class="ring" stroke="${colors.solar}" stroke-width="3"/>
          <foreignObject x="-18" y="-50" width="36" height="36"><ha-icon icon="${s.icon || DEFAULT_ICONS.solar}" style="--mdc-icon-size:30px;color:${colors.solar}"></ha-icon></foreignObject>
          <text y="-18" class="lbl">${s.name || "Solaire"}</text>
          <text y="6" class="val" data-f="solar-power">—</text>
          <text y="25" class="sec" data-f="solar-energy"></text>
        </g>`;
      // solar -> home
      svgFlows += `
        <path class="flow" stroke="${colors.solar}" d="M320 ${solarY + 48} L 320 ${midY - 48}"/>
        <path class="flow-dash" data-flow="solar-home" stroke="${colors.solar}" d="M320 ${solarY + 48} L 320 ${midY - 48}"/>`;
      if (this._config.battery) {
        svgFlows += `
          <path class="flow" stroke="${colors.solar}" d="M${300} ${solarY + 44} C 220 ${solarY + 70}, 170 ${midY - 50}, 150 ${midY - 4}"/>
          <path class="flow-dash" data-flow="solar-battery" stroke="${colors.solar}" d="M${300} ${solarY + 44} C 220 ${solarY + 70}, 170 ${midY - 50}, 150 ${midY - 4}"/>`;
      }
    }

    // Battery
    if (this._config.battery) {
      svgNodes += `
        <g transform="translate(150 ${midY})" data-node="battery" data-entity="${this._config.battery.power || ""}">
          <circle r="60" class="ring" stroke="${colors.battery}" data-ring="battery"/>
          <foreignObject x="-18" y="-54" width="36" height="36"><ha-icon icon="${this._config.battery.icon || DEFAULT_ICONS.battery}" style="--mdc-icon-size:28px;color:${colors.battery}"></ha-icon></foreignObject>
          <text y="-25" class="lbl" data-f="battery-label">${this._config.battery.name || "Batterie"}</text>
          <text y="0" class="val" data-f="battery-power">—</text>
          <text y="17" class="sec" data-f="battery-energy"></text>
          <text y="31" class="sec" data-f="battery-extra"></text>
        </g>`;
      svgFlows += `
        <path class="flow" stroke="${colors.battery}" opacity=".25" d="M195 ${midY + 25} C 245 ${midY + 35}, 275 ${midY + 15}, 295 ${midY - 5}"/>
        <path class="flow-dash rev" data-flow="battery-home" stroke="${colors.battery}" d="M195 ${midY + 25} C 245 ${midY + 35}, 275 ${midY + 15}, 295 ${midY - 5}"/>`;
    }

    // Home
    if (this._config.home) {
      svgNodes += `
        <g transform="translate(320 ${midY})" data-node="home" data-entity="${this._config.home.power || ""}">
          <circle r="56" class="ring" stroke="${colors.home}" stroke-width="3"/>
          <foreignObject x="-18" y="-50" width="36" height="36"><ha-icon icon="${this._config.home.icon || DEFAULT_ICONS.home}" style="--mdc-icon-size:30px;color:${colors.home}"></ha-icon></foreignObject>
          <text y="-20" class="lbl">${this._config.home.name || "Maison"}</text>
          <text y="4" class="val" data-f="home-power">—</text>
          <text y="23" class="sec" data-f="home-energy"></text>
        </g>`;
    }

    // Grid
    if (this._config.grid) {
      svgNodes += `
        <g transform="translate(490 ${midY + 15}) " data-node="grid" data-entity="${this._config.grid.power || ""}">
          <circle r="60" class="ring" stroke="${colors.grid}" data-ring="grid"/>
          <foreignObject x="-18" y="-54" width="36" height="36"><ha-icon icon="${this._config.grid.icon || DEFAULT_ICONS.grid}" style="--mdc-icon-size:28px;color:${colors.grid}"></ha-icon></foreignObject>
          <text y="-25" class="lbl">${this._config.grid.name || "Réseau"}</text>
          <text y="0" class="val" data-f="grid-power">—</text>
          <text y="17" class="sec" data-f="grid-energy"></text>
          <text y="31" class="sec" data-f="grid-extra"></text>
        </g>`;
      svgFlows += `
        <path class="flow" stroke="${colors.grid}" d="M485 ${midY + 15} C 420 ${midY + 10}, 370 ${midY}, 348 ${midY}"/>
        <path class="flow-dash" data-flow="grid-home" stroke="${colors.grid}" d="M485 ${midY + 15} C 420 ${midY + 10}, 370 ${midY}, 348 ${midY}"/>`;
    }

    // Car
    if (this._config.car) {
      svgNodes += `
        <g transform="translate(320 ${carY})" data-node="car" data-entity="${this._config.car.power || ""}">
          <circle r="54" class="ring" stroke="${colors.car}" stroke-width="3"/>
          <foreignObject x="-18" y="-48" width="36" height="36"><ha-icon icon="${this._config.car.icon || DEFAULT_ICONS.car}" style="--mdc-icon-size:28px;color:${colors.car}"></ha-icon></foreignObject>
          <text y="-19" class="lbl">${this._config.car.name || "Voiture"}</text>
          <text y="4" class="val" data-f="car-power">—</text>
          <text y="23" class="sec" data-f="car-energy"></text>
        </g>`;
      svgFlows += `
        <path class="flow" stroke="${colors.car}" d="M320 ${midY + 48} L 320 ${carY - 48}"/>
        <path class="flow-dash" data-flow="home-car" stroke="${colors.car}" d="M320 ${midY + 48} L 320 ${carY - 48}"/>`;
    }

    const legendItems = [];
    if (this._config.solar || pv.length) legendItems.push([colors.solar, "Solaire"]);
    if (this._config.battery) legendItems.push([colors.battery, "Batterie"]);
    if (this._config.home) legendItems.push([colors.home, "Maison"]);
    if (this._config.grid) legendItems.push([colors.grid, "Réseau"]);
    if (this._config.car) legendItems.push([colors.car, "Voiture"]);
    const legend = `<div class="legend">${legendItems
      .map(([c, l]) => `<span><i class="dotkey" style="background:${c}"></i>${l}</span>`)
      .join("")}</div>`;

    this.innerHTML = `
      ${style}
      <ha-card>
        ${title}
        <svg viewBox="0 0 640 ${totalH}" xmlns="http://www.w3.org/2000/svg">
          ${svgFlows}
          ${svgNodes}
        </svg>
        ${legend}
      </ha-card>`;

    this.querySelectorAll("[data-node]").forEach((el) => {
      el.addEventListener("click", () => {
        const entityId = el.getAttribute("data-entity");
        if (!entityId) return;
        const event = new CustomEvent("hass-more-info", {
          bubbles: true,
          composed: true,
          detail: { entityId },
        });
        this.dispatchEvent(event);
      });
    });

    this._built = true;
  }

  _setFlow(name, active, reverse) {
    const el = this.querySelector(`[data-flow="${name}"]`);
    if (!el) return;
    el.classList.toggle("on", !!active);
    el.classList.toggle("rev", !!reverse);
  }

  _setText(sel, text) {
    const el = this.querySelector(`[data-f="${sel}"]`);
    if (el) el.textContent = text || "";
  }

  _update() {
    if (!this._hass || !this._config) return;
    const hass = this._hass;
    const cfg = this._config;
    const pv = Array.isArray(cfg.pv) ? cfg.pv : [];
    const THRESH = 15; // watts, below this a flow is considered "off"

    let solarTotal = 0;
    pv.forEach((p, i) => {
      if (!p.power) return;
      const w = rawWatts(hass, p.power);
      solarTotal += w;
      this._setText(`pv${i}-power`, formatPower(hass, p.power));
      this._setText(`pv${i}-energy`, formatEnergy(hass, p.energy_today));
      this._setText(`pv${i}-va`, formatVoltageCurrent(hass, p.voltage, p.current));
      this._setFlow(`pv${i}`, w > THRESH);
    });

    if (cfg.solar) {
      const entity = cfg.solar.power;
      const w = entity ? rawWatts(hass, entity) : solarTotal;
      this._setText("solar-power", entity ? formatPower(hass, entity) : `${Math.round(solarTotal)} W`);
      this._setText("solar-energy", formatEnergy(hass, cfg.solar.energy_today));
      this._setFlow("solar-home", w > THRESH);
      if (cfg.battery) this._setFlow("solar-battery", w > THRESH);
    }

    if (cfg.battery) {
      let w = rawWatts(hass, cfg.battery.power);
      if (cfg.battery.invert_power) w = -w;
      const soc = cfg.battery.soc ? numState(hass, cfg.battery.soc) : null;
      const label = (cfg.battery.name || "Batterie") + (soc !== null && !Number.isNaN(soc) ? ` ${Math.round(soc)}%` : "");
      this._setText("battery-label", label);
      this._setText("battery-power", formatPower(hass, cfg.battery.power));
      const charging = w > THRESH;
      const discharging = w < -THRESH;
      this._setText(
        "battery-energy",
        charging
          ? formatEnergy(hass, cfg.battery.energy_today_charge)
          : formatEnergy(hass, cfg.battery.energy_today_discharge)
      );
      this._setFlow("solar-battery", charging);
      this._setFlow("battery-home", discharging);
      this._setText(
        "battery-extra",
        formatExtraLine(hass, [
          [cfg.battery.voltage, "V", 0],
          [cfg.battery.current, "A", 1],
          [cfg.battery.temperature, "°C", 0],
          [cfg.battery.soh, "% santé", 0],
        ])
      );
    }

    if (cfg.home) {
      this._setText("home-power", formatPower(hass, cfg.home.power));
      this._setText("home-energy", formatEnergy(hass, cfg.home.energy_today));
    }

    if (cfg.grid) {
      let w = rawWatts(hass, cfg.grid.power);
      if (cfg.grid.invert_power) w = -w;
      const importing = w > THRESH;
      this._setText("grid-power", formatPower(hass, cfg.grid.power));
      this._setText(
        "grid-energy",
        importing
          ? formatEnergy(hass, cfg.grid.energy_today_buy)
          : formatEnergy(hass, cfg.grid.energy_today_sell)
      );
      this._setFlow("grid-home", importing, false);
      this._setText(
        "grid-extra",
        formatExtraLine(hass, [
          [cfg.grid.voltage, "V", 0],
          [cfg.grid.frequency, "Hz", 1],
        ])
      );
      const ring = this.querySelector('[data-ring="grid"]');
      if (ring) {
        const disconnected = cfg.grid.connected && hass.states[cfg.grid.connected]
          ? hass.states[cfg.grid.connected].state === "off"
          : false;
        ring.classList.toggle("alert-ring", disconnected);
      }
    }

    if (cfg.car) {
      const w = rawWatts(hass, cfg.car.power);
      const charging = cfg.car.charging
        ? hass.states[cfg.car.charging] && hass.states[cfg.car.charging].state === "on"
        : w > THRESH;
      this._setText("car-power", formatPower(hass, cfg.car.power));
      this._setText("car-energy", formatEnergy(hass, cfg.car.energy_today));
      this._setFlow("home-car", charging);
    }
  }
}

customElements.define("energy-flow-card", EnergyFlowCard);

// ---------- auto-detection ----------
// Best-effort guess at a sensible configuration by scanning entity_ids and
// device_classes. Always meant to be reviewed/corrected by the user before
// saving (surfaced in the visual editor as a "Détecter automatiquement"
// button that fills the form without saving on its own).
const EFC_GENERIC_TOKENS = new Set([
  "sensor", "inverter", "all", "house", "active", "power", "puissance",
  "total", "sys", "the", "de", "la", "le", "du", "des",
]);

// A few FR/EN synonyms seen in the wild, normalized so e.g. a French
// "ve_energie_jour" counter still matches an English "ev_charger_power".
const EFC_SYNONYMS = {
  ve: "ev",
  vehicule: "ev",
  voiture: "ev",
  car: "ev",
  borne: "charger",
  batterie: "battery",
  maison: "home",
  reseau: "grid",
  solaire: "solar",
};

function efcTokens(id) {
  return id
    .replace(/^sensor\./, "")
    .toLowerCase()
    .split(/[_.]+/)
    .filter((t) => t && !EFC_GENERIC_TOKENS.has(t))
    .map((t) => EFC_SYNONYMS[t] || t);
}

// Given a PV string's power entity (e.g. "sensor.inverter_pv1_power"),
// look for its voltage/current sensors sharing the same string number
// (e.g. "sensor.inverter_pv1_voltage"). Shared by autoDetectConfig and by
// the visual editor's "on select a PV power entity" companion lookup.
function detectPvVoltageCurrent(hass, powerEntityId) {
  if (!hass || !hass.states || !powerEntityId) return {};
  const states = hass.states;
  const ids = Object.keys(states).filter((id) => id.startsWith("sensor."));
  const pvRegex = /(pv|string|mppt)[_-]?(\d+)[_-]?(power|puissance)/i;
  const m = powerEntityId.match(pvRegex);
  if (!m) return {};
  const prefix = m[1];
  const n = m[2];
  const find = (kindWords, unitTest) => {
    const re = new RegExp(`${prefix}[_-]?${n}[_-]?(${kindWords})`, "i");
    return ids.find(
      (id) => re.test(id) && unitTest(((states[id].attributes || {}).unit_of_measurement) || "")
    );
  };
  return {
    voltage: find("voltage|tension", (u) => /^v$/i.test(u)),
    current: find("current|courant", (u) => /^a$/i.test(u)),
  };
}

function autoDetectConfig(hass) {
  const cfg = { type: "custom:energy-flow-card" };
  if (!hass || !hass.states) return cfg;
  const states = hass.states;
  const ids = Object.keys(states).filter((id) => id.startsWith("sensor."));

  const isPower = (id) => {
    const a = states[id].attributes || {};
    return (
      a.device_class === "power" ||
      /^(w|kw|mw)$/i.test(a.unit_of_measurement || "") ||
      /power|puissance/i.test(id)
    );
  };

  const isEnergyUnit = (id) => {
    const u = ((states[id].attributes || {}).unit_of_measurement || "").toLowerCase();
    return u === "wh" || u === "kwh" || u === "mwh";
  };

  // Plain substring patterns (no \b: real entity_ids are underscore-joined,
  // so a leading \b never matches right after a prefix like "inverter_").
  const byPattern = (regexes) =>
    ids.find((id) => isPower(id) && regexes.some((r) => r.test(id)));

  // Match a "today energy" sensor by requiring an energy unit (Wh/kWh/MWh)
  // AND at least one shared distinctive token with the power entity's id
  // (e.g. "pv1", "battery", "load") - prevents matching an unrelated
  // generic "...today" sensor (such as a duration/minutes counter) just
  // because it shares a common prefix like "inverter".
  const findEnergyToday = (powerId) => {
    if (!powerId) return undefined;
    const srcTokens = new Set(efcTokens(powerId));
    if (!srcTokens.size) return undefined;
    let best, bestScore = 0;
    for (const id of ids) {
      if (id === powerId || !isEnergyUnit(id)) continue;
      const score = efcTokens(id).filter((t) => srcTokens.has(t)).length;
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
    return best;
  };

  // Known aggregate "today" counters (battery charge/discharge, grid
  // import/export, total solar production) rarely share a naming root with
  // their power entity (e.g. "activepower_pcc_total" vs
  // "today_energy_import") - match by keyword + energy unit + daily-ish
  // wording instead of token overlap.
  const findDailyByKeyword = (mustMatch, mustNotMatch) =>
    ids.find(
      (id) =>
        isEnergyUnit(id) &&
        /(today|jour|day|daily)/i.test(id) &&
        mustMatch.test(id) &&
        !(mustNotMatch && mustNotMatch.test(id))
    );

  // For instantaneous "extra" readings (voltage, current, temperature,
  // frequency, state-of-health, connectivity) that belong to a specific
  // domain (battery, grid, ...): a keyword + the expected unit is enough,
  // no "today" wording required since these aren't daily counters.
  const findByUnit = (mustMatch, unitTest, mustNotMatch) =>
    ids.find(
      (id) =>
        mustMatch.test(id) &&
        !(mustNotMatch && mustNotMatch.test(id)) &&
        unitTest(((states[id].attributes || {}).unit_of_measurement) || "")
    );

  // Individual PV strings: anything matching pvN / stringN / mpptN + power.
  // For the same string number, also look for its voltage/current sensors
  // (e.g. PV1 power -> also search for a "pv1...voltage/tension" and
  // "pv1...current/courant" sensor), so each line shows V/A alongside W.
  const pvRegex = /(pv|string|mppt)[_-]?(\d+)[_-]?(power|puissance)/i;
  const pvMatches = ids
    .filter((id) => pvRegex.test(id) && isPower(id))
    .map((id) => ({ id, n: parseInt(id.match(pvRegex)[2], 10) }))
    .sort((a, b) => a.n - b.n);
  const pv = pvMatches.map(({ id, n }) => ({
    power: id,
    name: `PV${n}`,
    energy_today: findEnergyToday(id),
    ...detectPvVoltageCurrent(hass, id),
  }));
  if (pv.length) cfg.pv = pv;

  const solarPower = byPattern([/pv_power/i, /solar.*power/i, /production/i]);
  if (solarPower || pv.length) {
    const energyToday = findEnergyToday(solarPower) || findDailyByKeyword(/production/i);
    cfg.solar = solarPower ? { power: solarPower, energy_today: energyToday } : {};
  }

  const batteryPower = byPattern([/battery.*power/i, /batterie.*puissance/i]);
  if (batteryPower) {
    // "battery" is a dangerously generic word in a smart home (phones,
    // watches, the car, remotes... all have a "battery" sensor). Scope
    // every companion lookup to entities that also share the home storage
    // system's own device prefix (e.g. "inverter" in
    // "sensor.inverter_battery_power"), so a phone's or the car's battery
    // is never mistaken for the home ESS.
    const prefixMatch = batteryPower.match(/^sensor\.(.+?)_?batter/i);
    const batteryPrefix = prefixMatch ? prefixMatch[1].replace(/_$/, "") : "";
    const scoped = (id) => !batteryPrefix || id.includes(batteryPrefix);
    const unitOf = (id) => ((states[id].attributes || {}).unit_of_measurement || "");

    const soc =
      ids.find((id) => scoped(id) && (states[id].attributes || {}).device_class === "battery") ||
      ids.find(
        (id) =>
          scoped(id) &&
          /batter(y|ie)/i.test(id) &&
          !/objectif|cible|target|goal/i.test(id) &&
          unitOf(id) === "%"
      );

    cfg.battery = {
      power: batteryPower,
      soc,
      energy_today_charge: ids.find(
        (id) =>
          scoped(id) &&
          isEnergyUnit(id) &&
          /(today|jour|day|daily)/i.test(id) &&
          /charge/i.test(id) &&
          !/discharge|decharge/i.test(id)
      ),
      energy_today_discharge: ids.find(
        (id) =>
          scoped(id) &&
          isEnergyUnit(id) &&
          /(today|jour|day|daily)/i.test(id) &&
          /discharge|decharge/i.test(id)
      ),
      voltage: ids.find((id) => scoped(id) && /batter(y|ie)/i.test(id) && /^v$/i.test(unitOf(id))),
      current: ids.find((id) => scoped(id) && /batter(y|ie)/i.test(id) && /^a$/i.test(unitOf(id))),
      temperature: ids.find((id) => scoped(id) && /batter(y|ie)/i.test(id) && /°?c$/i.test(unitOf(id))),
      soh: ids.find(
        (id) => scoped(id) && /batter(y|ie).*(soh|health|sante)/i.test(id) && unitOf(id) === "%"
      ),
    };
  }

  const homePower = byPattern([/load.*sys/i, /home.*power/i, /load_power/i, /maison.*puissance/i]);
  if (homePower) {
    cfg.home = { power: homePower, energy_today: findEnergyToday(homePower) };
  }

  const gridPower = byPattern([/grid.*power/i, /pcc.*total/i, /reseau.*puissance/i]);
  if (gridPower) {
    cfg.grid = {
      power: gridPower,
      energy_today_buy: findDailyByKeyword(/import|buy|achat/i, /export|sell|vente/i),
      energy_today_sell: findDailyByKeyword(/export|sell|vente/i, /import|buy|achat/i),
      voltage: findByUnit(/grid|reseau|phase/i, (u) => /^v$/i.test(u)),
      frequency: findByUnit(/grid|reseau|frequency|frequence/i, (u) => /^hz$/i.test(u)),
      connected: Object.keys(states).find(
        (id) => id.startsWith("binary_sensor.") && /grid.*connect|reseau.*connect/i.test(id)
      ),
    };
  }

  const carPower = byPattern([/ev_charger.*(power|puissance)/i, /charger_power/i, /borne.*puissance/i]);
  if (carPower) {
    cfg.car = { power: carPower, energy_today: findEnergyToday(carPower) };
  }

  return cfg;
}

// ---------- visual editor ----------

function getPath(obj, path) {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function setPath(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    const next = parts[i + 1];
    const isArrayIndex = /^\d+$/.test(next);
    if (cur[p] == null) cur[p] = isArrayIndex ? [] : {};
    cur = cur[p];
  }
  const last = parts[parts.length - 1];
  if (value === "" || value === undefined) {
    delete cur[last];
  } else {
    cur[last] = value;
  }
}

class EnergyFlowCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = JSON.parse(JSON.stringify(config || { type: "custom:energy-flow-card" }));
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._render();
    this.querySelectorAll("ha-entity-picker").forEach((el) => {
      el.hass = hass;
    });
  }

  _emit() {
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      })
    );
  }

  _row(labelText, path, extraLabel, domains) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex; align-items:center; gap:8px; margin-bottom:6px;";
    const label = document.createElement("div");
    label.textContent = labelText;
    label.style.cssText = "width:120px; font-size:.85rem; color:var(--secondary-text-color); flex-shrink:0;";
    const picker = document.createElement("ha-entity-picker");
    picker.hass = this._hass;
    picker.value = getPath(this._config, path) || "";
    picker.label = extraLabel || "";
    picker.includeDomains = domains || ["sensor"];
    picker.style.flex = "1";
    picker.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      setPath(this._config, path, ev.detail.value);
      this._emit();
    });
    wrap.appendChild(label);
    wrap.appendChild(picker);
    return wrap;
  }

  // Like _row, but for a PV string's power entity specifically: picking a
  // new entity also searches for its voltage/current companions (same
  // string number) and fills them in automatically if found.
  _pvPowerRow(i) {
    const path = `pv.${i}.power`;
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex; align-items:center; gap:8px; margin-bottom:6px;";
    const label = document.createElement("div");
    label.textContent = `PV${i + 1} puissance`;
    label.style.cssText = "width:120px; font-size:.85rem; color:var(--secondary-text-color); flex-shrink:0;";
    const picker = document.createElement("ha-entity-picker");
    picker.hass = this._hass;
    picker.value = getPath(this._config, path) || "";
    picker.includeDomains = ["sensor"];
    picker.style.flex = "1";
    picker.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      const value = ev.detail.value;
      setPath(this._config, path, value);
      const companions = detectPvVoltageCurrent(this._hass, value);
      if (companions.voltage) setPath(this._config, `pv.${i}.voltage`, companions.voltage);
      if (companions.current) setPath(this._config, `pv.${i}.current`, companions.current);
      this._emit();
      this._render();
    });
    wrap.appendChild(label);
    wrap.appendChild(picker);
    return wrap;
  }

  _textRow(labelText, path) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex; align-items:center; gap:8px; margin-bottom:6px;";
    const label = document.createElement("div");
    label.textContent = labelText;
    label.style.cssText = "width:120px; font-size:.85rem; color:var(--secondary-text-color); flex-shrink:0;";
    const input = document.createElement("ha-textfield");
    input.value = getPath(this._config, path) || "";
    input.style.flex = "1";
    input.addEventListener("input", (ev) => {
      setPath(this._config, path, ev.target.value);
      this._emit();
    });
    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  _section(title, body) {
    const sec = document.createElement("div");
    sec.style.cssText = "border:1px solid var(--divider-color); border-radius:8px; padding:10px 12px; margin-bottom:12px;";
    const h = document.createElement("div");
    h.textContent = title;
    h.style.cssText = "font-weight:600; margin-bottom:8px; color:var(--primary-text-color);";
    sec.appendChild(h);
    body.forEach((el) => sec.appendChild(el));
    return sec;
  }

  async _runAutoDetect() {
    const detected = autoDetectConfig(this._hass);
    const prevType = this._config.type || "custom:energy-flow-card";
    this._config = { type: prevType };
    this._missingCounters = [];
    this._render();
    this._notice("🔍 Recherche en cours…");

    const steps = [
      ["solar", "Solaire"],
      ["pv", "Lignes PV"],
      ["battery", "Batterie"],
      ["home", "Maison"],
      ["grid", "Réseau"],
      ["car", "Véhicule électrique"],
    ];
    for (const [key, label] of steps) {
      if (detected[key] === undefined) continue;
      await new Promise((r) => setTimeout(r, 280));
      this._config[key] = detected[key];
      this._emit();
      this._render();
      this._notice(`🔍 Détecté : ${label}…`);
    }

    this._computeMissingCounters();
    this._render();
    this._notice(
      "Configuration détectée automatiquement — vérifiez chaque champ ci-dessous puis corrigez/complétez si besoin avant d'enregistrer."
    );
  }

  _slug(text) {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  _counterSnippet(entityId, label) {
    const slug = this._slug(label);
    return `sensor:
  - platform: integration
    name: "${label} - Énergie cumulée"
    source: ${entityId}
    unit_prefix: k
    round: 3
    method: left

utility_meter:
  ${slug}_energie_jour:
    source: sensor.${slug}_energie_cumulee
    name: "${label} - Énergie du jour"
    cycle: daily`;
  }

  _computeMissingCounters() {
    const cfg = this._config;
    const missing = [];
    const check = (power, energyToday, label) => {
      if (power && !energyToday) {
        missing.push({ label, entityId: power, snippet: this._counterSnippet(power, label) });
      }
    };
    if (cfg.solar) check(cfg.solar.power, cfg.solar.energy_today, cfg.solar.name || "Solaire");
    (cfg.pv || []).forEach((p, i) =>
      check(p.power, p.energy_today, p.name || `PV${i + 1}`)
    );
    if (cfg.battery) check(cfg.battery.power, cfg.battery.energy_today_charge, (cfg.battery.name || "Batterie"));
    if (cfg.home) check(cfg.home.power, cfg.home.energy_today, cfg.home.name || "Maison");
    if (cfg.grid) check(cfg.grid.power, cfg.grid.energy_today_buy, cfg.grid.name || "Réseau");
    if (cfg.car) check(cfg.car.power, cfg.car.energy_today, cfg.car.name || "Voiture");
    this._missingCounters = missing;
  }

  _renderMissingCounters() {
    if (!this._missingCounters || !this._missingCounters.length) return null;
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "background:var(--warning-color,#ff9800); color:#000; padding:10px 12px; border-radius:6px; margin-bottom:12px; font-size:.85rem;";
    const title = document.createElement("div");
    title.style.fontWeight = "600";
    title.textContent = `⚠️ ${this._missingCounters.length} entité(s) sans compteur du jour — voici le YAML à ajouter (configuration.yaml ou un package), puis redémarrer Home Assistant :`;
    wrap.appendChild(title);
    this._missingCounters.forEach((m) => {
      const box = document.createElement("div");
      box.style.cssText = "margin-top:8px; background:rgba(0,0,0,.15); border-radius:6px; padding:8px;";
      const lbl = document.createElement("div");
      lbl.style.cssText = "font-weight:600; margin-bottom:4px;";
      lbl.textContent = m.label;
      const pre = document.createElement("pre");
      pre.textContent = m.snippet;
      pre.style.cssText = "white-space:pre-wrap; font-size:.75rem; margin:0 0 6px; font-family:monospace;";
      const btn = document.createElement("mwc-button");
      btn.textContent = "Copier";
      btn.addEventListener("click", () => {
        navigator.clipboard
          .writeText(m.snippet)
          .then(() => {
            btn.textContent = "Copié !";
            setTimeout(() => (btn.textContent = "Copier"), 1500);
          })
          .catch(() => {});
      });
      box.appendChild(lbl);
      box.appendChild(pre);
      box.appendChild(btn);
      wrap.appendChild(box);
    });
    return wrap;
  }

  _notice(text) {
    let n = this.querySelector(".efc-notice");
    if (!n) {
      n = document.createElement("div");
      n.className = "efc-notice";
      n.style.cssText =
        "background:var(--info-color,#2196f3); color:white; padding:8px 12px; border-radius:6px; font-size:.85rem; margin-bottom:12px;";
      this._form.prepend(n);
    }
    n.textContent = text;
  }

  _render() {
    if (!this._config) this._config = { type: "custom:energy-flow-card" };

    this.innerHTML = `<div class="efc-editor" style="padding:4px 2px;"></div>`;
    this._form = this.querySelector(".efc-editor");

    const detectBtn = document.createElement("mwc-button");
    detectBtn.setAttribute("raised", "");
    detectBtn.textContent = "🔍 Détecter automatiquement";
    detectBtn.style.marginBottom = "14px";
    detectBtn.addEventListener("click", () => this._runAutoDetect());
    this._form.appendChild(detectBtn);

    const missingPanel = this._renderMissingCounters();
    if (missingPanel) this._form.appendChild(missingPanel);

    this._form.appendChild(
      this._section("Général", [this._textRow("Titre", "title")])
    );

    this._form.appendChild(
      this._section("Solaire (total)", [
        this._row("Puissance", "solar.power"),
        this._row("Énergie du jour", "solar.energy_today"),
      ])
    );

    const pv = Array.isArray(this._config.pv) ? this._config.pv : [];
    const pvRows = [];
    pv.forEach((_, i) => {
      const line = document.createElement("div");
      line.style.cssText = "border-top:1px dashed var(--divider-color); padding-top:8px; margin-top:8px;";
      line.appendChild(this._pvPowerRow(i));
      line.appendChild(this._row(`PV${i + 1} tension`, `pv.${i}.voltage`));
      line.appendChild(this._row(`PV${i + 1} courant`, `pv.${i}.current`));
      line.appendChild(this._row(`PV${i + 1} énergie/j`, `pv.${i}.energy_today`));
      line.appendChild(this._textRow(`PV${i + 1} nom`, `pv.${i}.name`));
      const rm = document.createElement("mwc-button");
      rm.textContent = "Retirer cette ligne";
      rm.addEventListener("click", () => {
        this._config.pv.splice(i, 1);
        this._emit();
        this._render();
      });
      line.appendChild(rm);
      pvRows.push(line);
    });
    const addBtn = document.createElement("mwc-button");
    addBtn.textContent = "+ Ajouter une ligne PV";
    addBtn.addEventListener("click", () => {
      if (!Array.isArray(this._config.pv)) this._config.pv = [];
      this._config.pv.push({});
      this._emit();
      this._render();
    });
    this._form.appendChild(this._section(`Lignes PV individuelles (${pv.length})`, [...pvRows, addBtn]));

    this._form.appendChild(
      this._section("Batterie", [
        this._row("Puissance", "battery.power"),
        this._row("État de charge (%)", "battery.soc"),
        this._row("Énergie chargée/j", "battery.energy_today_charge"),
        this._row("Énergie déchargée/j", "battery.energy_today_discharge"),
        this._row("Tension (optionnel)", "battery.voltage"),
        this._row("Courant (optionnel)", "battery.current"),
        this._row("Température (optionnel)", "battery.temperature"),
        this._row("Santé / SOH % (optionnel)", "battery.soh"),
      ])
    );

    this._form.appendChild(
      this._section("Maison", [
        this._row("Puissance", "home.power"),
        this._row("Énergie du jour", "home.energy_today"),
      ])
    );

    this._form.appendChild(
      this._section("Réseau", [
        this._row("Puissance", "grid.power"),
        this._row("Énergie achetée/j", "grid.energy_today_buy"),
        this._row("Énergie vendue/j", "grid.energy_today_sell"),
        this._row("Tension (optionnel)", "grid.voltage"),
        this._row("Fréquence (optionnel)", "grid.frequency"),
        this._row("Capteur \"réseau connecté\" (optionnel)", "grid.connected", "", ["binary_sensor"]),
      ])
    );

    this._form.appendChild(
      this._section("Véhicule électrique (optionnel)", [
        this._row("Puissance de charge", "car.power"),
        this._row("Énergie chargée/j", "car.energy_today"),
        this._row("Capteur \"en charge\"", "car.charging", "", ["binary_sensor"]),
        this._textRow("Nom", "car.name"),
      ])
    );

    this._built = true;
  }
}

customElements.define("energy-flow-card-editor", EnergyFlowCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "energy-flow-card",
  name: "Multi-PV Flow Card",
  description:
    "🚧 En développement — Carte animée de flux d'énergie : solaire (1 à N strings PV), batterie, maison, réseau et véhicule électrique, avec icônes/logos configurables.",
  preview: false,
  documentationURL: "https://github.com/JORDANDJ41/ha-energy-flow-card",
});

// eslint-disable-next-line no-console
console.info(
  `%c ENERGY-FLOW-CARD %c v${CARD_VERSION} `,
  "color: white; background: #fbbf24; font-weight: 700;",
  "color: #fbbf24; background: #1b2340; font-weight: 700;"
);
