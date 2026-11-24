// =========================================================
// PitStop OS - CPU Scheduling Engine (Phase 3)
// Implements FCFS, SJF (Non-Preemptive), Round Robin, and
// Priority Scheduling with Ready Queue, I/O progression,
// Context Switch tracking, and plain-language "Why?" reasons.
// =========================================================

import {
  PROCESS_STATES,
  getAllProcesses,
  getProcessByPid,
  transitionProcessState,
} from './processes.js';
import {
  acquireResource,
  getRequiredResourceForService,
  releaseAllResourcesForPid,
} from './resources.js';
import { syncThreadsWithProcesses } from './threads.js';

export const ALGORITHMS = {
  FCFS: 'FCFS',
  SJF: 'SJF',
  RR: 'RR',
  PRIORITY: 'PRIORITY',
};

// Scheduler state
let currentTick = 0;
let algorithm = ALGORITHMS.FCFS;
let timeQuantum = 2;
let readyQueue = []; // Array of PIDs in Ready state
let runningPid = null;
let lastExecutedPid = null;
let contextSwitches = 0;
let busyTicks = 0;
let ganttHistory = []; // Array of tick records

export function getSchedulerState() {
  return {
    currentTick,
    algorithm,
    timeQuantum,
    readyQueue: [...readyQueue],
    runningPid,
    lastExecutedPid,
    contextSwitches,
    busyTicks,
    ganttHistory,
  };
}

export function setAlgorithm(nextAlgorithm) {
  if (Object.values(ALGORITHMS).includes(nextAlgorithm)) {
    algorithm = nextAlgorithm;
  }
}

export function setTimeQuantum(nextQuantum) {
  const parsed = Number(nextQuantum);
  if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 20) {
    timeQuantum = Math.floor(parsed);
  }
}

/**
 * Syncs newly added processes (e.g., added mid-simulation via modal or +Child)
 * into the Ready Queue if they are already in READY state.
 */
export function enqueueReadyProcess(pid) {
  const pcb = getProcessByPid(pid);
  if (!pcb || pcb.state !== PROCESS_STATES.READY) return;
  if (!readyQueue.includes(pcb.pid)) {
    readyQueue.push(pcb.pid);
  }
}

/**
 * Removes a manually terminated process from active scheduler tracking.
 */
export function removePidFromScheduler(pid) {
  const numPid = Number(pid);
  readyQueue = readyQueue.filter((id) => id !== numPid);
  if (runningPid === numPid) {
    runningPid = null;
  }
}

/**
 * Resets scheduler counters and re-populates Ready Queue from current Ready PCBs.
 */
export function resetScheduler() {
  currentTick = 0;
  readyQueue = [];
  runningPid = null;
  lastExecutedPid = null;
  contextSwitches = 0;
  busyTicks = 0;
  ganttHistory = [];

  for (const pcb of getAllProcesses()) {
    if (pcb.state === PROCESS_STATES.READY) {
      readyQueue.push(pcb.pid);
    }
  }
}

/**
 * Picks the next Ready PID based on the selected scheduling algorithm
 * and returns both the chosen PCB and a plain-language "Why?" explanation.
 */
