// =========================================================
// PitStop OS - Simulation Orchestrator & Time Machine (Phase 8)
// Coordinates simulation boot/reset, presets, tick steps,
// Deadlock demo, and Time Machine snapshot history/replay.
// =========================================================

import {
  exportProcessState,
  getAllProcesses,
  importProcessState,
  resetProcesses,
  setSelectedPid,
} from './processes.js';
import {
  enqueueReadyProcess,
  exportSchedulerState,
  getSchedulerState,
  importSchedulerState,
  isSimulationComplete,
  removePidFromScheduler,
  resetScheduler,
  stepSchedulerTick,
} from './scheduler.js';
import {
  exportKernelState,
  importKernelState,
  logKernelEvent,
  resetKernel,
  sysCreateProcess,
  sysTerminateProcess,
} from './kernel.js';
import {
  exportThreadState,
  importThreadState,
  initializeProcessThreads,
  resetThreadCounter,
  syncThreadsWithProcesses,
} from './threads.js';
import {
  EQUIPMENT_IDS,
  acquireResource,
  exportResourceState,
  getDeadlockStatus,
  getResourceById,
  importResourceState,
  resetResources,
} from './resources.js';

export const WORKLOAD_PRESETS = {
  balanced: [
    {
      name: 'Sedan Civic - Front Tires',
      serviceType: 'Tire Replacement',
      priority: 2,
      arrivalTime: 0,
      cpuBurst: 6,
      ioBurst: 2,
    },
    {
      name: 'SUV Fortuner - All Wheels',
      serviceType: 'Wheel Balancing',
      priority: 1,
      arrivalTime: 0,
      cpuBurst: 4,
      ioBurst: 2,
    },
    {
      name: 'Hatchback Wigo - Safety Check',
      serviceType: 'Tire Inspection',
      priority: 3,
      arrivalTime: 1,
      cpuBurst: 3,
      ioBurst: 0,
    },
    {
      name: 'Pickup Hilux - Rear Axle',
      serviceType: 'Tire Replacement',
      priority: 2,
      arrivalTime: 2,
      cpuBurst: 5,
      ioBurst: 1,
    },
  ],
  'cpu-heavy': [
    {
      name: 'Delivery Van - 4 Tire Swap',
      serviceType: 'Tire Replacement',
      priority: 2,
      arrivalTime: 0,
      cpuBurst: 10,
      ioBurst: 0,
    },
    {
      name: 'Sports Coupe - Precision Balance',
      serviceType: 'Wheel Balancing',
      priority: 1,
      arrivalTime: 1,
      cpuBurst: 8,
      ioBurst: 0,
    },
    {
      name: 'SUV Montero - Full Tread Overhaul',
      serviceType: 'Tire Replacement',
      priority: 3,
      arrivalTime: 2,
      cpuBurst: 7,
      ioBurst: 1,
    },
  ],
  'io-heavy': [
    {
      name: 'Sedan Vios - Valve & Balance',
      serviceType: 'Wheel Balancing',
      priority: 2,
      arrivalTime: 0,
      cpuBurst: 3,
      ioBurst: 4,
    },
    {
      name: 'Crossover HRV - Pressure Diagnostics',
      serviceType: 'Tire Inspection',
      priority: 1,
      arrivalTime: 0,
      cpuBurst: 3,
      ioBurst: 5,
    },
    {
      name: 'Sedan Altis - Alignment & Mount',
      serviceType: 'Tire Replacement',
      priority: 3,
      arrivalTime: 1,
      cpuBurst: 4,
      ioBurst: 4,
    },
  ],
};

// Time Machine state: array of tick snapshots
let snapshots = [];
let viewIndex = -1;

function buildSnapshot(label = '') {
  const tick = getSchedulerState().currentTick;
  return {
    tick,
    label: label || `Tick ${tick}`,
    processes: exportProcessState(),
    scheduler: exportSchedulerState(),
    kernel: exportKernelState(),
    threads: exportThreadState(),
    resources: exportResourceState(),
  };
}

function restoreSnapshotObject(snap) {
  if (!snap) return;
  importProcessState(snap.processes);
  importSchedulerState(snap.scheduler);
  importKernelState(snap.kernel);
  importThreadState(snap.threads);
  importResourceState(snap.resources);
}

/**
 * Saves a new snapshot at the end of the Time Machine timeline.
 */
export function captureSnapshot(label = '') {
  // If user previously rewound and resumed from an earlier tick, trim future states
  if (viewIndex >= 0 && viewIndex < snapshots.length - 1) {
    snapshots = snapshots.slice(0, viewIndex + 1);
  }
  snapshots.push(buildSnapshot(label));
  viewIndex = snapshots.length - 1;
}

/**
 * Updates the current live snapshot (e.g., after manual user syscall at current tick).
 */
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

/**
 * Jumps Time Machine view to a specific snapshot index.
 */
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

/**
 * Finds and previews the snapshot matching a given simulation tick.
 */
export function jumpToTickSnapshot(tick) {
  const target = Number(tick);
  const idx = snapshots.findIndex((s) => s.tick === target);
  if (idx === -1) return false;
  return previewSnapshot(idx);
}

/**
 * Commits the currently previewed historical snapshot as the new live state.
 */
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

/**
 * Resets the entire simulator with a chosen workload preset.
 */
export function resetSimulation(presetKey = 'balanced') {
  const starterJobs = WORKLOAD_PRESETS[presetKey] || WORKLOAD_PRESETS.balanced;
  resetProcesses(starterJobs);
  resetThreadCounter(1);
  for (const pcb of getAllProcesses()) {
    initializeProcessThreads(pcb);
  }
  resetResources();
  resetScheduler();
  resetKernel();
  logKernelEvent(0, `Loaded "${presetKey}" preset (${starterJobs.length} jobs).`, 'BOOT');

  snapshots = [];
  viewIndex = -1;
  captureSnapshot('Tick 0 (Initial)');
}

/**
 * Advances simulation by one tick unless deadlocked, replaying history, or finished.
 */
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
    logKernelEvent(result.tick, 'All vehicle service jobs completed.', 'KERNEL');
  }

  captureSnapshot(`Tick ${result.tick}`);

  return {
    haltedByDeadlock: false,
    completed: result.completed,
    tick: result.tick,
    events: result.events,
  };
}

/**
 * Triggers the predefined 2-process, 2-equipment-lock circular wait Deadlock demo.
 */
export function runDeadlockDemo() {
  resetProcesses([]);
  resetThreadCounter(1);
  resetResources();
  resetScheduler();
  resetKernel();

  const procA = sysCreateProcess(
    {
      name: 'Sedan Civic - Mount & Balance',
      serviceType: 'Tire Replacement',
      priority: 1,
      arrivalTime: 0,
      cpuBurst: 4,
      ioBurst: 0,
    },
    0
  );

  const procB = sysCreateProcess(
    {
      name: 'SUV Fortuner - Balance & Mount',
      serviceType: 'Wheel Balancing',
      priority: 1,
      arrivalTime: 0,
      cpuBurst: 4,
      ioBurst: 0,
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

/**
 * Resolves an active circular deadlock by terminating the second lock holder
 * (OS Deadlock Recovery) so the remaining process can acquire its lock and proceed.
 */
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
    `Deadlock resolved: Terminated PID ${victimPid}, freeing Wheel Balancer for remaining job.`,
    'RECOVERY'
  );
  captureSnapshot(`Tick ${tick} (Resolved)`);
  return true;
}
