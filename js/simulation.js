// =========================================================
// Simulation Orchestrator & Time Machine (Phase 8)
// Coordinates simulation boot/reset, presets, tick steps,
// Deadlock demo, and Time Machine snapshot history/replay.
// =========================================================

import {
  exportProcessState, getAllProcesses, importProcessState,
  resetProcesses, resetProcessesForReplay, setSelectedPid,
} from './processes.js';
import {
  enqueueReadyProcess, exportSchedulerState, getSchedulerState, importSchedulerState, 
  isSimulationComplete, removePidFromScheduler, resetScheduler, stepSchedulerTick,
} from './scheduler.js';
import {
  exportKernelState, importKernelState, logKernelEvent,
  resetKernel, sysCreateProcess, sysTerminateProcess,
} from './kernel.js';
import {
  exportThreadState, importThreadState, initializeProcessThreads,
  resetThreadCounter, resetThreadsForReplay,syncThreadsWithProcesses,
} from './threads.js';
import {
  EQUIPMENT_IDS, acquireResource, exportResourceState, getDeadlockStatus, 
  getResourceById, importResourceState, resetResources,
} from './resources.js';

function deepFreeze(value) {
  if (!value || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const prop of Object.values(value)) {
    if (prop && typeof prop === 'object' && !Object.isFrozen(prop)) {
      deepFreeze(prop);
    }
  }
  return value;
}

export const WORKLOAD_PRESETS = deepFreeze({
  balanced: [
    {
      name: 'Sedan Civic - Front Tires', serviceType: 'Tire Replacement',
      priority: 2, arrivalTime: 0, cpuBurst: 6, ioBurst: 2,
    },
    {
      name: 'SUV Fortuner - All Wheels', serviceType: 'Wheel Balancing',
      priority: 1, arrivalTime: 0, cpuBurst: 4, ioBurst: 2,
    },
    {
      name: 'Hatchback Wigo - Safety Check', serviceType: 'Tire Inspection',
      priority: 4, arrivalTime: 1, cpuBurst: 3, ioBurst: 0,
    },
    {
      name: 'Pickup Hilux - Rear Axle', serviceType: 'Tire Replacement',
      priority: 3, arrivalTime: 2, cpuBurst: 5, ioBurst: 1,
    },
  ],
  'cpu-heavy': [
    {
      name: 'Delivery Van - 4 Tire Swap', serviceType: 'Tire Replacement',
      priority: 2, arrivalTime: 0, cpuBurst: 10, ioBurst: 0,
    },
    {
      name: 'Sports Coupe - Precision Balance', serviceType: 'Wheel Balancing',
      priority: 1, arrivalTime: 1, cpuBurst: 8, ioBurst: 0,
    },
    {
      name: 'SUV Montero - Full Tread Overhaul', serviceType: 'Tire Replacement',
      priority: 3, arrivalTime: 2, cpuBurst: 7, ioBurst: 1,
    },
  ],
  'io-heavy': [
    {
      name: 'Sedan Vios - Valve & Balance', serviceType: 'Wheel Balancing',
      priority: 2, arrivalTime: 0, cpuBurst: 3, ioBurst: 4,
    },
    {
      name: 'Crossover HRV - Pressure Diagnostics', serviceType: 'Tire Inspection',
      priority: 1, arrivalTime: 0, cpuBurst: 2, ioBurst: 5,
    },
    {
      name: 'Sedan Altis - Alignment & Mount', serviceType: 'Tire Replacement',
      priority: 3, arrivalTime: 1, cpuBurst: 4, ioBurst: 3,
    },
  ],
});

