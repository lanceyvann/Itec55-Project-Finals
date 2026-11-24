// =========================================================
// PitStop OS - Process & PCB Management (Phase 2)
// Manages Vehicle Service Jobs, PCBs, Parent-Child links,
// and the 5-State Process Lifecycle.
// =========================================================

export const PROCESS_STATES = {
  NEW: 'New',
  READY: 'Ready',
  RUNNING: 'Running',
  WAITING: 'Waiting',
  TERMINATED: 'Terminated',
};

export const SERVICE_TYPES = [
  'Tire Replacement',
  'Wheel Balancing',
  'Tire Inspection',
];

// Internal module state
let processList = [];
let nextPid = 101;
let selectedPid = null;

/**
 * Creates a Process Control Block (PCB) for a vehicle service job.
 */
export function createPCB({
  name,
  serviceType = 'Tire Replacement',
  priority = 2,
  arrivalTime = 0,
  cpuBurst = 5,
  ioBurst = 2,
  ppid = null,
  currentTick = 0,
}) {
  const pid = nextPid++;
  const safeCpuBurst = Math.max(1, Number(cpuBurst) || 1);
  const safeIoBurst = Math.max(0, Number(ioBurst) || 0);
  const safeArrival = Math.max(0, Number(arrivalTime) || 0);
  const safePriority = Math.min(10, Math.max(1, Number(priority) || 2));

  const pcb = {
    pid,
    ppid: ppid ? Number(ppid) : null,
    name: String(name || `Vehicle Job #${pid}`).trim(),
    serviceType: SERVICE_TYPES.includes(serviceType) ? serviceType : 'Tire Replacement',
    state: PROCESS_STATES.NEW,
    priority: safePriority,
    arrivalTime: safeArrival,
    cpuBurst: safeCpuBurst,
    ioBurst: safeIoBurst,
    burstTime: safeCpuBurst + safeIoBurst,
    remainingTime: safeCpuBurst,
    ioRemaining: safeIoBurst,
    ioTriggered: false,
    quantumUsed: 0,
    startTime: null,
    completionTime: null,
    waitingTime: 0,
    registers: {
      PC: `0x${(pid * 16).toString(16).toUpperCase()}`,
      ACC: 0,
      IR: 'LOAD_JOB',
      SP: `0x${(4096 + pid * 4).toString(16).toUpperCase()}`,
    },
    transitionHistory: [
      {
        tick: currentTick,
        from: '-',
        to: PROCESS_STATES.NEW,
        reason: 'Vehicle job created and PCB initialized.',
      },
    ],
    threads: [],
    heldResources: [],
    waitingForResource: null,
  };

  return pcb;
}

/**
 * Transitions a process cleanly between the 5 lifecycle states
 * and updates simulated registers and transition history.
 */
export function transitionProcessState(pcb, newState, tick = 0, reason = '') {
  if (!pcb || pcb.state === newState) return false;
  if (pcb.state === PROCESS_STATES.TERMINATED) return false;

  const previousState = pcb.state;
  pcb.state = newState;

  if (newState === PROCESS_STATES.READY) {
    pcb.registers.IR = 'WAIT_BAY';
  } else if (newState === PROCESS_STATES.RUNNING) {
    pcb.registers.IR = `EXEC_${pcb.serviceType.toUpperCase().replace(/\s+/g, '_')}`;
  } else if (newState === PROCESS_STATES.WAITING) {
    pcb.registers.IR = 'WAIT_EQUIP_IO';
  } else if (newState === PROCESS_STATES.TERMINATED) {
    pcb.registers.IR = 'HALT';
    pcb.registers.ACC = pcb.cpuBurst;
    pcb.heldResources = [];
    pcb.waitingForResource = null;
  }

  pcb.transitionHistory.push({
    tick,
    from: previousState,
    to: newState,
    reason: reason || `Moved from ${previousState} to ${newState}.`,
  });

  return true;
}

/**
 * Adds a new vehicle service job to the process table.
 * If its arrivalTime <= currentTick, it enters the Ready state right away.
 */
export function addProcess(options, currentTick = 0) {
  const pcb = createPCB({ ...options, currentTick });
  processList.push(pcb);

  if (pcb.arrivalTime <= currentTick) {
    transitionProcessState(
      pcb,
      PROCESS_STATES.READY,
      currentTick,
      'Arrival time reached; admitted to Ready Queue.'
    );
  }

  if (selectedPid === null) {
    selectedPid = pcb.pid;
  }

  return pcb;
}

/**
 * Spawns a child vehicle sub-job (Parent-Child process demonstration).
 */
export function spawnChildProcess(parentPid, currentTick = 0) {
  const parent = getProcessByPid(parentPid);
  if (!parent || parent.state === PROCESS_STATES.TERMINATED) return null;

  const childService =
    parent.serviceType === 'Tire Replacement' ? 'Wheel Balancing' : 'Tire Inspection';

  return addProcess(
    {
      name: `${parent.name} (Sub-Job)`,
      serviceType: childService,
      priority: parent.priority,
      arrivalTime: currentTick,
      cpuBurst: 3,
      ioBurst: 1,
      ppid: parent.pid,
    },
    currentTick
  );
}

/**
 * Updates a process priority (1 = highest, 10 = lowest).
 */
export function updateProcessPriority(pid, newPriority) {
  const pcb = getProcessByPid(pid);
  if (!pcb || pcb.state === PROCESS_STATES.TERMINATED) return false;
  pcb.priority = Math.min(10, Math.max(1, Number(newPriority) || 1));
  return true;
}

