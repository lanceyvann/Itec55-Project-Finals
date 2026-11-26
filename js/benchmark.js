// =========================================================
// Benchmarking & Testing Suite Engine
// Evaluates all 4 scheduling algorithms (FCFS, SJF, RR, PRIORITY)
// across all 3 predefined workloads using the real simulator
// execution engine, while isolating and preserving live state.
// =========================================================

import {
  PROCESS_STATES, exportProcessState, getAllProcesses,
  importProcessState, resetProcesses,
} from './processes.js';
import {
  ALGORITHMS, calculateMetrics, exportSchedulerState,
  importSchedulerState, isSimulationComplete,
  resetScheduler, setAlgorithm, setTimeQuantum,
  stepSchedulerTick,
} from './scheduler.js';
import {
  exportThreadState, importThreadState,
  initializeProcessThreads, resetThreadCounter,
} from './threads.js';
import {
  exportResourceState, getDeadlockStatus,
  importResourceState, resetResources,
} from './resources.js';
import {
  exportKernelState, importKernelState, resetKernel,
} from './kernel.js';
import { WORKLOAD_PRESETS } from './simulation.js';

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

/**
 - Predefined benchmark datasets;
 - Independent from live user edits, custom vehicles; and
 - Rush Hour spawns, or Deadlock demonstration states.
 */