// Predefined Rush Hour vehicle templates with fixed attributes
export const RUSH_HOUR_TEMPLATES = deepFreeze([
  {
    name: 'Hatchback Jazz - Express Patch', serviceType: 'Tire Inspection',
    priority: 1, arrivalTime: 0, cpuBurst: 3, ioBurst: 1,
  },
  {
    name: 'Pickup Ranger - Mud-Terrain Mount', serviceType: 'Tire Replacement',
    priority: 2, arrivalTime: 0, cpuBurst: 6, ioBurst: 2,
  },
  {
    name: 'MPV Innova - 4-Wheel Balance', serviceType: 'Wheel Balancing',
    priority: 2, arrivalTime: 1, cpuBurst: 4, ioBurst: 2,
  },
  {
    name: 'Sedan Accord - Front Tire Swap', serviceType: 'Tire Replacement',
    priority: 3, arrivalTime: 1, cpuBurst: 5, ioBurst: 2,
  },
  {
    name: 'Van Hiace - Fleet Safety Check', serviceType: 'Tire Inspection',
    priority: 1, arrivalTime: 0, cpuBurst: 4, ioBurst: 1,
  },
  {
    name: 'SUV Everest - High-Speed Balance', serviceType: 'Wheel Balancing',
    priority: 2, arrivalTime: 2, cpuBurst: 5, ioBurst: 1,
  },
  {
    name: 'Coupe BRZ - Performance Mount', serviceType: 'Tire Replacement',
    priority: 1, arrivalTime: 1, cpuBurst: 4, ioBurst: 2,
  },
  {
    name: 'Compact Mirage - Valve & Pressure', serviceType: 'Tire Inspection',
    priority: 4, arrivalTime: 2, cpuBurst: 2, ioBurst: 1,
  },
]);

// Time Machine & active workload state
let snapshots = [];
let viewIndex = -1;
let activeWorkloadKey = 'balanced';
let workloadCustomized = false;

function doesProcessListMatchPreset(presetKey) {
  const preset = WORKLOAD_PRESETS[presetKey];
  if (!preset) return false;
  const processes = getAllProcesses();
  if (processes.length !== preset.length) return false;

  return preset.every((tpl, idx) => {
    const pcb = processes[idx];
    return (
      pcb &&
      pcb.name === tpl.name &&
      pcb.serviceType === tpl.serviceType &&
      pcb.priority === tpl.priority &&
      pcb.arrivalTime === tpl.arrivalTime &&
      pcb.cpuBurst === tpl.cpuBurst &&
      pcb.ioBurst === tpl.ioBurst &&
      pcb.ppid === null
    );
  });
}

export function markWorkloadCustomized() {
  if (activeWorkloadKey === 'deadlock-demo') {
    workloadCustomized = true;
    return;
  }
  workloadCustomized = !doesProcessListMatchPreset(activeWorkloadKey);
}

export function getWorkloadState() {
  const isPreset = Boolean(WORKLOAD_PRESETS[activeWorkloadKey]);
  const matchesPreset = isPreset ? doesProcessListMatchPreset(activeWorkloadKey) : false;
  const isCustomized = isPreset ? workloadCustomized || !matchesPreset : true;
  return {
    activeWorkloadKey,
    isPreset,
    matchesPreset,
    isCustomized,
    processCount: getAllProcesses().length,
  };
}

function buildSnapshot(label = '') {
  const tick = getSchedulerState().currentTick;
  return {
    tick,
    label: label || `Tick ${tick}`,
    activeWorkloadKey,
    workloadCustomized,
    processes: exportProcessState(),
    scheduler: exportSchedulerState(),
    kernel: exportKernelState(),
    threads: exportThreadState(),
    resources: exportResourceState(),
  };
}

function restoreSnapshotObject(snap) {
  if (!snap) return;
  if (typeof snap.activeWorkloadKey === 'string') {
    activeWorkloadKey = snap.activeWorkloadKey;
  }
  if (typeof snap.workloadCustomized === 'boolean') {
    workloadCustomized = snap.workloadCustomized;
  }
  importProcessState(snap.processes);
  importSchedulerState(snap.scheduler);
  importKernelState(snap.kernel);
  importThreadState(snap.threads);
  importResourceState(snap.resources);
}

/*Saves a new snapshot at the end of the Time Machine timeline.*/
export function captureSnapshot(label = '') {
  // If user previously rewound and resumed from an earlier tick, trim future states
  if (viewIndex >= 0 && viewIndex < snapshots.length - 1) {
    snapshots = snapshots.slice(0, viewIndex + 1);
  }
  snapshots.push(buildSnapshot(label));
  viewIndex = snapshots.length - 1;
}

/*Updates the current live snapshot (e.g., after manual user syscall at current tick).*/
export function syncLiveSnapshot() {
  if (snapshots.length === 0) {
    captureSnapshot('Initial');
    return;
  }
  if (viewIndex === snapshots.length - 1) {
    snapshots[viewIndex] = buildSnapshot(snapshots[viewIndex].label);
  }
}

export function getTimeMachineInfo() {
  const count = snapshots.length;
  const activeSnap = viewIndex >= 0 && viewIndex < count ? snapshots[viewIndex] : null;
  const isReplaying = count > 0 && viewIndex < count - 1;

  return {
    count,
    viewIndex,
    isReplaying,
    currentSnapshotTick: activeSnap ? activeSnap.tick : 0,
    currentLabel: activeSnap ? activeSnap.label : 'Tick 0',
  };
}

