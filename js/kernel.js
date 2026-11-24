// =========================================================
// PitStop OS - Kernel & System Call Interface (Phase 6)
// Manages User Mode / Kernel Mode transitions, privileged
// system calls (integrated with TCBs and Resources), and log.
// =========================================================

import {
  PROCESS_STATES,
  addProcess,
  deleteProcess,
  getProcessByPid,
  terminateProcess,
  transitionProcessState,
  updateProcess,
} from './processes.js';
import {
  enqueueReadyProcess,
  getSchedulerState,
  removePidFromScheduler,
} from './scheduler.js';
import {
  addThreadToProcess,
  initializeProcessThreads,
  joinThreadInProcess,
  resetThreadCounter,
} from './threads.js';
import { releaseAllResourcesForPid } from './resources.js';

export const CPU_MODES = {
  USER: 'User Mode',
  KERNEL: 'Kernel Mode',
};

let currentMode = CPU_MODES.USER;
let kernelLogs = [];

export function getKernelMode() {
  return currentMode;
}

export function setKernelMode(mode) {
  if (mode === CPU_MODES.USER || mode === CPU_MODES.KERNEL) {
    currentMode = mode;
  }
}

/**
 * Appends a timestamped entry to the Kernel Event Log.
 */
export function logKernelEvent(tick, message, source = 'KERNEL') {
  kernelLogs.push({
    tick,
    source,
    message,
  });

  if (kernelLogs.length > 200) {
    kernelLogs.shift();
  }
}

export function getKernelLogs() {
  return kernelLogs;
}

export function clearKernelLogs() {
  kernelLogs = [];
}

/**
 * Executes a privileged kernel operation by trapping from User Mode
 * into Kernel Mode, running the callback, and returning to User Mode.
 */
function executeInKernelMode(tick, syscallName, fn) {
  setKernelMode(CPU_MODES.KERNEL);
  try {
    return fn();
  } finally {
    setKernelMode(CPU_MODES.USER);
    logKernelEvent(tick, `Trap return to User Mode after ${syscallName}.`, 'SYSCALL');
  }
}

/**
 * SYSCALL 1: createProcess()
 */
export function sysCreateProcess(options, currentTick = getSchedulerState().currentTick) {
  return executeInKernelMode(currentTick, 'createProcess()', () => {
    const pcb = addProcess(options, currentTick);
    initializeProcessThreads(pcb);
    enqueueReadyProcess(pcb.pid);
    logKernelEvent(
      currentTick,
      `createProcess() -> Created PID ${pcb.pid} (${pcb.name}, ${pcb.serviceType}, ${pcb.threads.length} threads).`,
      'KERNEL'
    );
    return pcb;
  });
}

/**
 * SYSCALL 2: terminateProcess()
 */
export function sysTerminateProcess(
  pid,
  currentTick = getSchedulerState().currentTick,
  reason = 'Terminated via terminateProcess() syscall.'
) {
  return executeInKernelMode(currentTick, 'terminateProcess()', () => {
    const ok = terminateProcess(pid, currentTick, reason);
    if (ok) {
      removePidFromScheduler(pid);
      const wokenPids = releaseAllResourcesForPid(pid, currentTick);
      for (const wokenPid of wokenPids) {
        enqueueReadyProcess(wokenPid);
        logKernelEvent(
          currentTick,
          `Mutex released -> PID ${wokenPid} moved to Ready Queue.`,
          'RESOURCE'
        );
      }
      logKernelEvent(currentTick, `terminateProcess(PID ${pid}) -> Process halted.`, 'KERNEL');
    } else {
      logKernelEvent(
        currentTick,
        `terminateProcess(PID ${pid}) -> Ignored (process already terminated or missing).`,
        'KERNEL'
      );
    }
    return ok;
  });
}

/**
 * SYSCALL: updateProcess()
 */
export function sysUpdateProcess(
  pid,
  updates,
  currentTick = getSchedulerState().currentTick
) {
  return executeInKernelMode(currentTick, 'updateProcess()', () => {
    const result = updateProcess(pid, updates, currentTick);
    if (!result.ok || !result.pcb) {
      logKernelEvent(
        currentTick,
        `updateProcess(PID ${pid}) -> Ignored (process is terminated or missing).`,
        'KERNEL'
      );
      return null;
    }

    if (result.serviceChanged && result.pcb.startTime === null) {
      initializeProcessThreads(result.pcb);
    }

    if (result.admitted) {
      enqueueReadyProcess(result.pcb.pid);
    }

    logKernelEvent(
      currentTick,
      `updateProcess(PID ${result.pcb.pid}) -> Updated "${result.pcb.name}" (${result.pcb.serviceType}, P${result.pcb.priority}, CPU:${result.pcb.cpuBurst}t, I/O:${result.pcb.ioBurst}t).`,
      'KERNEL'
    );
    return result.pcb;
  });
}

/**
 * SYSCALL: deleteProcess()
 */
