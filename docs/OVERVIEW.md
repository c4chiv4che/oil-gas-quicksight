# Project Overview — For Non-Technical Readers

This document explains, in plain language, what this project is, what it simulates, and why it has value. No oil & gas or software background required.

---

## In one sentence

This project recreates the data that a real Vaca Muerta shale-gas operation would generate — thousands of sensor readings per minute — and pipes it into the cloud so it can be analyzed and visualized, the same way a real energy company monitors its plants.

---

## The real-world problem it represents

A gas processing facility is a web of wells, pipes, compressors, and safety systems. Every one of those has sensors: pressure, temperature, flow, vibration, gas composition. A medium plant produces **thousands of readings every minute, around the clock.**

Someone has to watch that flood of data and answer questions like: Is each well healthy? Is the gas we're selling within legal quality limits? Did a safety shutdown happen, and how did the plant respond? Are we losing production somewhere?

Doing this well saves money, prevents accidents, and keeps the gas saleable. Doing it badly means lost revenue, regulatory fines, or unsafe conditions.

This project builds the full chain — from "sensor" to "dashboard" — for a realistic simulated operation.

---

## What the simulator does

Since we don't have a real plant wired up, the project includes a **simulator**: a program that generates data exactly as a real facility would, following the physics and the Argentinian industry standards. It produces about **1.5 million readings** covering 6 months of operation for a 4-well pad and its processing plant.

The data is realistic enough that the patterns a real control-room operator would recognize are all there: wells declining over time, a plant emergency shutdown, gas going out of quality spec, equipment vibration creeping up.

---

## The three layers

The operation is modeled in three connected layers, just like reality:

**1. The Wells (upstream)** — Four shale wells pulling oil, gas, and water out of the ground. Each behaves like a real well: high production at first, then a slow natural decline; occasional problems like "gas lock" (a pump airlock) or sand blocking the flow.

**2. The Plant (midstream)** — Where the raw mix from the wells gets cleaned and separated into saleable products. Water removed, gas dried and chilled, impurities stripped, then measured for sale. This is the most complex layer.

**3. The Utilities (support)** — The systems that keep the plant running: heating oil, compressed air for instruments, and the flare (the big flame that safely burns off excess gas during emergencies).

---

## The variables, explained by layer

Each "variable" is one sensor reading. Here's what the project tracks and why each group matters.

### Wells — production & health

- **Oil / gas / water rates** — How much of each the well produces. The core measure of whether a well is making money.
- **Wellhead & downhole pressure** — How hard the well is pushing. Falling pressure signals a maturing well.
- **Gas-oil ratio & water cut** — The mix of what comes up. Too much water or gas changes the economics.
- **Pump current, frequency & vibration** — The electric pump's vitals. Rising vibration warns of failure before it happens.
- **Gas composition (methane, ethane, CO2, etc.)** — What the gas is actually made of, measured continuously.
- **Sand detection & corrosion risk** — Early warnings for the two things that destroy equipment.

*Why it matters: this is where revenue is born and where expensive failures start. Catching a sick pump early can save a six-figure repair.*

### Plant — turning raw output into saleable product

- **Separator pressures, temperatures & levels** — The first split of oil, gas, and water. Levels must stay in band or product carries over.
- **TEG dehydration** — Removing water from the gas (wet gas corrodes pipelines and forms ice-like blockages).
- **Refrigeration / dew point** — Chilling the gas to drop out heavy components so it meets pipeline spec.
- **Compression (suction/discharge pressure, vibration, anti-surge)** — Boosting gas pressure for the sales pipeline. Compressors are the most expensive, most protected machines in the plant.
- **Fiscal metering & quality (PCS, Wobbe Index, density, H2S, CO2, water content)** — The legally-measured properties of the gas being sold. These must meet the **NAG-602** national standard or the gas can't enter the pipeline.

*Why it matters: this is the difference between sellable product and rejected product. The Wobbe Index alone determines if your gas is "too rich" to sell.*

### Utilities — keeping it all alive

- **Hot oil system** — Provides heat across the plant. When it drops, processes stall.
- **Instrument air** — Powers the pneumatic valves. Lose it and the plant fails safe (shuts down).
- **Flare (high/low pressure, pilot, smoke)** — The safety relief. During an emergency shutdown, the flare can spike to burn off the entire plant's gas inventory in minutes.

*Why it matters: utilities are invisible until they fail — and when they fail, everything stops.*

### The ESD — Emergency Shutdown

A special set of readings tracks plant **emergency shutdowns** (ESD): the automatic safety sequence that trips when something dangerous is detected (fire, gas leak, overpressure). The simulator models the full 8-step sequence — wells close, plant depressurizes to the flare, compressors trip, utilities go down, then a controlled recovery. This is the single most safety-critical event in any plant.

---

## Why this has value

**For an energy company:** it demonstrates a working blueprint for turning raw sensor data into operational insight — monitoring production, ensuring gas quality compliance, and analyzing safety events — built entirely on standard, low-cost cloud tools.

**For the author's profile:** it bridges two worlds that rarely meet in one person — hands-on industrial/operational-technology knowledge of how a real plant behaves, and modern cloud data-engineering skills (infrastructure-as-code, automated pipelines, testing, BI dashboards).

**For a potential client or employer:** it's proof of end-to-end capability — from understanding what a pressure transmitter on a compressor actually means, all the way to a dashboard a manager can read at a glance. That full-stack span, grounded in the specifics of the Argentinian gas industry, is rare.

---

## What it demonstrates technically (in plain terms)

- A realistic data generator grounded in real industry standards
- Automated, repeatable cloud infrastructure (nothing done by hand that can't be reproduced)
- A tested, professional codebase (160 automated tests)
- A cost-conscious design (runs for under USD 1/month)
- Clean separation between raw data, curated summaries, and dashboards

---

*For the technical architecture, see [ARCHITECTURE.md](ARCHITECTURE.md). For the full signal specification, see [SIMULATOR_SPEC.md](SIMULATOR_SPEC.md).*
