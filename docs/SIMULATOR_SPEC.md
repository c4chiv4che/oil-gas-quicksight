# Vaca Muerta Shale Operations Simulator — Technical Specification v2.0

**Source material:** IAPG (Instituto Argentino del Petróleo y del Gas), ITP Neuquén
operator training course "Operador de Sala de Control de Procesos Hidrocarburíferos",
ENARGAS norm NAG-602 (2019), real DCS screens from Honeywell Experion PKS.

---

## 1. ARCHITECTURE — Three-layer simulation

┌──────────────────────────────────────────────────────────────────┐
│                    WELLPAD (Layer 1)                              │
│   4 horizontal shale wells × ESP lift × multi-stage frac          │
│   LLL-001, LLL-002, LLL-003, LLL-004                              │
└────────────────────────────┬─────────────────────────────────────┘
│ flowlines (multiphase)
▼
┌──────────────────────────────────────────────────────────────────┐
│                    PROCESSING PLANT (Layer 2)                     │
│                                                                   │
│   Maifold → Inlet Slug Catcher → 3-Phase Separator               │
│            → TEG Dehydration → LTS/Dew Point (propane refrig.)    │
│            → Condensate Stabilizer → Compression (centrifugal)    │
│            → Fiscal Metering → Sales Gas pipeline                 │
└────────────────────────────┬─────────────────────────────────────┘
│
▼
┌──────────────────────────────────────────────────────────────────┐
│                    UTILITIES (Layer 3)                            │
│   Hot Oil (calefacción) │ Propane Refrigeration Loop              │
│   Instrument Air (4-20mA, 3-15 psi) │ Flare/Antorcha (HP/LP/Wet)  │
└──────────────────────────────────────────────────────────────────┘

Each layer writes its own Parquet dataset, partitioned by date.

---

## 2. WELL SIGNALS (Layer 1)

ISA 5.1 tag naming convention. Real Vaca Muerta horizontal shale wells with ESP lift.

### 2.1 Production signals
| Tag | Description | Unit | Realistic range |
|-----|-------------|------|-----------------|
| WHP | Wellhead Pressure | bar | 20-180 |
| CHP | Casing Head Pressure | bar | 10-80 |
| TT_FLOW | Flowline Temperature | °C | 40-95 |
| FT_OIL | Oil rate | m³/d | 0-120 |
| FT_GAS | Gas rate | Mm³/d | 0-80 |
| FT_WATER | Produced water rate | m³/d | 0-30 |
| IT_ESP | ESP motor current | A | 40-120 |
| SI_ESP | ESP variable frequency | Hz | 35-65 |
| ZT_CHOKE | Choke position | % open | 0-100 |
| PT_DOWNHOLE | Downhole pressure (calculated) | bar | 180-420 |
| AI_GOR | Gas-oil ratio | m³/m³ | 100-800 |
| AI_WCUT | Water cut | fraction | 0.02-0.45 |

### 2.2 Quality signals (online chromatograph per NAG-602 § 6.2)
| Tag | Description | Unit | Vaca Muerta range |
|-----|-------------|------|-------------------|
| AI_C1 | Methane content | % molar | 78-92 |
| AI_C2 | Ethane | % molar | 4-12 |
| AI_C3 | Propane | % molar | 1-5 |
| AI_C4 | Butanes (iC4+nC4) | % molar | 0.3-1.5 |
| AI_C5_PLUS | Pentanes and heavier | % molar | 0.1-1 |
| AI_CO2 | CO2 content | % molar | 0.5-3 |
| AI_N2 | Nitrogen | % molar | 0.5-2.5 |
| AI_H2S | H2S content | mg/m³ | 0-8 |
| AI_H2O | Water content (before TEG) | mg/m³ | 80-500 |

### 2.3 Integrity signals
| Tag | Description | Unit | Range |
|-----|-------------|------|-------|
| AI_SAND | Acoustic sand detector | counts/min | 0-50 |
| VT_ESP | ESP vibration (RMS) | mm/s | 0-7 |
| TT_ESP_OIL | ESP motor oil temp | °C | 60-110 |

### 2.4 Derived/calculated
- `corrosion_risk` = f(H2S, H2O, T) — index 0-1
- `hydrate_risk` = f(H2O, gas_composition, T, P) — index 0-1

---

## 3. PLANT SIGNALS (Layer 2)