/*Jumps Time Machine view to a specific snapshot index.*/
export function previewSnapshot(index) {
  const idx = Number(index);
  if (Number.isNaN(idx) || idx < 0 || idx >= snapshots.length) return false;
  viewIndex = idx;
  restoreSnapshotObject(snapshots[idx]);
  return true;
}

export function stepSnapshotBackward() {
  if (viewIndex <= 0) return false;
  return previewSnapshot(viewIndex - 1);
}

export function stepSnapshotForward() {
  if (viewIndex >= snapshots.length - 1) return false;
  return previewSnapshot(viewIndex + 1);
}

/*Finds and previews the snapshot matching a given simulation tick.*/
export function jumpToTickSnapshot(tick) {
  const target = Number(tick);
  const idx = snapshots.findIndex((s) => s.tick === target);
  if (idx === -1) return false;
  return previewSnapshot(idx);
}

/*Commits the currently previewed historical snapshot as the new live state.*/
export function resumeFromSnapshot() {
  if (viewIndex < 0 || viewIndex >= snapshots.length) return false;

  restoreSnapshotObject(snapshots[viewIndex]);
  snapshots = snapshots.slice(0, viewIndex + 1);

  const tick = getSchedulerState().currentTick;
  logKernelEvent(
    tick,
    `Time Machine: Resumed live simulation from Tick ${tick}.`,
    'TIMEMACHINE'
  );
  snapshots[viewIndex] = buildSnapshot(`Tick ${tick} (Resumed)`);
  return true;
}

/*Resets the entire simulator with a chosen workload preset.*/
export function resetSimulation(presetKey = 'balanced') {
  const resolvedKey = WORKLOAD_PRESETS[presetKey] ? presetKey : 'balanced';
  const starterJobs = WORKLOAD_PRESETS[resolvedKey].map((job) => ({ ...job }));
  activeWorkloadKey = resolvedKey;
  workloadCustomized = false;

  resetProcesses(starterJobs);
  resetThreadCounter(1);
  for (const pcb of getAllProcesses()) {
    initializeProcessThreads(pcb);
  }
  resetResources();
  resetScheduler();
  resetKernel();
  logKernelEvent(0, `Loaded "${resolvedKey}" preset (${starterJobs.length} processes).`, 'BOOT');

  snapshots = [];
  viewIndex = -1;
  captureSnapshot('Tick 0 (Initial)');
}

/*Resets scheduler, timers, queues, metrics, resources, 
and Gantt chart while preserving all existing default, custom, and Rush Hour process records.*/
export function resetSimulationPreservingProcesses() {
  resetProcessesForReplay();
  resetThreadsForReplay();
  resetResources();
  resetScheduler();
  resetKernel();
  markWorkloadCustomized();

  const totalCount = getAllProcesses().length;
  logKernelEvent(
    0,
    `Simulation reset: restored queues, timers, and Gantt chart (${totalCount} process records preserved).`,
    'BOOT'
  );

  snapshots = [];
  viewIndex = -1;
  captureSnapshot('Tick 0 (Reset)');
}

/*Rush Hour Feature: randomly selects 2-4 predefined vehicle templates with fixed attributes and spawns them with unique PIDs.*/
export function triggerRushHour() {
  if (getTimeMachineInfo().isReplaying) return [];

  const count = 2 + Math.floor(Math.random() * 3); // 2, 3, or 4 jobs
  const existingNames = new Set(getAllProcesses().map((p) => p.name));
  const unseen = RUSH_HOUR_TEMPLATES.filter((t) => !existingNames.has(t.name));
  const pool = [...(unseen.length >= count ? unseen : RUSH_HOUR_TEMPLATES)];

  // Fisher-Yates shuffle on template selection only (numeric values stay fixed)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const chosenTemplates = pool.slice(0, count);
  const currentTick = getSchedulerState().currentTick;
  const created = [];

  for (const template of chosenTemplates) {
    const pcb = sysCreateProcess({ ...template }, currentTick);
    created.push(pcb);
  }

  if (created.length > 0) {
    workloadCustomized = true;
    setSelectedPid(created[0].pid);
    logKernelEvent(
      currentTick,
      `Rush Hour activated: spawned ${created.length} predefined processes (${created
        .map((p) => `PID ${p.pid}`)
        .join(', ')}).`,
      'RUSHHOUR'
    );
    syncLiveSnapshot();
  }

  return created;
}

