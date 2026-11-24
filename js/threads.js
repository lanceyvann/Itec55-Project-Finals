// =========================================================
// PitStop OS - Thread Management (TCB) (Phase 6)
// Manages multiple Mechanic Service Tasks (threads) per
// Vehicle Service Job (process), private vs shared data.
// =========================================================

import { PROCESS_STATES, getAllProcesses, getProcessByPid } from './processes.js';

let nextTid = 1;

const SERVICE_THREAD_TEMPLATES = {
  'Tire Replacement': [
    'Tire Inspection',
    'Tire Removal',
    'Tire Installation',
  ],
  'Wheel Balancing': [
    'Rim & Tire Inspection',
    'Balancer Spin Measurement',
    'Counterweight Calibration',
  ],
  'Tire Inspection': [
    'Tread Depth Check',
    'Valve & Pressure Test',
    'Safety Sign-Off',
  ],
};

/**
 * Resets the global TID counter.
 */
export function resetThreadCounter(startTid = 1) {
  nextTid = startTid;
}

/**
 * Creates a single Thread Control Block (TCB).
 */
export function createTCB(parentPid, taskName) {
  const tid = nextTid++;
  return {
    tid,
    parentPid: Number(parentPid),
    name: String(taskName || `Mechanic Task #${tid}`),
    state: 'Ready',
    privateRegisters: {
      SP: `0x${(8000 + tid * 16).toString(16).toUpperCase()}`,
      PC: `0x${(200 + tid * 4).toString(16).toUpperCase()}`,
      LR: `0x${(100 + tid * 2).toString(16).toUpperCase()}`,
    },
  };
}

/**
 * Initializes the default 3 mechanic threads for a vehicle service job.
 */
export function initializeProcessThreads(pcb) {
  if (!pcb) return [];
  const names =
    SERVICE_THREAD_TEMPLATES[pcb.serviceType] ||
    SERVICE_THREAD_TEMPLATES['Tire Replacement'];

  pcb.threads = names.map((taskName) => createTCB(pcb.pid, taskName));
  return pcb.threads;
}

/**
 * Spawns an additional thread inside an active process.
 */
export function addThreadToProcess(pid, taskName) {
  const pcb = getProcessByPid(pid);
  if (!pcb || pcb.state === PROCESS_STATES.TERMINATED) return null;

  const tcb = createTCB(pcb.pid, taskName);
  pcb.threads.push(tcb);
  return tcb;
}

/**
 * Joins (completes) a thread inside a process.
 */
export function joinThreadInProcess(pid, tid = null) {
  const pcb = getProcessByPid(pid);
  if (!pcb || !pcb.threads || pcb.threads.length === 0) return null;

  const target =
    (tid ? pcb.threads.find((t) => t.tid === Number(tid)) : null) ||
    pcb.threads.find((t) => t.state !== 'Terminated');

  if (!target) return null;

  target.state = 'Terminated';
  return target;
}

/**
 * Synchronizes each process's TCB states based on its execution progress.
 */
export function syncThreadsWithProcesses() {
  const processes = getAllProcesses();

  for (const pcb of processes) {
    if (!pcb.threads || pcb.threads.length === 0) continue;

    if (pcb.state === PROCESS_STATES.TERMINATED) {
      for (const t of pcb.threads) {
        t.state = 'Terminated';
      }
      continue;
    }

    const total = pcb.threads.length;
    const completedRatio =
      pcb.cpuBurst > 0 ? (pcb.cpuBurst - pcb.remainingTime) / pcb.cpuBurst : 0;
    const doneCount = Math.min(total - 1, Math.floor(completedRatio * total));

    pcb.threads.forEach((t, index) => {
      if (t.state === 'Terminated' && pcb.state !== PROCESS_STATES.NEW) {
        return;
      }

      if (index < doneCount) {
        t.state = 'Terminated';
      } else if (index === doneCount) {
        if (pcb.state === PROCESS_STATES.RUNNING) {
          t.state = 'Running';
          t.privateRegisters.PC = `0x${(
            200 +
            t.tid * 4 +
            (pcb.cpuBurst - pcb.remainingTime)
          )
            .toString(16)
            .toUpperCase()}`;
        } else if (pcb.state === PROCESS_STATES.WAITING) {
          t.state = 'Waiting';
        } else {
          t.state = 'Ready';
        }
      } else {
        t.state = 'Ready';
      }
    });
  }
}

/**
 * Describes shared vs. private resources for the selected process.
 */
export function getSharedProcessResources(pcb) {
  if (!pcb) return null;

  return {
    workOrder: `Work Order #${pcb.pid} (${pcb.name})`,
    memorySpace: `0x${pcb.pid}000 - 0x${pcb.pid}FFF`,
    equipmentLocks:
      pcb.heldResources && pcb.heldResources.length > 0
        ? pcb.heldResources.join(', ')
        : 'None currently locked',
  };
}

export function exportThreadState() {
  return { nextTid };
}

export function importThreadState(snapshot) {
  if (snapshot && typeof snapshot.nextTid === 'number') {
    nextTid = snapshot.nextTid;
  }
}