### 3.1 Inlet Manifold + Slug Catcher
| Tag | Description | Unit | Setpoint/Range |
|-----|-------------|------|---------------|
| PT_INLET | Plant inlet pressure | bar | 40-70 (SP: 55) |
| TT_INLET | Plant inlet temperature | °C | 25-60 |
| LT_SLUG | Slug catcher liquid level | % | 30-70 (SP: 50) |
| FT_INLET_GAS | Total inlet gas rate | Mm³/d | 0-300 |
| FT_INLET_LIQ | Total inlet liquid rate | m³/d | 0-400 |

### 3.2 3-Phase Separator
| Tag | Description | Unit | Setpoint/Range |
|-----|-------------|------|---------------|
| PT_SEP | Separator operating pressure | bar | 8-12 (SP: 10) |
| TT_SEP | Separator temperature | °C | 30-50 |
| LT_SEP_OIL | Oil/condensate level | % | 40-60 (SP: 50) |
| LT_SEP_WATER | Water boot level | % | 30-60 (SP: 45) |
| PDT_SEP | Differential pressure | mbar | 50-200 |

### 3.3 TEG Dehydration
| Tag | Description | Unit | Setpoint/Range |
|-----|-------------|------|---------------|
| TT_CONTACTOR | TEG contactor temperature | °C | 35-45 (SP: 40) |
| PT_CONTACTOR | TEG contactor pressure | bar | 50-70 |
| FT_TEG_CIRC | TEG circulation rate | L/h | 800-1500 |
| TT_REBOILER | TEG reboiler temperature | °C | 195-205 (SP: 200) |
| AI_TEG_PURITY | Lean TEG purity | % wt | 98.5-99.5 |
| AI_DEWPOINT_H2O | Water dew point | °C | -15 to -5 (< -10) |
| LT_TEG_SURGE | TEG surge tank level | % | 30-80 |

### 3.4 LTS / Dew Point Unit
| Tag | Description | Unit | Setpoint/Range |
|-----|-------------|------|---------------|
| TT_GAS_GAS | Gas/gas exchanger outlet T | °C | 5 to 15 |
| TT_CHILLER | Chiller outlet temperature | °C | -20 to -10 (SP: -15) |
| PT_LTS | Cold separator pressure | bar | 40-60 |
| TT_LTS | Cold separator temperature | °C | -18 to -12 |
| LT_LTS | LTS condensate level | % | 30-70 (SP: 50) |
| AI_DEWPOINT_HC | HC dew point @5500kPa | °C | -10 to -2 (NAG-602: < -4) |

### 3.5 Propane Refrigeration Loop
| Tag | Description | Unit | Range |
|-----|-------------|------|-------|
| PT_PROP_SUCT | Propane compressor suction P | bar | 1-3 |
| PT_PROP_DISCH | Propane compressor discharge P | bar | 12-16 |
| TT_PROP_SUCT | Suction temperature | °C | -25 to -10 |
| TT_PROP_DISCH | Discharge temperature | °C | 70-110 |
| SI_PROP_COMP | Compressor speed | rpm | 2800-3600 |
| IT_PROP_COMP | Motor current | A | 80-200 |
| VT_PROP_COMP | Compressor vibration | mm/s | 0-5 |
| LT_PROP_ACUM | Propane accumulator level | % | 40-80 |

### 3.6 Condensate Stabilizer
| Tag | Description | Unit | Range |
|-----|-------------|------|-------|
| PT_STAB | Stabilizer column pressure | bar | 6-10 |
| TT_STAB_TOP | Top temperature | °C | 50-80 |
| TT_STAB_BOT | Bottom (reboiler) temperature | °C | 180-220 |
| FT_COND_OUT | Stabilized condensate rate | m³/d | 0-150 |
| AI_RVP | Reid Vapor Pressure | psi | 8-12 (max 12) |

### 3.7 Centrifugal Gas Compression (per ITP Neuquén Week 11)
| Tag | Description | Unit | Setpoint/Range |
|-----|-------------|------|---------------|
| PT_COMP_SUCT | Compressor suction P | bar | 55-62 (SP: 58.8) |
| PT_COMP_DISCH | Compressor discharge P | bar | 60-67 (SP: 63.7) |
| TT_COMP_SUCT | Suction temperature | °C | 30-50 |
| TT_COMP_DISCH | Discharge temperature | °C | 80-130 |
| SI_COMP | Speed | rpm | 8000-12000 |
| VT_COMP | Vibration | mm/s | 0-7 |
| ZT_ANTISURGE | Anti-surge valve position | % | 0-100 (0 normal) |
| FT_RECYCLE | Anti-surge recycle flow | Mm³/d | 0-50 |


