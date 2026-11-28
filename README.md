# PitStop OS — Automotive Tire Replacement Shop Mini-OS Simulator

**Live Deployed Application:** [Insert Your Vercel URL Here, [e.g., https://vercel.app](https://itec55-pitstopos-finals.vercel.app/)

## Overview
**PitStop OS** is an interactive, browser-based Operating System Simulator built with **Vanilla JavaScript (ES6 Modules), HTML5, and CSS3**. It models core operating system concepts—including User/Kernel privilege mode traps, five-state process lifecycle management, multi-threading, CPU scheduling policies, mutex synchronization, deadlock detection/recovery, and deterministic benchmarking—through an **Automotive Tire Replacement Shop** scenario.

---

## Project Directory Structure

```text
PitStop-OS/
├── index.html          # Main application layout, modals, and semantic UI structure
├── css/
│   └── styles.css      # Responsive workshop styling, tables, Gantt timeline, and modals
├── js/
│   ├── main.js         # UI controller, DOM bindings, Dual View switcher, and playback loop
│   ├── simulation.js   # Central orchestrator, workload presets, Rush Hour, and Time Machine
│   ├── kernel.js       # CPU privilege modes (User/Kernel), system call wrappers, and event log
│   ├── scheduler.js    # CPU scheduling engine (FCFS, SJF, Round Robin, Priority) and metrics
│   ├── processes.js    # Process Control Block (PCB) factory and 5-state lifecycle FSM
│   ├── threads.js      # Thread Control Block (TCB) management and shared/private resources
│   ├── resources.js    # Equipment mutex locks, circular deadlock detection, and recovery
│   ├── benchmark.js    # Isolated 12-run benchmarking & reproducibility verification suite
│   └── guide.js        # Dual View (Story Mode <-> OS Mode) scenario mapping reference
└── README.md           # Project setup, architecture, and deployment documentation
```

---

## Prerequisite Dependencies & Tech Stack

* **Core Languages:** HTML5, CSS3, JavaScript (ECMAScript 2022 / ES6 Modules)
* **Runtime & Build Frameworks:** Zero external runtime frameworks or third-party npm dependencies required (100% native browser ES6 modules).
* **Supported Browsers:** Google Chrome (v90+), Microsoft Edge (v90+), Mozilla Firefox (v90+), or Safari (v15+) with JavaScript and ES6 module support enabled.
* **Local Development Server (Optional):** Any static HTTP server (such as VS Code Live Server, Python 3 `http.server`, or Node.js `npx serve`) is required locally because browsers enforce CORS policies on `type="module"` scripts over `file://`.

---

## Environmental Setup & Local Execution Commands

### Option 1: Instant Cloud Access (Recommended)
Open the compiled production deployment directly in any modern web browser:
* **URL:** `[Insert Your Vercel URL Here]`

### Option 2: Run Locally via Python Built-in HTTP Server
1. Extract the project ZIP archive and open a terminal inside the root folder:
   ```bash
   cd PitStop-OS
   ```
2. Start a local static server on port `8080`:
   ```bash
   python -m http.server 8080
   ```
3. Open your browser and navigate to:
   ```text
   http://localhost:8080
   ```

### Option 3: Run Locally via Node.js (`serve`)
1. Open a terminal inside the extracted project directory:
   ```bash
   cd PitStop-OS
   ```
2. Launch a zero-config static server:
   ```bash
   npx serve -l 8080
   ```
3. Open `http://localhost:8080` in your browser.

---

## Deployment Parameters (Vercel)

* **Framework Preset:** `Other` (Static HTML/CSS/JS)
* **Root Directory:** `./`
* **Build Command:** None required (static ES6 modules served directly)
* **Output Directory:** `./`
* **Install Command:** None required

---

## Key Features Implemented

* **Dual View (`Story Mode` vs. `OS Mode`):** Dynamically switches all UI labels, logs, and status indicators between *Tire Replacement Shop* analogies and standard *Operating System* terminology.
* **"Why?" Service Bay Assignment Explainer:** Click any block on the Live Gantt Chart (`Service Bay Timeline`) to inspect why the active algorithm dispatched that process at that tick.
* **Shift Replay (Time Machine):** Scrub backward or forward through saved tick snapshots and click **Resume Here** to branch execution from any historical state.
* **Four CPU Scheduling Algorithms:** Supports **FCFS**, **SJF (Non-Preemptive)**, **Round Robin** (configurable time quantum `Q`), and **Priority Scheduling**.
* **Interactive System Calls & Deadlock Recovery:** Trigger `createProcess()`, `terminateProcess()`, `createThread()`, `joinThread()`, `requestIO()`, `yieldProcess()`, and simulate/resolve circular mutex deadlocks.
* **Automated Shop Benchmark Suite:** Executes all 4 algorithms across 3 fixed presets (*Balanced*, *Bay-Heavy*, *Equipment-Heavy* — 12 total runs) in an isolated engine sandbox.