/*Advances simulation by one tick unless deadlocked, replaying history, or finished.*/
export function stepSimulationTick() {
  if (getTimeMachineInfo().isReplaying) {
    return { haltedByReplay: true, haltedByDeadlock: false, completed: false };
  }

  const deadlock = getDeadlockStatus();
  if (deadlock.detected) {
    logKernelEvent(
      getSchedulerState().currentTick,
      'Simulation halted: Circular deadlock active. Click Resolve or Reset.',
      'DEADLOCK'
    );
    return { haltedByDeadlock: true, completed: false };
  }

  if (isSimulationComplete()) {
    return { haltedByDeadlock: false, completed: true };
  }

  const result = stepSchedulerTick();
  const tickIndex = Math.max(0, result.tick - 1);
  for (const msg of result.events) {
    logKernelEvent(tickIndex, msg, 'SCHED');
  }

  if (result.completed) {
    logKernelEvent(result.tick, 'All processes completed.', 'KERNEL');
  }

  captureSnapshot(`Tick ${result.tick}`);

  return {
    haltedByDeadlock: false,
    completed: result.completed,
    tick: result.tick,
    events: result.events,
  };
}

/*Triggers the predefined 2-process, 2-equipment-lock circular wait Deadlock demo.*/
export function runDeadlockDemo() {
  activeWorkloadKey = 'deadlock-demo';
  workloadCustomized = true;
  resetProcesses([]);
  resetThreadCounter(1);
  resetResources();
  resetScheduler();
  resetKernel();

  const procA = sysCreateProcess(
    {
      name: 'Sedan Civic - Mount & Balance', serviceType: 'Tire Replacement',
      priority: 1, arrivalTime: 0, cpuBurst: 4, ioBurst: 0,
    },
    0
  );

  const procB = sysCreateProcess(
    {
      name: 'SUV Fortuner - Balance & Mount', serviceType: 'Wheel Balancing',
      priority: 1, arrivalTime: 0, cpuBurst: 4, ioBurst: 0,
    },
    0
  );

  const lock1 = acquireResource(EQUIPMENT_IDS.CHANGER, procA.pid, 0);
  logKernelEvent(0, lock1.reason, 'DEADLOCK');

  const lock2 = acquireResource(EQUIPMENT_IDS.BALANCER, procB.pid, 0);
  logKernelEvent(0, lock2.reason, 'DEADLOCK');

  const waitA = acquireResource(EQUIPMENT_IDS.BALANCER, procA.pid, 0);
  logKernelEvent(0, waitA.reason, 'DEADLOCK');

  const waitB = acquireResource(EQUIPMENT_IDS.CHANGER, procB.pid, 0);
  logKernelEvent(0, waitB.reason, 'DEADLOCK');

  removePidFromScheduler(procA.pid);
  removePidFromScheduler(procB.pid);
  syncThreadsWithProcesses();
  setSelectedPid(procA.pid);

  const status = getDeadlockStatus();
  if (status.detected) {
    logKernelEvent(0, status.message, 'DEADLOCK');
  }

  snapshots = [];
  viewIndex = -1;
  captureSnapshot('Tick 0 (Deadlock)');
}

/*Resolves an active circular deadlock by terminating the second lock holder 
(OS Deadlock Recovery) so the remaining process can acquire its lock and proceed.*/
export function resolveDeadlockDemo() {
  const status = getDeadlockStatus();
  if (!status.detected) return false;

  const balancer = getResourceById(EQUIPMENT_IDS.BALANCER);
  const victimPid = balancer ? balancer.ownerPid : null;
  const tick = getSchedulerState().currentTick;

  if (!victimPid) return false;

  sysTerminateProcess(
    victimPid,
    tick,
    'Terminated by OS Deadlock Recovery to break circular wait.'
  );

  for (const pcb of getAllProcesses()) {
    if (pcb.state === 'Ready') {
      enqueueReadyProcess(pcb.pid);
    }
  }
  syncThreadsWithProcesses();

  logKernelEvent(
    tick,
    `Deadlock resolved: Terminated PID ${victimPid}, freeing Wheel Balancer for remaining process.`,
    'RECOVERY'
  );
  captureSnapshot(`Tick ${tick} (Resolved)`);
  return true;
}