### 3.8 Fiscal Metering — must comply with NAG-602 Tabla 1
| Tag | Description | Unit | NAG-602 Limit |
|-----|-------------|------|---------------|
| FQI_GAS_FISCAL | Sales gas fiscal flow | Mm³/d | 0-300 |
| FQI_COND_FISCAL | Condensate fiscal flow | m³/d | 0-200 |
| AI_PCS | Gross Heating Value | kcal/m³ | 8850-10200 |
| AI_WOBBE | Wobbe Index | kcal/m³ | 11300-12470 |
| AI_DENSITY | Relative density | - | 0.58-0.70 |
| AI_DEW_HC_FISCAL | HC dew point @5500kPa | °C | < -4 |
| AI_H2O_FISCAL | Water content | mg/m³ | < 65 |
| AI_H2S_FISCAL | H2S content | mg/m³ | < 3 |
| AI_S_TOTAL | Total sulfur | mg/m³ | < 15 |
| AI_CO2_FISCAL | CO2 | % molar | < 2 |
| AI_O2_FISCAL | O2 | % molar | < 0.2 |

---

## 4. UTILITIES SIGNALS (Layer 3)

### 4.1 Hot Oil System
| Tag | Description | Unit | Range |
|-----|-------------|------|-------|
| TT_HOTOIL_SUPPLY | Supply temperature | °C | 240-280 |
| TT_HOTOIL_RETURN | Return temperature | °C | 180-220 |
| PT_HOTOIL | System pressure | bar | 3-6 |
| FT_HOTOIL | Circulation flow | m³/h | 30-80 |
| TT_HEATER_STACK | Heater stack temperature | °C | 280-380 |
| AI_O2_STACK | Stack O2 (excess air) | % | 2-6 |
| ZT_FUEL_VALVE | Fuel gas valve position | % | 20-90 |

### 4.2 Instrument Air
| Tag | Description | Unit | Range |
|-----|-------------|------|-------|
| PT_IA_HEADER | Header pressure | bar | 6-8 (SP: 7) |
| TT_IA_DEWPOINT | Dew point | °C | < -40 |
| LT_IA_ACCUM | Accumulator level | % | 50-90 |

### 4.3 Flare/Antorcha System
| Tag | Description | Unit | Range |
|-----|-------------|------|-------|
| FT_FLARE_HP | HP flare flow | Mm³/d | 0-200 (spike during ESD) |
| FT_FLARE_LP | LP flare flow | Mm³/d | 0-50 |
| TT_FLARE_PILOT | Pilot temperature | °C | 600-900 (always >500) |
| PT_KO_DRUM | KO drum pressure | bar | 0.05-0.5 |
| LT_KO_DRUM | KO drum level | % | 0-80 |
| QI_FLARE_SMOKE | Smoke opacity | % | 0-30 |

---

## 5. EVENTS & STATE MACHINE

### 5.1 Well-level events
| Event | Trigger | Effect | Duration | Recovery |
|-------|---------|--------|----------|----------|
| PRODUCING | normal | baseline Arps decline | continuous | n/a |
| FLOWBACK | first 30 days | unstable, high watercut 40-80% | 30 days | gradual stabilization |
| GAS_LOCK | random ~0.02%/min | ESP current drops 30-50% | 1-6h | manual restart |
| SAND_PLUG | AI_SAND > 30 sustained | rate decline 20-50% | hours-days | choke cleaning |
| HIGH_WHP_ALARM | WHP > 170 bar | well trip, choke 0% | until ack | gradual reopening |
| HIGH_VIBRATION | VT_ESP > 5 mm/s | warning; > 7 → trip | hours | inspection |
| SHUTDOWN | scheduled or alarm | all rates = 0 | 2-24h | planned restart |
| IDLE | before first_production | rates = 0 | until first_prod | start of life |

### 5.2 Plant-level events
| Event | Trigger | Effect | Recovery |
|-------|---------|--------|----------|
| HIGH_SEP_LEVEL | LT_SEP_OIL > 75% | dump valve opens | self-correcting |
| LOW_TEG_CIRC | FT_TEG_CIRC < 600 L/h | dew point degrades | restart pump |
| HYDRATE_FORMATION | TT_LTS < -20°C + H2O high | PDT_LTS climbs | methanol inj |
| PROPANE_LOW_PRESS | PT_PROP_SUCT < 0.5 bar | refrig drops | refrigerant top-up |
| COMP_SURGE | close to surge curve | anti-surge valve opens | auto-recovers |
| COMP_HIGH_VIB | VT_COMP > 7 mm/s | trip compressor | shutdown seq |

