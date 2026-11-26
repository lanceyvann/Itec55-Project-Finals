// =========================================================
// Benchmarking & Testing Suite Engine
// Evaluates all 4 scheduling algorithms (FCFS, SJF, RR, PRIORITY)
// across all 3 predefined workloads using the real simulator
// execution engine, while isolating and preserving live state.
// =========================================================

import {
  PROCESS_STATES,
  exportProcessState,
  getAllProcesses,
  importProcessState,
  resetProcesses,
} from './processes.js';
import {
  ALGORITHMS,
  calculateMetrics,
  exportSchedulerState,
  importSchedulerState,
  isSimulationComplete,
  resetScheduler,
  setAlgorithm,
  setTimeQuantum,
  stepSchedulerTick,
} from './scheduler.js';
import {
  exportThreadState,
  importThreadState,
  initializeProcessThreads,
  resetThreadCounter,
} from './threads.js';
import {
  exportResourceState,
  getDeadlockStatus,
  importResourceState,
  resetResources,
} from './resources.js';
import { WORKLOAD_PRESETS } from './simulation.js';

export const BENCHMARK_WORKLOADS = ['balanced', 'cpu-heavy', 'io-heavy'];
export const BENCHMARK_ALGORITHMS = [
  ALGORITHMS.FCFS,
  ALGORITHMS.SJF,
  ALGORITHMS.RR,
  ALGORITHMS.PRIORITY,
];

const MAX_BENCHMARK_TICKS = 500;

/**
 * Runs a single isolated simulation for a given workload preset and algorithm
 * using the actual scheduler, process, thread, and resource modules.
 */
function executeSingleRun(workloadKey, algorithm, quantum) {
  const starterJobs = WORKLOAD_PRESETS[workloadKey];
  if (!starterJobs) {
    throw new Error(`Unknown workload preset: ${workloadKey}`);
  }

  // Clone preset data to guarantee fixed, unmodified initial inputs
  const clonedJobs = starterJobs.map((job) => ({ ...job }));

  resetProcesses(clonedJobs);
  resetThreadCounter(1);
  for (const pcb of getAllProcesses()) {
    initializeProcessThreads(pcb);
  }
  resetResources();
  resetScheduler();
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
 * Runs the complete 12-case benchmark suite (3 workloads x 4 algorithms)
 * plus verification and reproducibility assertions, restoring live state afterwards.
 */
export function runBenchmarkSuite({ quantum = 2 } = {}) {
  const parsedQuantum = Math.min(20, Math.max(1, Math.floor(Number(quantum) || 2)));

  // Snapshot live simulator state before running isolated benchmarks
  const savedProcesses = exportProcessState();
  const savedScheduler = exportSchedulerState();
  const savedThreads = exportThreadState();
  const savedResources = exportResourceState();

  const results = [];
  let reproducibilityPassed = false;

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
  }

  const allRunsVerified = results.length === 12 && results.every((r) => r.verified);
  const zeroDeadlocks = results.every((r) => !r.haltedByDeadlock);
  const isolationVerified =
    exportSchedulerState().currentTick === savedScheduler.currentTick &&
    exportProcessState().processList.length === savedProcesses.processList.length;

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
    results,
    tests,
    allPassed: tests.every((t) => t.passed),
  };
}