export const OFFICIAL_BENCHMARK_WORKLOADS = deepFreeze({
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

export const BENCHMARK_WORKLOADS = Object.freeze(['balanced', 'cpu-heavy', 'io-heavy']);
export const BENCHMARK_ALGORITHMS = Object.freeze([
  ALGORITHMS.FCFS,
  ALGORITHMS.SJF,
  ALGORITHMS.RR,
  ALGORITHMS.PRIORITY,
]);

const MAX_BENCHMARK_TICKS = 500;

/**
 * Returns fresh deep-cloned copies of the official fixed benchmark presets.
 */
export function getOfficialBenchmarkPresets(workloadKey = null) {
  if (workloadKey) {
    const preset = OFFICIAL_BENCHMARK_WORKLOADS[workloadKey];
    return preset ? preset.map((job) => ({ ...job })) : [];
  }
  const cloned = {};
  for (const key of BENCHMARK_WORKLOADS) {
    cloned[key] = OFFICIAL_BENCHMARK_WORKLOADS[key].map((job) => ({ ...job }));
  }
  return cloned;
}

function verifyOfficialDatasetIntegrity() {
  if (!Object.isFrozen(OFFICIAL_BENCHMARK_WORKLOADS)) return false;
  if (!Object.isFrozen(WORKLOAD_PRESETS)) return false;

  const expectedCounts = {
    balanced: 4,
    'cpu-heavy': 3,
    'io-heavy': 3,
  };

  return BENCHMARK_WORKLOADS.every((key) => {
    const official = OFFICIAL_BENCHMARK_WORKLOADS[key];
    const simPreset = WORKLOAD_PRESETS[key];
    if (!Array.isArray(official) || !Array.isArray(simPreset)) return false;
    if (!Object.isFrozen(official) || official.length !== expectedCounts[key]) return false;
    return JSON.stringify(official) === JSON.stringify(simPreset);
  });
}

/* Runs a single isolated simulation for an official fixed workload preset 
and scheduling algorithm using the actual simulator execution engine.*/
function executeSingleRun(workloadKey, algorithm, quantum) {
  const officialJobs = OFFICIAL_BENCHMARK_WORKLOADS[workloadKey];
  if (!officialJobs) {
    throw new Error(`Unknown official benchmark workload: ${workloadKey}`);
  }

  // Always clone from the immutable official preset definition
  const clonedJobs = officialJobs.map((job) => ({ ...job }));

  resetProcesses(clonedJobs);
  resetThreadCounter(1);
  for (const pcb of getAllProcesses()) {
    initializeProcessThreads(pcb);
  }
  resetResources();
  resetScheduler();
  resetKernel();
  setAlgorithm(algorithm);
  setTimeQuantum(quantum);

  let tickGuard = 0;
  let haltedByDeadlock = false;

  while (!isSimulationComplete() && tickGuard < MAX_BENCHMARK_TICKS) {
    if (getDeadlockStatus().detected) {
      haltedByDeadlock = true;
      break;
    }
    stepSchedulerTick();
    tickGuard += 1;
  }

  const completed = isSimulationComplete();
  const metrics = calculateMetrics();
  const processes = getAllProcesses();
  const allTerminated = processes.every((p) => p.state === PROCESS_STATES.TERMINATED);

  const checksPassed =
    completed &&
    allTerminated &&
    !haltedByDeadlock &&
    processes.length === officialJobs.length &&
    metrics.completedCount === metrics.totalCount &&
    metrics.avgWaiting >= 0 &&
    metrics.avgResponse >= 0 &&
    metrics.avgTurnaround >= metrics.avgResponse &&
    metrics.cpuUtilization >= 0 &&
    metrics.cpuUtilization <= 100;

  return {
    workloadKey,
    algorithm,
    quantum: algorithm === ALGORITHMS.RR ? quantum : null,
    processCount: processes.length,
    completedCount: metrics.completedCount,
    totalTicks: metrics.currentTick,
    busyTicks: metrics.busyTicks,
    avgWaiting: metrics.avgWaiting,
    avgTurnaround: metrics.avgTurnaround,
    avgResponse: metrics.avgResponse,
    contextSwitches: metrics.contextSwitches,
    cpuUtilization: metrics.cpuUtilization,
    throughput: metrics.throughput,
    completed,
    haltedByDeadlock,
    verified: checksPassed,
  };
}

/**
 * Runs the complete 12-case benchmark suite (3 official fixed workloads x 4 algorithms)
 * plus verification and reproducibility assertions, restoring live state afterwards.
 */
export function runBenchmarkSuite({ quantum = 2 } = {}) {
  const parsedQuantum = Math.min(20, Math.max(1, Math.floor(Number(quantum) || 2)));

  // Snapshot complete live simulator state before running isolated benchmarks
  const savedProcesses = exportProcessState();
  const savedScheduler = exportSchedulerState();
  const savedThreads = exportThreadState();
  const savedResources = exportResourceState();
  const savedKernel = exportKernelState();

  const results = [];
  let reproducibilityPassed = false;
  const datasetIntegrity = verifyOfficialDatasetIntegrity();

  try {
    for (const workloadKey of BENCHMARK_WORKLOADS) {
      for (const algorithm of BENCHMARK_ALGORITHMS) {
        results.push(executeSingleRun(workloadKey, algorithm, parsedQuantum));
      }
    }

    // Reproducibility verification: re-run Round Robin on Balanced and assert identical metrics
    const baseline = results.find(
      (r) => r.workloadKey === 'balanced' && r.algorithm === ALGORITHMS.RR
    );
    const repeatRun = executeSingleRun('balanced', ALGORITHMS.RR, parsedQuantum);
    reproducibilityPassed =
      Boolean(baseline) &&
      baseline.totalTicks === repeatRun.totalTicks &&
      baseline.avgWaiting === repeatRun.avgWaiting &&
      baseline.avgTurnaround === repeatRun.avgTurnaround &&
      baseline.avgResponse === repeatRun.avgResponse &&
      baseline.contextSwitches === repeatRun.contextSwitches;
  } finally {
    // Always restore live simulator state cleanly
    importProcessState(savedProcesses);
    importSchedulerState(savedScheduler);
    importThreadState(savedThreads);
    importResourceState(savedResources);
    importKernelState(savedKernel);
  }

  const restoredProcesses = exportProcessState();
  const restoredScheduler = exportSchedulerState();
  const restoredThreads = exportThreadState();
  const restoredResources = exportResourceState();
  const restoredKernel = exportKernelState();

  const allRunsVerified =
    datasetIntegrity && results.length === 12 && results.every((r) => r.verified);
  const zeroDeadlocks = results.every((r) => !r.haltedByDeadlock);
  const isolationVerified =
    JSON.stringify(restoredProcesses) === JSON.stringify(savedProcesses) &&
    JSON.stringify(restoredScheduler) === JSON.stringify(savedScheduler) &&
    JSON.stringify(restoredThreads) === JSON.stringify(savedThreads) &&
    JSON.stringify(restoredResources) === JSON.stringify(savedResources) &&
    JSON.stringify(restoredKernel) === JSON.stringify(savedKernel);

  const tests = [
    {
      id: 'completion',
      passed: allRunsVerified,
      passedCount: results.filter((r) => r.verified).length,
      totalCount: results.length,
    },
    {
      id: 'deadlockFree',
      passed: zeroDeadlocks,
    },
    {
      id: 'reproducibility',
      passed: reproducibilityPassed,
    },
    {
      id: 'isolation',
      passed: isolationVerified,
    },
  ];

  return {
    quantum: parsedQuantum,
    ranAt: new Date().toISOString(),
    datasetIntegrity,
    officialJobCounts: {
      balanced: OFFICIAL_BENCHMARK_WORKLOADS.balanced.length,
      'cpu-heavy': OFFICIAL_BENCHMARK_WORKLOADS['cpu-heavy'].length,
      'io-heavy': OFFICIAL_BENCHMARK_WORKLOADS['io-heavy'].length,
    },
    results,
    tests,
    allPassed: tests.every((t) => t.passed),
  };
}