### 5.3 ESD (Emergency Shutdown) — Major event
**Triggers** (logged in `esd_reason`):
- `FIRE_GAS_HIGH` — Fire & Gas detector > 60% LEL
- `HIGH_H2S` — H2S > 10 ppm in process area
- `HIGH_HIGH_PRESSURE` — any PT_HHH alarm (e.g. PT_SEP > 15 bar)
- `LOW_LOW_LEVEL` — pump cavitation risk (LT_SEP_OIL < 10%)
- `HIGH_HIGH_TEMP` — TT_COMP_DISCH > 150°C
- `POWER_FAILURE` — total electrical loss
- `INSTRUMENT_AIR_LOSS` — PT_IA_HEADER < 5 bar (fail-safe closed)
- `EXTERNAL_TRIP` — operator manual ESD
- `PLANNED_MAINTENANCE` — scheduled

**Sequence on ESD:**
1. T+0s — All ESD valves go to fail-safe (gas: closed; flare: open)
2. T+0-30s — Wellhead SDVs close → all well rates → 0
3. T+0-60s — Plant inventory depressurizes to flare (HP_FLARE spike 100-200 Mm³/d for 10-20 min)
4. T+0-2min — Compressors trip (anti-surge fully open, then SD)
5. T+0-5min — Hot oil heater shuts down, propane refrigeration trips
6. T+5min+ — Pilot flames remain (TT_FLARE_PILOT > 500°C)
7. Duration: 2-12 hours
8. Recovery (30-90 min): N2 purge → restart compressors → open wellhead SDVs one by one → wells ramp 15-30 min → plant stable in 45-90 min

---

## 6. PHYSICAL RELATIONSHIPS

### 6.1 Well physics
- **Decline**: Arps hyperbolic q(t) = qi / (1 + b·Di·t)^(1/b); b=1.3-1.8, Di=0.008-0.015/d
- **Three phases**: Flowback (0-30d), Plateau (30-90d), Decline (90+d)
- **WHP**: inverse relation with choke_pct
- **GOR creep**: +0.3 m³/m³ per day
- **Watercut creep**: linear +0.0003/day until 0.45
- **Composition shift**: rising GOR → slightly lower C1, higher C2-C5

### 6.2 Plant physics
- Mass balance: Σ(wells_gas) = inlet_gas + flare_gas + fuel_gas
- Separator P controlled by PCV
- TEG: water removal ∝ circulation × (1 - T/40)
- LTS: outlet T = inlet T - ΔT, ΔT ∝ propane circulation
- Hydrate curve: T < hydrate_temp(P, gas) → risk
- Compressor: discharge_P = suction_P × ratio(speed)
- Anti-surge: FT < surge_line → ZT_ANTISURGE opens proportionally

### 6.3 Quality propagation
- Inlet composition = weighted avg of wells (by flow)
- TEG removes H2O: outlet = inlet × (1 - efficiency)
- LTS reduces HC dew point ~20-30°C
- H2S, CO2 pass through (assume sweet — no amine unit)

---

## 7. OUTPUT FORMAT

Three Parquet datasets, partitioned by date:

data/raw/
├── wells/pad=PAD-LLL-01/date=YYYY-MM-DD/data.parquet
├── plant/pad=PAD-LLL-01/date=YYYY-MM-DD/data.parquet
└── utilities/pad=PAD-LLL-01/date=YYYY-MM-DD/data.parquet

Upload destinations:
- LocalStack: `s3://vaca-muerta-raw/...`
- AWS real: `s3://vaca-muerta-raw-919064997947/...`

---

## 8. CLI INTERFACE

```bash
uv run src/simulator.py                                    # Default: 180d, 1min
uv run src/simulator.py --upload local                     # Upload to LocalStack
uv run src/simulator.py --upload aws                       # Upload to AWS real
uv run src/simulator.py --days 365 --freq 1 --start 2024-01-01
uv run src/simulator.py --layers wells,plant               # Subset
uv run src/simulator.py --inject-esd 2024-03-15T14:00:00 --esd-reason FIRE_GAS_HIGH
uv run src/simulator.py --inject-gas-lock LLL-002 2024-04-10T08:00:00
```

---

## 9. CODE QUALITY

- Python 3.12+ managed with `uv`
- Type hints + Pydantic models for config
- Rich console output with progress bars
- Modular structure:
  - `simulator/wells.py` — Layer 1
  - `simulator/plant.py` — Layer 2
  - `simulator/utilities.py` — Layer 3
  - `simulator/events.py` — event injection, state machines
  - `simulator/physics.py` — decline curves, compressor, hydrate
  - `simulator/quality.py` — composition propagation
  - `simulator/output.py` — Parquet + S3 upload
  - `simulator/cli.py` — Typer interface
- Summary table per layer at end of run
- All datetime UTC, ISO 8601