/**
 * Terminates a process cleanly and marks completion tick.
 */
export function terminateProcess(pid, currentTick = 0, reason = 'Terminated by user.') {
  const pcb = getProcessByPid(pid);
  if (!pcb || pcb.state === PROCESS_STATES.TERMINATED) return false;

  pcb.remainingTime = 0;
  pcb.ioRemaining = 0;
  if (pcb.completionTime === null) {
    pcb.completionTime = currentTick;
  }

  return transitionProcessState(pcb, PROCESS_STATES.TERMINATED, currentTick, reason);
}

/**
 * Updates editable fields of an active process (Update in CRUD).
 */
export function updateProcess(pid, updates = {}, currentTick = 0) {
  const pcb = getProcessByPid(pid);
  if (!pcb || pcb.state === PROCESS_STATES.TERMINATED) {
    return { ok: false, pcb: null, admitted: false, serviceChanged: false };
  }

  const prevService = pcb.serviceType;

  if (typeof updates.name === 'string' && updates.name.trim()) {
    pcb.name = updates.name.trim();
  }

  if (updates.serviceType && SERVICE_TYPES.includes(updates.serviceType)) {
    pcb.serviceType = updates.serviceType;
  }

  if (updates.priority !== undefined) {
    pcb.priority = Math.min(10, Math.max(1, Number(updates.priority) || 1));
  }

  if (updates.ppid !== undefined) {
    const nextPpid = updates.ppid ? Number(updates.ppid) : null;
    pcb.ppid = nextPpid && nextPpid !== pcb.pid ? nextPpid : null;
  }

  if (pcb.state === PROCESS_STATES.NEW && updates.arrivalTime !== undefined) {
    pcb.arrivalTime = Math.max(0, Number(updates.arrivalTime) || 0);
  }

  if (updates.cpuBurst !== undefined) {
    const executed = Math.max(0, pcb.cpuBurst - pcb.remainingTime);
    const requestedCpu = Math.max(1, Number(updates.cpuBurst) || 1);
    if (executed === 0) {
      pcb.cpuBurst = requestedCpu;
      pcb.remainingTime = requestedCpu;
    } else {
      pcb.cpuBurst = Math.max(requestedCpu, executed + 1);
      pcb.remainingTime = pcb.cpuBurst - executed;
    }
  }

  if (updates.ioBurst !== undefined) {
    const requestedIo = Math.max(0, Number(updates.ioBurst) || 0);
    if (!pcb.ioTriggered) {
      pcb.ioBurst = requestedIo;
      pcb.ioRemaining = requestedIo;
    } else {
      pcb.ioBurst = Math.max(pcb.ioBurst, requestedIo);
    }
  }

  pcb.burstTime = pcb.cpuBurst + pcb.ioBurst;

  let admitted = false;
  if (pcb.state === PROCESS_STATES.NEW && pcb.arrivalTime <= currentTick) {
    admitted = transitionProcessState(
      pcb,
      PROCESS_STATES.READY,
      currentTick,
      'Arrival time updated; admitted to Ready Queue.'
    );
  }

  return {
    ok: true,
    pcb,
    admitted,
    serviceChanged: prevService !== pcb.serviceType,
  };
}

/**
 * Removes a process from the process table and clears child references (Delete in CRUD).
 */
export function deleteProcess(pid) {
  const numPid = Number(pid);
  const index = processList.findIndex((p) => p.pid === numPid);
  if (index === -1) return null;

  const [removed] = processList.splice(index, 1);

  for (const pcb of processList) {
    if (pcb.ppid === numPid) {
      pcb.ppid = null;
    }
  }

  if (selectedPid === numPid) {
    selectedPid = processList.length > 0 ? processList[0].pid : null;
  }

  return removed;
}

/**
 * Finds a PCB by PID.
 */
export function getProcessByPid(pid) {
  return processList.find((p) => p.pid === Number(pid)) || null;
}

/**
 * Returns all PCBs in the process table.
 */
export function getAllProcesses() {
  return processList;
}

/**
 * Selected PID helpers for UI inspection.
 */
export function getSelectedPid() {
  return selectedPid;
}

export function setSelectedPid(pid) {
  selectedPid = pid ? Number(pid) : null;
}

/**
 * Returns summary counts for dashboard KPI cards.
 */
export function getProcessSummaryCounts() {
  let running = 0;
  let waiting = 0;
  let completed = 0;

  for (const pcb of processList) {
    if (pcb.state === PROCESS_STATES.RUNNING) running++;
    else if (pcb.state === PROCESS_STATES.WAITING) waiting++;
    else if (pcb.state === PROCESS_STATES.TERMINATED) completed++;
  }

  return {
    total: processList.length,
    running,
    waiting,
    completed,
  };
}

/**
 * Resets the process table and loads default starter jobs.
 */
export function resetProcesses(starterJobs = []) {
  processList = [];
  nextPid = 101;
  selectedPid = null;

  for (const job of starterJobs) {
    addProcess(job, 0);
  }
}

/**
 * Creates a deep clone of process module state for Time Machine snapshots.
 */
export function exportProcessState() {
  return {
    nextPid,
    selectedPid,
    processList: JSON.parse(JSON.stringify(processList)),
  };
}

/**
 * Restores process module state from a Time Machine snapshot.
 */
export function importProcessState(snapshot) {
  nextPid = snapshot.nextPid;
  selectedPid = snapshot.selectedPid;
  processList = JSON.parse(JSON.stringify(snapshot.processList));
}
