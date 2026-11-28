# PitStop OS — Automotive Tire Replacement Shop Mini-OS Simulator

**Live Deployed Application:** [https://itec55-pitstopos-finals.vercel.app/](https://itec55-pitstopos-finals.vercel.app/)

## Overview
**PitStop OS** is an interactive, browser-based Operating System Simulator built with **HTML5, CSS3, JavaScript (ES6 Modules), TypeScript, React, and Vite**. It models core operating system mechanisms—including User/Kernel privilege mode traps, five-state process lifecycle management, multi-threading, CPU scheduling policies, mutex synchronization, deadlock detection and recovery, and deterministic benchmarking—through an **Automotive Tire Replacement Shop** scenario.

---

## Project Directory Structure

```text
PitStop-OS/
├── .gitignore          # Git ignore rules (excludes node_modules and dist)
├── .npmrc              # npm package manager configuration
├── index.html          # HTML root entry point
├── metadata.json       # Application metadata and configuration
├── package.json        # Project dependencies, framework versions, and npm scripts
├── tsconfig.json       # TypeScript compiler configuration
├── vite.config.ts      # Vite bundler and development server configuration
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
├── src/
│   ├── main.tsx        # React DOM root mounting entry point
│   ├── App.tsx         # TypeScript/React application layer and UI components
│   └── index.css       # Application styling and responsive layout rules
└── README.md           # Project setup, deployment parameters, and execution guide
```

---

## Prerequisite Dependencies & Framework Versions

* **Runtime Environment:** Node.js (v18.0+ recommended) and npm (v9.0+ recommended)
* **Frontend & Core Frameworks (`package.json`):**
  * **React / React DOM:** `^19.0.1`
  * **TypeScript:** `^7.0.2`
  * **Vite (`@vitejs/plugin-react` `^6.1.1`):** `^8.3.0`
  * **Tailwind CSS (`@tailwindcss/vite`):** `^4.3.3`
  * **UI & Animation Libraries:** `lucide-react` (`^0.546.0`), `motion` (`^12.23.24`)
  * **Additional Packages:** `@google/genai` (`^2.4.0`), `express` (`^4.21.2`), `dotenv` (`^17.2.3`)
* **Supported Browsers:** Google Chrome, Microsoft Edge, Mozilla Firefox, or Safari (latest versions with ES6 module support enabled)

---

## Environmental Setup & Local Execution Commands

### Option 1: Instant Cloud Access (Recommended)
Open the compiled production deployment directly in any modern web browser:
* **Live URL:** [https://vercel.app](https://vercel.app)

### Option 2: Run Locally via Vite Development Server
1. Extract the project ZIP archive and open a terminal inside the root folder:
   ```bash
   cd PitStop-OS
   ```
2. Install all project dependencies listed in `package.json`:
   ```bash
   npm install
   ```
3. Start the Vite development server (configured in `package.json` to run on port `3000` with host `0.0.0.0`):
   ```bash
   npm run dev
   ```
4. Open your browser and navigate to:
   ```text
   http://localhost:3000
   ```

### Option 3: Build, Type-Check & Preview Compiled Production Bundle
1. Run TypeScript type verification:
   ```bash
   npm run lint
   ```
2. Compile the optimized production bundle into `dist/`:
   ```bash
   npm run build
   ```
3. Preview the compiled production build locally:
   ```bash
   npm run preview
   ```

### Option 4: Run Static Entry Directly via Python HTTP Server
If serving the static `index.html` and `js/` ES6 modules directly without Node.js:
```bash
python -m http.server 8080
```
Then open `http://localhost:8080` in your browser.

---

## Deployment Parameters (Vercel)

* **Framework Preset:** `Vite`
* **Root Directory:** `./`
* **Install Command:** `npm install`
* **Build Command:** `npm run build`
* **Output Directory:** `dist`

---

## Key Features Implemented

* **Dual View (`Story Mode` vs. `OS Mode`):** Dynamically switches all UI labels, logs, and status indicators between *Tire Replacement Shop* analogies and standard *Operating System* terminology.
* **"Why?" Service Bay Assignment Explainer:** Click any block on the Live Gantt Chart (`Service Bay Timeline`) to inspect why the active scheduling rule dispatched that job at that tick.
* **Shift Replay (Time Machine):** Scrub backward or forward through saved tick snapshots and click **Resume Here** to branch execution from any historical state.
* **Four CPU Scheduling Algorithms:** Supports **FCFS**, **SJF (Non-Preemptive)**, **Round Robin** (configurable time quantum `Q`), and **Priority Scheduling**.
* **Interactive System Calls & Deadlock Recovery:** Trigger process creation (`createProcess()`), termination (`terminateProcess()`), thread creation/joining (`createThread()`, `joinThread()`), equipment I/O requests (`requestIO()`), CPU yields (`yieldProcess()`), and simulate/resolve circular mutex deadlocks.
* **Automated Shop Benchmark Suite:** Executes all 4 algorithms across 3 fixed presets (*Balanced*, *Bay-Heavy*, *Equipment-Heavy* — 12 total runs) in an isolated engine sandbox to compare waiting time, turnaround time, response time, context switches, and CPU utilization.
