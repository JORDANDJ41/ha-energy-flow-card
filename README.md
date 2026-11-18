# Multi-PV Flow Card

> 🚧 **En développement — pas encore stable.** Cette carte vient d'être créée et est encore testée activement : attendez-vous à des bugs et à des changements de configuration entre versions. N'hésitez pas à ouvrir une issue si quelque chose ne fonctionne pas.

Carte Lovelace personnalisée pour Home Assistant : un diagramme de flux d'énergie animé — solaire (une ou plusieurs lignes PV), batterie, maison, réseau et véhicule électrique — avec icônes ou logos configurables par nœud.

Contrairement aux cartes de flux existantes limitées à 1-2 entrées solaires fixes, cette carte accepte **n'importe quel nombre de strings PV** (1, 2, 4, ou plus), chacune avec son propre nom, icône/logo et compteur du jour.

**Éditeur visuel inclus** — pas besoin d'écrire de YAML : ouvrez la configuration de la carte dans l'éditeur de tableau de bord, et cliquez sur **"🔍 Détecter automatiquement"** pour que la carte analyse vos entités et propose une configuration de départ (PV, batterie, maison, réseau, VE). Vérifiez/corrigez chaque champ proposé avant d'enregistrer — la détection automatique est une aide, pas une validation.

## Installation

### Via HACS (dépôt personnalisé)

1. HACS → menu ⋮ → **Dépôts personnalisés**
2. URL : `https://github.com/JORDANDJ41/ha-energy-flow-card`, catégorie **Lovelace**
3. Installer **Multi-PV Flow Card**, puis redémarrer Home Assistant (ou recharger le cache du navigateur)

### Manuellement

1. Copier `energy-flow-card.js` dans `/config/www/`
2. Ajouter la ressource dans Paramètres → Tableaux de bord → ⋮ → Ressources :
   - URL : `/local/energy-flow-card.js`
   - Type : Module JavaScript

## Configuration

Toutes les sections sont optionnelles — ne configurez que ce qui existe chez vous.

```yaml
type: custom:energy-flow-card
title: Énergie
weather_entity: weather.maison   # optionnel : fond animé selon la météo (soleil, nuages, pluie, neige, nuit)
solar:
  power: sensor.inverter_pv_power        # puissance instantanée totale
  energy_today: sensor.inverter_today_production
  icon: mdi:white-balance-sunny          # ou image: /local/mon_logo.png
  sum_pv: false                          # true = ignore "power" et utilise la somme des lignes PV ci-dessous (utile si le total de l'onduleur ne correspond pas à PV1+PV2+...)
pv:
  - power: sensor.inverter_pv1_power
    voltage: sensor.inverter_pv1_voltage    # optionnel, affiché en petit à côté de la puissance
    current: sensor.inverter_pv1_current    # optionnel
    energy_today: sensor.pv1_energie_jour
    name: PV1
  - power: sensor.inverter_pv2_power
    voltage: sensor.inverter_pv2_voltage
    current: sensor.inverter_pv2_current
    energy_today: sensor.pv2_energie_jour
    name: PV2
  # ... autant de lignes PV que nécessaire (3, 4, ...)
battery:
  power: sensor.inverter_battery_power   # positif = charge, négatif = décharge
  soc: sensor.inverter_battery
  energy_today_charge: sensor.inverter_today_battery_charge
  energy_today_discharge: sensor.inverter_today_battery_discharge
  voltage: sensor.inverter_battery_voltage      # optionnel
  current: sensor.inverter_battery_current      # optionnel
  temperature: sensor.inverter_battery_temperature  # optionnel
  soh: sensor.inverter_battery_soh              # optionnel, santé de la batterie en %
  invert_power: false                    # true si votre capteur utilise la convention inverse
home:
  power: sensor.inverter_activepower_load_sys
  energy_today: sensor.inverter_today_load_consumption
grid:
  power: sensor.inverter_activepower_pcc_total  # positif = achat, négatif = vente
  energy_today_buy: sensor.inverter_today_energy_import
  energy_today_sell: sensor.inverter_today_energy_export
  voltage: sensor.inverter_voltage_phase_r      # optionnel
  frequency: sensor.inverter_grid_frequency     # optionnel
  connected: binary_sensor.sunsynk_grid_connected_status  # optionnel, anneau rouge clignotant si "off"
  invert_power: false
car:
  power: sensor.vevor_ev_charger_puissance
  energy_today: sensor.ve_energie_jour
  charging: binary_sensor.gl236kq_en_charge   # optionnel, sinon déduit de power > 0
  name: Voiture
  icon: mdi:car-electric                      # ou image: /local/logo_voiture.png
```