export function sysDeleteProcess(pid, currentTick = getSchedulerState().currentTick) {
  return executeInKernelMode(currentTick, 'deleteProcess()', () => {
    removePidFromScheduler(pid);
    const wokenPids = releaseAllResourcesForPid(pid, currentTick);
    for (const wokenPid of wokenPids) {
      enqueueReadyProcess(wokenPid);
      logKernelEvent(
        currentTick,
        `Mutex released -> PID ${wokenPid} moved to Ready Queue.`,
        'RESOURCE'
      );
    }

    const removed = deleteProcess(pid);
    if (removed) {
      logKernelEvent(
        currentTick,
        `deleteProcess(PID ${pid}) -> Removed "${removed.name}" from PCB table.`,
        'KERNEL'
      );
    } else {
      logKernelEvent(
        currentTick,
        `deleteProcess(PID ${pid}) -> Ignored (process not found).`,
        'KERNEL'
      );
    }
    return removed;
  });
}

/**
 * SYSCALL 3: createThread()
 */
export function sysCreateThread(
  pid,
  taskName = 'Extra Mechanic Inspection',
  currentTick = getSchedulerState().currentTick
) {
  return executeInKernelMode(currentTick, 'createThread()', () => {
    const tcb = addThreadToProcess(pid, taskName);
    if (!tcb) {
      logKernelEvent(
        currentTick,
        `createThread() failed: No active process selected.`,
        'KERNEL'
      );
      return null;
    }

    logKernelEvent(
      currentTick,
      `createThread(PID ${tcb.parentPid}) -> Spawned TID ${tcb.tid} (${tcb.name}).`,
      'KERNEL'
    );
    return tcb;
  });
}

/**
 * SYSCALL 4: joinThread()
 */
export function sysJoinThread(
  pid,
  tid = null,
  currentTick = getSchedulerState().currentTick
) {
  return executeInKernelMode(currentTick, 'joinThread()', () => {
    const joined = joinThreadInProcess(pid, tid);
    if (!joined) {
      logKernelEvent(
        currentTick,
        `joinThread() -> No active mechanic threads remaining on PID ${pid ?? '-'}.`,
        'KERNEL'
      );
      return false;
    }

    logKernelEvent(
      currentTick,
      `joinThread(PID ${joined.parentPid}, TID ${joined.tid}) -> Joined "${joined.name}".`,
      'KERNEL'
    );
    return true;
  });
}

/**
 * SYSCALL 5: requestIO()
 */
export function sysRequestIO(
  pid,
  ioTicks = 2,
  currentTick = getSchedulerState().currentTick
) {
  return executeInKernelMode(currentTick, 'requestIO()', () => {
    const pcb = getProcessByPid(pid);
    if (
      !pcb ||
      pcb.state === PROCESS_STATES.TERMINATED ||
      pcb.state === PROCESS_STATES.WAITING
    ) {
      logKernelEvent(
        currentTick,
        `requestIO() failed: Target job is not Ready/Running.`,
        'KERNEL'
      );
      return false;
    }

    const safeIo = Math.max(1, Number(ioTicks) || 2);
    pcb.ioRemaining = Math.max(pcb.ioRemaining, safeIo);
    pcb.ioTriggered = true;
    pcb.quantumUsed = 0;

    removePidFromScheduler(pcb.pid);
    transitionProcessState(
      pcb,
      PROCESS_STATES.WAITING,
      currentTick,
      `Syscall requestIO() blocked job for ${pcb.ioRemaining} ticks.`
    );

    logKernelEvent(
      currentTick,
      `requestIO(PID ${pcb.pid}) -> Moved to Waiting Queue (${pcb.ioRemaining}t I/O).`,
      'KERNEL'
    );
    return true;
  });
}

/**
 * SYSCALL 6: yieldProcess()
 */
export function sysYieldProcess(pid, currentTick = getSchedulerState().currentTick) {
  return executeInKernelMode(currentTick, 'yieldProcess()', () => {
    const pcb = getProcessByPid(pid);
    if (!pcb || pcb.state !== PROCESS_STATES.RUNNING) {
      logKernelEvent(
        currentTick,
        `yieldProcess() ignored: Only a Running job in the Active Service Bay can yield.`,
        'KERNEL'
      );
      return false;
    }

    removePidFromScheduler(pcb.pid);
    pcb.quantumUsed = 0;
    transitionProcessState(
      pcb,
      PROCESS_STATES.READY,
      currentTick,
      'Voluntarily yielded CPU via yieldProcess() syscall.'
    );
    enqueueReadyProcess(pcb.pid);

    logKernelEvent(
      currentTick,
      `yieldProcess(PID ${pcb.pid}) -> Released Active Service Bay back to Ready Queue.`,
      'KERNEL'
    );
    return true;
  });
}

/**
 * Resets kernel state on simulation boot / reset.
 */
export function resetKernel() {
  currentMode = CPU_MODES.USER;
  kernelLogs = [];
  resetThreadCounter(1);
  logKernelEvent(
    0,
    'Kernel booted: Shop Operations Manager initialized in User Mode.',
    'BOOT'
  );
}

export function exportKernelState() {
  return {
    currentMode,
    kernelLogs: JSON.parse(JSON.stringify(kernelLogs)),
  };
}

export function importKernelState(snapshot) {
  currentMode = snapshot.currentMode;
  kernelLogs = JSON.parse(JSON.stringify(snapshot.kernelLogs));
}