function selectNextProcess() {
  // Filter out any stale PIDs just in case
  readyQueue = readyQueue.filter((pid) => {
    const p = getProcessByPid(pid);
    return p && p.state === PROCESS_STATES.READY;
  });

  if (readyQueue.length === 0) return null;

  const candidates = readyQueue.map((pid) => getProcessByPid(pid)).filter(Boolean);
  let chosen = candidates[0];
  let reason = '';

  if (algorithm === ALGORITHMS.FCFS) {
    // Ready queue preserves arrival / re-entry FIFO order
    chosen = candidates[0];
    reason = `FCFS selected PID ${chosen.pid} (${chosen.name}) because it arrived first in the Ready Queue (Arrival: T${chosen.arrivalTime}).`;
  } else if (algorithm === ALGORITHMS.SJF) {
    chosen = [...candidates].sort((a, b) => {
      if (a.remainingTime !== b.remainingTime) return a.remainingTime - b.remainingTime;
      if (a.arrivalTime !== b.arrivalTime) return a.arrivalTime - b.arrivalTime;
      return a.pid - b.pid;
    })[0];
    reason = `SJF (Non-Preemptive) selected PID ${chosen.pid} (${chosen.name}) because it has the shortest remaining CPU burst (${chosen.remainingTime} ticks) among ${candidates.length} ready job(s).`;
  } else if (algorithm === ALGORITHMS.RR) {
    chosen = candidates[0];
    reason = `Round Robin selected PID ${chosen.pid} (${chosen.name}) from the front of the FIFO Ready Queue with time quantum Q=${timeQuantum}.`;
  } else if (algorithm === ALGORITHMS.PRIORITY) {
    chosen = [...candidates].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.arrivalTime !== b.arrivalTime) return a.arrivalTime - b.arrivalTime;
      return a.pid - b.pid;
    })[0];
    reason = `Priority Scheduling selected PID ${chosen.pid} (${chosen.name}) because it has the highest priority (P${chosen.priority}) among ${candidates.length} ready job(s).`;
  }

  // Remove chosen PID from Ready Queue
  readyQueue = readyQueue.filter((id) => id !== chosen.pid);

  return { chosen, reason };
}

/**
 * Checks if all processes in the system have terminated.
 */
export function isSimulationComplete() {
  const processes = getAllProcesses();
  if (processes.length === 0) return true;
  return processes.every((p) => p.state === PROCESS_STATES.TERMINATED);
}

/**
 * Advances the simulation by exactly ONE tick.
 * Returns a tick summary object for UI and logging.
 */