### Référence des options par nœud

| Clé | Rôle |
|---|---|
| `power` | Entité de puissance instantanée (W ou kW, détecté automatiquement) |
| `energy_today` | Entité d'énergie du jour (kWh ou Wh) — affichée en petit sous la puissance |
| `name` | Nom affiché (sinon un nom par défaut selon le nœud) |
| `icon` | Icône MDI (ex: `mdi:solar-power`) |
| `image` | Chemin d'une image/logo (ex: `/local/mon_logo.png`) — prioritaire sur `icon` |
| `invert_power` (battery, grid) | Inverse le signe si votre capteur suit la convention opposée |
| `energy_today_charge` / `energy_today_discharge` (battery) | Compteurs séparés charge/décharge du jour |
| `energy_today_buy` / `energy_today_sell` (grid) | Compteurs séparés achat/vente du jour |
| `voltage` / `current` (pv) | Tension (V) et courant (A) de la ligne, affichés en petit sous l'énergie du jour — détectés automatiquement par numéro de ligne (PV1 cherche aussi une tension/courant "...pv1...") |
| `capacity_kwh` (battery) | Capacité utile saisie à la main (kWh) — combinée au SOC%, calcule l'énergie actuellement disponible dans la batterie |
| `voltage` / `current` / `temperature` / `soh` (battery) | Valeurs optionnelles affichées en petit — proposées par la détection automatique, supprimez celles que vous ne voulez pas voir |
| `voltage` / `frequency` (grid) | Valeurs optionnelles affichées en petit |
| `sum_pv` (solar) | `true` = ignore `power` et affiche la somme des lignes PV à la place |
| `weather_entity` (carte) | Entité `weather.*` optionnelle — anime le fond de la carte selon la condition (soleil, nuageux, pluie, neige, nuit) |
| `connected` (grid) | `binary_sensor` optionnel — l'anneau du nœud Réseau clignote en rouge si son état passe à "off" |
| `charging` (car) | `binary_sensor` explicite pour l'état de charge (sinon déduit de `power`) |

Cliquer sur un nœud ouvre la fenêtre "plus d'infos" de son entité `power`.

## Pas de compteur du jour par string PV ou pour la VE ?

Beaucoup d'onduleurs/bornes ne donnent qu'une puissance instantanée par ligne, sans cumul journalier dédié. On peut en créer un facilement avec les helpers natifs de Home Assistant (`integration` + `utility_meter`), sans aucune intégration tierce :

```yaml
sensor:
  - platform: integration
    name: "PV1 - Énergie cumulée"
    source: sensor.inverter_pv1_power
    unit_prefix: k
    round: 3
    method: left

utility_meter:
  pv1_energie_jour:
    source: sensor.pv1_energie_cumulee
    name: "PV1 - Énergie du jour"
    cycle: daily
```

Dupliquez ce bloc pour chaque string PV (ou pour la puissance de charge d'un véhicule électrique) en changeant l'entité source et les noms. Le capteur `integration` convertit la puissance en énergie cumulée, et `utility_meter` en extrait un sous-compteur remis à zéro chaque jour à minuit.

## Feuille de route

- Éditeur visuel de configuration (pour l'instant, YAML uniquement)
- Thèmes de couleurs par nœud configurables

## Licence

MIT
