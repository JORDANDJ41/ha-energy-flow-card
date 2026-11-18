/*!
 * Energy Flow Card
 * A configurable animated energy-flow diagram for Home Assistant Lovelace.
 * Supports any number of individual solar/PV strings, battery, home, grid
 * and an optional "car" node (EV charging), each with its own icon/logo,
 * live power and an optional "today" energy value.
 *
 * https://github.com/JORDANDJ41/ha-energy-flow-card
 * License: MIT
 */

const CARD_VERSION = "1.0.0";

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

  static getStubConfig() {
    return {
      type: "custom:energy-flow-card",
      solar: { power: "sensor.solar_power" },
      home: { power: "sensor.home_power" },
    };
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
          <circle r="52" class="ring" stroke="${colors.pv}"/>
          ${icon ? `<foreignObject x="-20" y="-64" width="40" height="40">${p.image ? `<img src="${p.image}" style="width:100%;height:100%;object-fit:contain"/>` : ""}</foreignObject>` : solarSvg(colors.pv)}
          <text y="4" class="lbl">${name}</text>
          <text y="25" class="val" data-f="pv${i}-power">—</text>
          <text y="42" class="sec" data-f="pv${i}-energy"></text>
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
          <circle r="54" class="ring" stroke="${colors.battery}"/>
          <foreignObject x="-18" y="-48" width="36" height="36"><ha-icon icon="${this._config.battery.icon || DEFAULT_ICONS.battery}" style="--mdc-icon-size:28px;color:${colors.battery}"></ha-icon></foreignObject>
          <text y="-19" class="lbl" data-f="battery-label">${this._config.battery.name || "Batterie"}</text>
          <text y="4" class="val" data-f="battery-power">—</text>
          <text y="23" class="sec" data-f="battery-energy"></text>
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
          <circle r="54" class="ring" stroke="${colors.grid}"/>
          <foreignObject x="-18" y="-48" width="36" height="36"><ha-icon icon="${this._config.grid.icon || DEFAULT_ICONS.grid}" style="--mdc-icon-size:28px;color:${colors.grid}"></ha-icon></foreignObject>
          <text y="-19" class="lbl">${this._config.grid.name || "Réseau"}</text>
          <text y="4" class="val" data-f="grid-power">—</text>
          <text y="23" class="sec" data-f="grid-energy"></text>
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

window.customCards = window.customCards || [];
window.customCards.push({
  type: "energy-flow-card",
  name: "Energy Flow Card",
  description:
    "Carte animée de flux d'énergie : solaire (1 à N strings PV), batterie, maison, réseau et véhicule électrique, avec icônes/logos configurables.",
  preview: false,
  documentationURL: "https://github.com/JORDANDJ41/ha-energy-flow-card",
});

// eslint-disable-next-line no-console
console.info(
  `%c ENERGY-FLOW-CARD %c v${CARD_VERSION} `,
  "color: white; background: #fbbf24; font-weight: 700;",
  "color: #fbbf24; background: #1b2340; font-weight: 700;"
);