export function stepSchedulerTick() {
  const events = [];
  const allProcesses = getAllProcesses();

  // 1. Admit any NEW jobs whose arrivalTime <= currentTick
  for (const pcb of allProcesses) {
    if (pcb.state === PROCESS_STATES.NEW && pcb.arrivalTime <= currentTick) {
      transitionProcessState(
        pcb,
        PROCESS_STATES.READY,
        currentTick,
        `Admitted at Tick ${currentTick}.`
      );
      enqueueReadyProcess(pcb.pid);
      events.push(`PID ${pcb.pid} (${pcb.name}) arrived -> Ready Queue.`);
    }
  }

  // Track jobs already waiting before this tick begins so newly blocked I/O jobs wait full ticks
  const alreadyWaitingPids = new Set(
    allProcesses
      .filter((p) => p.state === PROCESS_STATES.WAITING)
      .map((p) => p.pid)
  );

  // 2. Handle Round Robin quantum expiration on currently running process
  let currentRunning = runningPid ? getProcessByPid(runningPid) : null;
  if (currentRunning && currentRunning.state !== PROCESS_STATES.RUNNING) {
    currentRunning = null;
    runningPid = null;
  }

  let preemptedReason = '';
  if (
    currentRunning &&
    algorithm === ALGORITHMS.RR &&
    currentRunning.quantumUsed >= timeQuantum
  ) {
    if (readyQueue.length > 0) {
      transitionProcessState(
        currentRunning,
        PROCESS_STATES.READY,
        currentTick,
        `Round Robin quantum (Q=${timeQuantum}) expired; moved to Ready Queue.`
      );
      currentRunning.quantumUsed = 0;
      enqueueReadyProcess(currentRunning.pid);
      preemptedReason = `Time quantum Q=${timeQuantum} expired for PID ${currentRunning.pid}; `;
      events.push(
        `Quantum expired for PID ${currentRunning.pid} -> preempted to Ready Queue.`
      );
      currentRunning = null;
      runningPid = null;
    } else {
      // No other ready job waiting; grant a fresh quantum cleanly
      currentRunning.quantumUsed = 0;
    }
  }

  // 3. Select next process if CPU / Service Bay is free
  let didContextSwitch = false;
  let tickWhyReason = '';

  let attempts = readyQueue.length;
  while (!currentRunning && attempts > 0) {
    attempts -= 1;
    const selection = selectNextProcess();
    if (!selection) break;

    const { chosen, reason } = selection;
    const requiredResource = getRequiredResourceForService(chosen.serviceType);

    if (requiredResource) {
      const lockResult = acquireResource(requiredResource, chosen.pid, currentTick);
      events.push(lockResult.reason);
      if (!lockResult.acquired) {
        // Blocked on busy equipment mutex; try next Ready process
        continue;
      }
    }

    if (lastExecutedPid !== null && lastExecutedPid !== chosen.pid) {
      contextSwitches += 1;
      didContextSwitch = true;
      events.push(
        `Context Switch #${contextSwitches}: PID ${lastExecutedPid} -> PID ${chosen.pid}.`
      );
    }

    chosen.quantumUsed = 0;
    if (chosen.startTime === null) {
      chosen.startTime = currentTick;
    }

    transitionProcessState(
      chosen,
      PROCESS_STATES.RUNNING,
      currentTick,
      `Dispatched to Active Service Bay (${algorithm}).`
    );
    runningPid = chosen.pid;
    currentRunning = chosen;
    tickWhyReason = preemptedReason + reason;
    events.push(`Dispatched PID ${chosen.pid} (${chosen.name}) to CPU (${algorithm}).`);
  }

  if (currentRunning && !tickWhyReason) {
    tickWhyReason = `Continuing PID ${currentRunning.pid} (${currentRunning.name}) in ${algorithm} (${currentRunning.remainingTime} CPU ticks remaining).`;
  }

  // 4. Increment waiting time for all jobs waiting in Ready Queue
  for (const pcb of allProcesses) {
    if (pcb.state === PROCESS_STATES.READY) {
      pcb.waitingTime += 1;
    }
  }

  // 5. Execute 1 tick for the running job (or record Idle tick)
  if (currentRunning) {
    busyTicks += 1;
    currentRunning.remainingTime = Math.max(0, currentRunning.remainingTime - 1);
    currentRunning.quantumUsed += 1;
    currentRunning.registers.ACC += 1;
    currentRunning.registers.PC = `0x${(
      currentRunning.pid * 16 +
      (currentRunning.cpuBurst - currentRunning.remainingTime)
    )
      .toString(16)
      .toUpperCase()}`;

    ganttHistory.push({
      tick: currentTick,
      pid: currentRunning.pid,
      name: currentRunning.name,
      serviceType: currentRunning.serviceType,
      algorithm,
      contextSwitch: didContextSwitch,
      reason: tickWhyReason,
    });

    lastExecutedPid = currentRunning.pid;

    // Check completion or mid-burst I/O transition at end of tick
    if (currentRunning.remainingTime <= 0) {
      currentRunning.completionTime = currentTick + 1;
      transitionProcessState(
        currentRunning,
        PROCESS_STATES.TERMINATED,
        currentTick + 1,
        `Completed all CPU bursts at Tick ${currentTick + 1}.`
      );
      const wokenPids = releaseAllResourcesForPid(currentRunning.pid, currentTick + 1);
      for (const wokenPid of wokenPids) {
        enqueueReadyProcess(wokenPid);
        events.push(
          `Released equipment mutex -> PID ${wokenPid} moved to Ready Queue.`
        );
      }
      events.push(`PID ${currentRunning.pid} (${currentRunning.name}) completed -> Terminated.`);
      runningPid = null;
    } else if (
      currentRunning.ioBurst > 0 &&
      currentRunning.ioRemaining > 0 &&
      !currentRunning.ioTriggered &&
      currentRunning.remainingTime <= Math.ceil(currentRunning.cpuBurst / 2)
    ) {
      currentRunning.ioTriggered = true;
      currentRunning.quantumUsed = 0;
      transitionProcessState(
        currentRunning,
        PROCESS_STATES.WAITING,
        currentTick + 1,
        `Requested equipment I/O (${currentRunning.ioRemaining} ticks).`
      );
      events.push(
        `PID ${currentRunning.pid} requested I/O (${currentRunning.ioRemaining}t) -> Waiting Queue.`
      );
      runningPid = null;
    }
  } else {
    ganttHistory.push({
      tick: currentTick,
      pid: null,
      name: 'Idle',
      serviceType: 'Idle',
      algorithm,
      contextSwitch: false,
      reason: `Tick ${currentTick}: Service Bay was idle because no vehicle jobs were in the Ready Queue.`,
    });
  }

  // 6. Advance I/O bursts for jobs that were already WAITING on I/O (not mutex locks)
  for (const pcb of allProcesses) {
    if (
      pcb.state === PROCESS_STATES.WAITING &&
      alreadyWaitingPids.has(pcb.pid) &&
      !pcb.waitingForResource
    ) {
      if (pcb.ioRemaining > 0) {
        pcb.ioRemaining -= 1;
      }
      if (pcb.ioRemaining <= 0) {
        transitionProcessState(
          pcb,
          PROCESS_STATES.READY,
          currentTick + 1,
          `Completed I/O equipment wait at Tick ${currentTick + 1}.`
        );
        enqueueReadyProcess(pcb.pid);
        events.push(`PID ${pcb.pid} finished I/O wait -> returned to Ready Queue.`);
      }
    }
  }

  // 7. Synchronize Mechanic Threads (TCBs) and advance clock
  syncThreadsWithProcesses();
  currentTick += 1;

  return {
    tick: currentTick,
    events,
    completed: isSimulationComplete(),
  };
}

/**
 * Computes real-time scheduling performance metrics from actual simulation data.
 */
export function calculateMetrics() {
  const processes = getAllProcesses();
  const terminated = processes.filter(
    (p) => p.state === PROCESS_STATES.TERMINATED && p.completionTime !== null
  );

  let avgWaiting = 0;
  let avgTurnaround = 0;
  let avgResponse = 0;

  if (terminated.length > 0) {
    let totalTurnaround = 0;
    let totalWaiting = 0;
    let totalResponse = 0;

    for (const p of terminated) {
      const turnaround = Math.max(0, p.completionTime - p.arrivalTime);
      const response =
        p.startTime !== null ? Math.max(0, p.startTime - p.arrivalTime) : 0;
      totalTurnaround += turnaround;
      totalWaiting += p.waitingTime;
      totalResponse += response;
    }

    avgTurnaround = totalTurnaround / terminated.length;
    avgWaiting = totalWaiting / terminated.length;
    avgResponse = totalResponse / terminated.length;
  }

  const cpuUtilization = currentTick > 0 ? (busyTicks / currentTick) * 100 : 0;
  const throughput = currentTick > 0 ? terminated.length / currentTick : 0;

  return {
    avgWaiting,
    avgTurnaround,
    avgResponse,
    cpuUtilization,
    contextSwitches,
    completedCount: terminated.length,
    totalCount: processes.length,
    busyTicks,
    currentTick,
    throughput,
  };
}

/**
 * Exports scheduler state for Time Machine snapshots.
 */
export function exportSchedulerState() {
  return {
    currentTick,
    algorithm,
    timeQuantum,
    readyQueue: [...readyQueue],
    runningPid,
    lastExecutedPid,
    contextSwitches,
    busyTicks,
    ganttHistory: JSON.parse(JSON.stringify(ganttHistory)),
  };
}

/**
 * Restores scheduler state from a Time Machine snapshot.
 */
export function importSchedulerState(snapshot) {
  currentTick = snapshot.currentTick;
  algorithm = snapshot.algorithm;
  timeQuantum = snapshot.timeQuantum;
  readyQueue = [...snapshot.readyQueue];
  runningPid = snapshot.runningPid;
  lastExecutedPid = snapshot.lastExecutedPid;
  contextSwitches = snapshot.contextSwitches;
  busyTicks = snapshot.busyTicks;
  ganttHistory = JSON.parse(JSON.stringify(snapshot.ganttHistory));
}
