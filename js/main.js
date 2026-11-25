// =========================================================
// PitStop OS - Main UI Controller (Phase 3)
// Wires simulation playback (Start, Pause, Step, Reset),
// algorithm/quantum/speed selectors, presets, and PCB UI.
// =========================================================

import {
  PROCESS_STATES,
  getAllProcesses,
  getProcessByPid,
  getProcessSummaryCounts,
  getSelectedPid,
  setSelectedPid,
  spawnChildProcess,
  updateProcessPriority,
} from './processes.js';
import {
  ALGORITHMS,
  calculateMetrics,
  enqueueReadyProcess,
  getSchedulerState,
  isSimulationComplete,
  setAlgorithm,
  setTimeQuantum,
} from './scheduler.js';
import {
  CPU_MODES,
  clearKernelLogs,
  getKernelLogs,
  getKernelMode,
  logKernelEvent,
  sysCreateProcess,
  sysCreateThread,
  sysDeleteProcess,
  sysJoinThread,
  sysRequestIO,
  sysTerminateProcess,
  sysUpdateProcess,
  sysYieldProcess,
} from './kernel.js';
import {
  getSharedProcessResources,
  initializeProcessThreads,
} from './threads.js';
import { getDeadlockStatus, getResourceById, getResources } from './resources.js';
import {
  getTimeMachineInfo,
  jumpToTickSnapshot,
  previewSnapshot,
  resetSimulation,
  resetSimulationPreservingProcesses,
  resolveDeadlockDemo,
  resumeFromSnapshot,
  runDeadlockDemo,
  stepSimulationTick,
  stepSnapshotBackward,
  stepSnapshotForward,
  syncLiveSnapshot,
  triggerRushHour,
} from './simulation.js';

// Dual View Terminology Dictionary (Story View <-> OS View)
const VIEW_LABELS = {
  story: {
    brandSubtitle: 'Automotive Tire Service Workshop Simulator',
    navScheduler: 'Service Bay & Timeline',
    navProcesses: 'Vehicle Records',
    navResources: 'Mechanics & Equipment',
    navKernel: 'Operations Log',
    labelQuantum: 'Bay Turn',
    presetBalanced: 'Balanced Shop Mix',
    presetCpuHeavy: 'Bay-Heavy (Long Services)',
    presetIoHeavy: 'Equipment-Heavy (Frequent Locks)',
    rushHourBtn: 'Rush Hour',
    kpiTotal: 'Total Vehicle Jobs',
    kpiRunning: 'Undergoing Tire Service',
    kpiWaiting: 'Waiting for Equipment',
    kpiCompleted: 'Service Completed',
    kpiUtilization: 'Active Bay Utilization',
    baySectionTitle: 'Active Service Bay & Waiting Lines',
    contextSwitchLabel: 'Service Bay Changeovers',
    cpuLabel: 'Active Service Bay (In Service)',
    readyQueueLabel: 'Vehicles Waiting for Bay',
    waitingQueueLabel: 'Vehicles Waiting for Equipment',
    ganttTitle: 'Service Bay Timeline & Shop Metrics',
    ganttHint: 'Click any bay block to inspect "Why?"',
    metricWaitLabel: 'Avg Bay Line Wait',
    metricTurnaroundLabel: 'Avg Shop Turnaround',
    metricResponseLabel: 'Avg Bay Response',
    metricUtilLabel: 'Bay Utilization',
    whyTitle: '"Why?" Service Bay Assignment Explainer',
    whyJumpBtn: 'View in Shift Replay',
    pcbTableTitle: 'Vehicle Service Records',
    pcbHint: 'Click a vehicle record to inspect mechanic tasks',
    colPid: 'Job ID',
    colPpid: 'Parent Job',
    colJobName: 'Vehicle Job',
    colServiceType: 'Service Type',
    colPcbState: 'Shop Status',
    colPriority: 'Priority',
    colArrival: 'Check-In',
    colBurst: 'Bay / Equip',
    colRemaining: 'Remaining',
    threadTitle: 'Mechanic Service Tasks',
    sharedResourcesLabel: 'Shared Work-Order Workspace',
    colTid: 'Task ID',
    colTaskName: 'Mechanic Task',
    colTcbState: 'Task Status',
    colPrivateRegs: 'Mechanic Clipboard',
    equipmentTitle: 'Shop Equipment & Tool Locks',
    deadlockTitle: 'Shop Gridlock Demonstration',
    deadlockDemoBtn: 'Simulate Gridlock',
    kernelTitle: 'Shop Operations Manager Log',
    syscallCreateThread: '+ Mechanic Task',
    syscallJoinThread: 'Finish Task',
    syscallRequestIO: 'Request Equipment',
    syscallYieldProcess: 'Yield Service Bay',
    initialLogPlaceholder: 'Shop floor ready. Waiting for shift start.',
    tmTitle: 'Shift Replay (Time Machine)',
    tmDesc:
      'Scrub backward or forward through recorded shift ticks to inspect any past bay state, then click Resume Here to branch from that tick.',
    pcbModalTitle: 'Vehicle Service Record',
    addJobBtn: '+ Add Vehicle Job',
    fieldJobName: 'Vehicle / Job Name',
    fieldServiceType: 'Tire Service Type',
    fieldPriority: 'Service Priority (1 = Highest)',
    fieldArrival: 'Check-In Tick',
    fieldCpuBurst: 'Bay Service (Ticks)',
    fieldIoBurst: 'Equip Wait (Ticks)',
    fieldParentPid: 'Parent Job (Optional)',
  },
  os: {
    brandSubtitle: 'Scenario-Driven Mini-OS Simulator',
    navScheduler: 'CPU & Gantt',
    navProcesses: 'PCB Table',
    navResources: 'Threads & Mutexes',
    navKernel: 'Kernel Log',
    labelQuantum: 'Quantum',
    presetBalanced: 'Balanced Workload',
    presetCpuHeavy: 'CPU-Heavy (Long Bursts)',
    presetIoHeavy: 'I/O-Heavy (Frequent Locks)',
    rushHourBtn: 'Burst Workload',
    kpiTotal: 'Total Processes',
    kpiRunning: 'Running Processes',
    kpiWaiting: 'Waiting Processes',
    kpiCompleted: 'Terminated Processes',
    kpiUtilization: 'CPU Utilization',
    baySectionTitle: 'CPU & Process Queues',
    contextSwitchLabel: 'Context Switches',
    cpuLabel: 'CPU (Running Process)',
    readyQueueLabel: 'Ready Queue',
    waitingQueueLabel: 'Waiting Queue (I/O / Mutex)',
    ganttTitle: 'Live Gantt Chart & Performance Metrics',
    ganttHint: 'Click any Gantt block to inspect "Why?"',
    metricWaitLabel: 'Avg Waiting Time',
    metricTurnaroundLabel: 'Avg Turnaround Time',
    metricResponseLabel: 'Avg Response Time',
    metricUtilLabel: 'CPU Utilization',
    whyTitle: '"Why?" Scheduling Decision Explainer',
    whyJumpBtn: 'View in Time Machine',
    pcbTableTitle: 'Process Control Blocks (PCB)',
    pcbHint: 'Click a PCB row to inspect its TCB threads',
    colPid: 'PID',
    colPpid: 'PPID',
    colJobName: 'Process Name',
    colServiceType: 'Workload Type',
    colPcbState: 'State',
    colPriority: 'Priority',
    colArrival: 'Arrival',
    colBurst: 'Burst (CPU/I/O)',
    colRemaining: 'Remaining',
    threadTitle: 'Thread Control Blocks (TCB)',
    sharedResourcesLabel: 'Shared Process Resources',
    colTid: 'TID',
    colTaskName: 'Thread Name',
    colTcbState: 'State',
    colPrivateRegs: 'Private Registers',
    equipmentTitle: 'Shared Resources & Mutex Locks',
    deadlockTitle: 'Deadlock Demonstration',
    deadlockDemoBtn: 'Run Deadlock Demo',
    kernelTitle: 'OS Kernel & System Calls Log',
    syscallCreateThread: 'createThread()',
    syscallJoinThread: 'joinThread()',
    syscallRequestIO: 'requestIO()',
    syscallYieldProcess: 'yieldProcess()',
    initialLogPlaceholder: 'OS Kernel ready. Waiting for simulation start.',
    tmTitle: 'Time Machine (Snapshots)',
    tmDesc:
      'Scrub backward or forward through saved simulation ticks to inspect any past state, then click Resume Here to branch a new timeline from that tick.',
    pcbModalTitle: 'Process Control Block (PCB) Details',
    addJobBtn: '+ Add Process',
    fieldJobName: 'Process Name',
    fieldServiceType: 'Workload Type',
    fieldPriority: 'Priority (1 = Highest)',
    fieldArrival: 'Arrival Tick',
    fieldCpuBurst: 'CPU Burst (Ticks)',
    fieldIoBurst: 'I/O Burst (Ticks)',
    fieldParentPid: 'Parent Process (Optional PPID)',
  },
};

const STORY_STATE_LABELS = {
  New: 'Checked In',
  Ready: 'Waiting for Service',
  Running: 'Undergoing Tire Service',
  Waiting: 'Waiting for Equipment',
  Terminated: 'Service Completed',
};

const STORY_LOG_SOURCES = {
  BOOT: 'SHOP',
  KERNEL: 'MANAGER',
  SYSCALL: 'REQUEST',
  SCHED: 'BAY',
  RESOURCE: 'EQUIP',
  DEADLOCK: 'GRIDLOCK',
  RECOVERY: 'RECOVERY',
  RUSHHOUR: 'RUSH HOUR',
  TIMEMACHINE: 'REPLAY',
};

const OS_LOG_SOURCES = {
  RUSHHOUR: 'BURST',
};

const STORY_SYSCALL_NAMES = {
  'createProcess()': 'Check-In Vehicle',
  'terminateProcess()': 'Cancel / Complete Job',
  'updateProcess()': 'Update Service Order',
  'deleteProcess()': 'Remove Vehicle Record',
  'createThread()': 'Add Mechanic Task',
  'joinThread()': 'Finish Mechanic Task',
  'requestIO()': 'Request Equipment',
  'yieldProcess()': 'Yield Service Bay',
};

let currentViewMode = 'story';
let currentPresetKey = 'balanced';
let simulationTimer = null;
let selectedGanttTick = null;
let inspectedModalPid = null;
let editingPid = null;

function formatStateLabel(state) {
  if (currentViewMode === 'story') {
    return STORY_STATE_LABELS[state] || state;
  }
  return state;
}

function formatId(pid) {
  return currentViewMode === 'story' ? `Job #${pid}` : `PID ${pid}`;
}

function formatModeLabel(mode) {
  if (currentViewMode === 'story') {
    return mode === CPU_MODES.KERNEL ? 'Shop Manager' : 'Shop Floor';
  }
  return mode;
}

function formatLogSource(source) {
  if (currentViewMode === 'story') {
    return STORY_LOG_SOURCES[source] || source;
  }
  return OS_LOG_SOURCES[source] || source;
}

function toStoryText(text) {
  if (typeof text !== 'string' || !text) return text;

  let out = text;

  // Ordered full-sentence / structured translations (canonical OS -> PitStop Story)
  const exactReplacements = [
    [
      'Process created and PCB initialized.',
      'Vehicle job checked in and service record created.',
    ],
    [
      'Arrival time reached; admitted to Ready Queue.',
      'Vehicle arrived at check-in; moved to Bay Waiting Line.',
    ],
    [
      'Arrival time updated; admitted to Ready Queue.',
      'Check-in tick updated; moved to Bay Waiting Line.',
    ],
    [
      'Simulation reset; process record preserved.',
      'Shift reset; vehicle service record preserved.',
    ],
    ['Terminated by user.', 'Cancelled by shop operator.'],
    ['Terminated manually from PCB table.', 'Cancelled manually from vehicle records.'],
    ['Terminated via terminateProcess() syscall.', 'Cancelled by Shop Manager request.'],
    [
      'Terminated by OS Deadlock Recovery to break circular wait.',
      'Job cancelled by Shop Manager to break equipment gridlock.',
    ],
    [
      'Kernel booted: OS Kernel initialized in User Mode.',
      'Shop opened: Shop Operations Manager ready on Shop Floor.',
    ],
    ['All processes completed.', 'All vehicle service jobs completed.'],
    [
      'Simulation halted: Circular deadlock active. Click Resolve or Reset.',
      'Shift halted: Equipment gridlock active. Click Resolve or Reset.',
    ],
    [
      'createThread() failed: No active process selected.',
      'Add Mechanic Task failed: No active vehicle job selected.',
    ],
    [
      'requestIO() failed: Target process is not Ready/Running.',
      'Request Equipment failed: Selected vehicle is not waiting or in bay.',
    ],
    [
      'yieldProcess() ignored: Only a Running process on CPU can yield.',
      'Yield Bay ignored: Only a vehicle currently in the Active Service Bay can yield.',
    ],
    [
      'Voluntarily yielded CPU via yieldProcess() syscall.',
      'Voluntarily left Active Service Bay to let another vehicle enter.',
    ],
  ];

  for (const [osStr, storyStr] of exactReplacements) {
    if (out === osStr) return storyStr;
    if (out.includes(osStr)) {
      out = out.replaceAll(osStr, storyStr);
    }
  }

  // Regex rules for dynamic messages across scheduler, kernel, resources, and simulation
  out = out
    .replace(
      /^Trap return to User Mode after ([^.]+)\.$/,
      (_, callName) =>
        `Shop Manager finished ${STORY_SYSCALL_NAMES[callName] || callName}; returned control to Shop Floor.`
    )
    .replace(
      /^FCFS selected PID (\d+) \((.+)\) because it arrived first in the Ready Queue \(Arrival: T(\d+)\)\.$/,
      'FCFS assigned Job #$1 ($2) because it arrived first in the Bay Waiting Line (Check-In: T$3).'
    )
    .replace(
      /^SJF \(Non-Preemptive\) selected PID (\d+) \((.+)\) because it has the shortest remaining CPU burst \((\d+) ticks\) among (\d+) ready process\(es\)\.$/,
      'SJF (Shortest Service First) assigned Job #$1 ($2) because it has the shortest remaining bay service ($3 ticks) among $4 waiting vehicle(s).'
    )
    .replace(
      /^Round Robin selected PID (\d+) \((.+)\) from the front of the FIFO Ready Queue with time quantum Q=(\d+)\.$/,
      'Round Robin assigned Job #$1 ($2) from the front of the Bay Waiting Line with a $3-tick bay turn limit.'
    )
    .replace(
      /^Priority Scheduling selected PID (\d+) \((.+)\) because it has the highest priority \(P(\d+)\) among (\d+) ready process\(es\)\.$/,
      'Priority Scheduling assigned Job #$1 ($2) because it has the highest service priority (P$3) among $4 waiting vehicle(s).'
    )
    .replace(
      /^Continuing PID (\d+) \((.+)\) on CPU under (\w+) \((\d+) CPU ticks remaining\)\.$/,
      'Continuing service on Job #$1 ($2) in Active Service Bay under $3 ($4 bay ticks remaining).'
    )
    .replace(
      /^Tick (\d+): CPU was idle because no processes were in the Ready Queue\.$/,
      'Tick $1: Active Service Bay was idle because no vehicles were waiting in the Bay Waiting Line.'
    )
    .replace(
      /^Time quantum Q=(\d+) expired for PID (\d+); /,
      'Bay turn limit ($1 ticks) ended for Job #$2; '
    )
    .replace(
      /^Round Robin quantum \(Q=(\d+)\) expired; moved to Ready Queue\.$/,
      'Bay turn limit ($1 ticks) ended; vehicle returned to Bay Waiting Line.'
    )
    .replace(
      /^Quantum expired for PID (\d+) -> preempted to Ready Queue\.$/,
      'Bay turn ended for Job #$1 -> paused and moved back to Bay Waiting Line.'
    )
    .replace(
      /^Admitted at Tick (\d+)\.$/,
      'Checked in to Bay Waiting Line at Tick $1.'
    )
    .replace(
      /^PID (\d+) \((.+)\) arrived -> Ready Queue\.$/,
      'Job #$1 ($2) arrived at shop -> Bay Waiting Line.'
    )
    .replace(
      /^Context Switch #(\d+): PID (\d+) -> PID (\d+)\.$/,
      'Service Bay Changeover #$1: Job #$2 -> Job #$3.'
    )
    .replace(
      /^Dispatched to CPU \(([^)]+)\)\.$/,
      'Moved into Active Service Bay ($1).'
    )
    .replace(
      /^Dispatched PID (\d+) \((.+)\) to CPU \(([^)]+)\)\.$/,
      'Assigned Job #$1 ($2) to Active Service Bay ($3).'
    )
    .replace(
      /^Completed all CPU bursts at Tick (\d+)\.$/,
      'Finished all bay service work at Tick $1.'
    )
    .replace(
      /^Released equipment mutex -> PID (\d+) moved to Ready Queue\.$/,
      'Released equipment lock -> Job #$1 moved to Bay Waiting Line.'
    )
    .replace(
      /^PID (\d+) \((.+)\) completed -> Terminated\.$/,
      'Job #$1 ($2) finished service -> Service Completed.'
    )
    .replace(
      /^Requested equipment I\/O \((\d+) ticks\)\.$/,
      'Sent to equipment station ($1 ticks).'
    )
    .replace(
      /^PID (\d+) requested I\/O \((\d+)t\) -> Waiting Queue\.$/,
      'Job #$1 waiting on equipment ($2t) -> Equipment Wait Line.'
    )
    .replace(
      /^Completed I\/O equipment wait at Tick (\d+)\.$/,
      'Finished equipment service at Tick $1.'
    )
    .replace(
      /^PID (\d+) finished I\/O wait -> returned to Ready Queue\.$/,
      'Job #$1 finished equipment wait -> returned to Bay Waiting Line.'
    )
    .replace(
      /^PID (\d+) already holds (.+)\.$/,
      'Job #$1 is already using $2.'
    )
    .replace(
      /^PID (\d+) locked mutex on (.+)\.$/,
      'Job #$1 reserved $2 (Equipment Lock).'
    )
    .replace(
      /^Waiting for mutex lock on (.+) \(held by PID (\d+)\)\.$/,
      'Waiting for $1 lock (in use by Job #$2).'
    )
    .replace(
      /^Mutex busy: PID (\d+) added to (.+) waiting queue \(owner: PID (\d+)\)\.$/,
      'Equipment busy: Job #$1 added to $2 wait line (used by Job #$3).'
    )
    .replace(
      /^Acquired released mutex on (.+); returned to Ready Queue\.$/,
      'Acquired freed $1 lock; returned to Bay Waiting Line.'
    )
    .replace(
      /^DEADLOCK DETECTED: PID (\d+) holds (.+) and waits for (.+), while PID (\d+) holds (.+) and waits for (.+)\.$/,
      'SHOP GRIDLOCK DETECTED: Job #$1 holds $2 and waits for $3, while Job #$4 holds $5 and waits for $6.'
    )
    .replace(
      /^createProcess\(\) -> Created PID (\d+) \((.+), ([^,]+), (\d+) threads\)\.$/,
      'Check-In -> Registered Job #$1 ($2, $3, $4 mechanic tasks).'
    )
    .replace(
      /^createProcess\(\) -> Parent PID (\d+) spawned Child PID (\d+) \((\d+) threads\)\.$/,
      'Sub-Job Created -> Parent Job #$1 spawned Child Job #$2 ($3 mechanic tasks).'
    )
    .replace(
      /^Mutex released -> PID (\d+) moved to Ready Queue\.$/,
      'Equipment freed -> Job #$1 moved to Bay Waiting Line.'
    )
    .replace(
      /^terminateProcess\(PID (\d+)\) -> Process halted\.$/,
      'Cancel Job (Job #$1) -> Vehicle service halted.'
    )
    .replace(
      /^terminateProcess\(PID (\d+)\) -> Ignored \(process already terminated or missing\)\.$/,
      'Cancel Job (Job #$1) -> Ignored (already completed or missing).'
    )
    .replace(
      /^updateProcess\(PID (\d+)\) -> Ignored \(process is terminated or missing\)\.$/,
      'Update Order (Job #$1) -> Ignored (already completed or missing).'
    )
    .replace(
      /^updateProcess\(PID (\d+)\) -> Updated "(.+)" \(([^,]+), P(\d+), CPU:(\d+)t, I\/O:(\d+)t\)\.$/,
      'Update Order (Job #$1) -> Updated "$2" ($3, P$4, Bay:$5t, Equip:$6t).'
    )
    .replace(
      /^deleteProcess\(PID (\d+)\) -> Removed "(.+)" from PCB table\.$/,
      'Delete Record (Job #$1) -> Removed "$2" from vehicle records.'
    )
    .replace(
      /^deleteProcess\(PID (\d+)\) -> Ignored \(process not found\)\.$/,
      'Delete Record (Job #$1) -> Ignored (vehicle job not found).'
    )
    .replace(
      /^createThread\(PID (\d+)\) -> Spawned TID (\d+) \((.+)\)\.$/,
      'Add Mechanic Task (Job #$1) -> Added Task #$2 ($3).'
    )
    .replace(
      /^joinThread\(\) -> No active threads remaining on PID ([^.]+)\.$/,
      'Finish Task -> No active mechanic tasks remaining on Job #$1.'
    )
    .replace(
      /^joinThread\(PID (\d+), TID (\d+)\) -> Joined "(.+)"\.$/,
      'Finish Task (Job #$1, Task #$2) -> Completed "$3".'
    )
    .replace(
      /^Syscall requestIO\(\) blocked process for (\d+) ticks\.$/,
      'Shop request moved vehicle to equipment station for $1 ticks.'
    )
    .replace(
      /^requestIO\(PID (\d+)\) -> Moved to Waiting Queue \((\d+)t I\/O\)\.$/,
      'Request Equipment (Job #$1) -> Moved to Equipment Wait Line ($2t).'
    )
    .replace(
      /^yieldProcess\(PID (\d+)\) -> Released CPU back to Ready Queue\.$/,
      'Yield Bay (Job #$1) -> Released Service Bay and returned to Bay Waiting Line.'
    )
    .replace(
      /^Simulation started \(([^,]+), (\d+)ms\/tick\)\.$/,
      'Shift simulation started ($1, $2ms/tick).'
    )
    .replace(
      /^Loaded "([^"]+)" preset \((\d+) processes\)\.$/,
      'Loaded "$1" shop preset ($2 vehicle jobs).'
    )
    .replace(
      /^Simulation reset: restored queues, timers, and Gantt chart \((\d+) process records preserved\)\.$/,
      'Shift reset: restored bay queues, timers, and timeline ($1 vehicle records preserved).'
    )
    .replace(
      /^Rush Hour activated: spawned (\d+) predefined processes \((.+)\)\.$/,
      (_, count, list) =>
        `Rush Hour activated: ${count} predefined vehicles arrived (${list.replaceAll('PID ', 'Job #')}).`
    )
    .replace(
      /^Deadlock resolved: Terminated PID (\d+), freeing (.+) for remaining process\.$/,
      'Gridlock cleared: Cancelled Job #$1, freeing $2 for the remaining vehicle.'
    )
    .replace(
      /^Time Machine: Resumed live simulation from Tick (\d+)\.$/,
      'Shift Replay: Resumed live shop shift from Tick $1.'
    )
    .replace(
      /^Moved from (\w+) to (\w+)\.$/,
      (_, fromState, toState) =>
        `Moved from ${STORY_STATE_LABELS[fromState] || fromState} to ${STORY_STATE_LABELS[toState] || toState}.`
    );

  // Clean fallback replacements for any residual OS tokens
  out = out
    .replace(/\bPID\s+(\d+)\b/g, 'Job #$1')
    .replace(/\bTID\s+(\d+)\b/g, 'Task #$1')
    .replace(/\bReady Queue\b/g, 'Bay Waiting Line')
    .replace(/\bWaiting Queue\b/g, 'Equipment Wait Line')
    .replace(/\bContext Switch\b/g, 'Service Bay Changeover')
    .replace(/\bDeadlock\b/g, 'Gridlock')
    .replace(/\bCPU\b/g, 'Active Service Bay')
    .replace(/\bmutex(es)?\b/gi, (_, plural) => (plural ? 'equipment locks' : 'equipment lock'));

  return out;
}

function formatDualText(text) {
  if (currentViewMode === 'story') {
    return toStoryText(text);
  }
  return text;
}

// Cached DOM references
const dom = {
  dualViewToggle: document.getElementById('dual-view-toggle'),
  openGuideBtn: document.getElementById('open-guide-btn'),
  guideModal: document.getElementById('guide-modal'),
  closeGuideModalBtn: document.getElementById('close-guide-modal-btn'),
  ackGuideBtn: document.getElementById('ack-guide-btn'),
  openAddJobBtn: document.getElementById('open-add-job-btn'),
  addJobModal: document.getElementById('add-job-modal'),
  addJobTitle: document.getElementById('add-job-title'),
  submitJobBtn: document.getElementById('submit-job-btn'),
  closeAddJobBtn: document.getElementById('close-add-job-btn'),
  cancelAddJobBtn: document.getElementById('cancel-add-job-btn'),
  addJobForm: document.getElementById('add-job-form'),
  inputJobName: document.getElementById('input-job-name'),
  inputServiceType: document.getElementById('input-service-type'),
  inputPriority: document.getElementById('input-priority'),
  inputArrival: document.getElementById('input-arrival'),
  inputCpuBurst: document.getElementById('input-cpu-burst'),
  inputIoBurst: document.getElementById('input-io-burst'),
  inputParentPid: document.getElementById('input-parent-pid'),
  pcbTableBody: document.getElementById('pcb-table-body'),
  pcbModal: document.getElementById('pcb-modal'),
  pcbModalBody: document.getElementById('pcb-modal-body'),
  closePcbModalBtn: document.getElementById('close-pcb-modal-btn'),
  statTotalJobs: document.getElementById('stat-total-jobs'),
  statRunningJobs: document.getElementById('stat-running-jobs'),
  statWaitingJobs: document.getElementById('stat-waiting-jobs'),
  statCompletedJobs: document.getElementById('stat-completed-jobs'),
  statAlgorithm: document.getElementById('stat-algorithm'),
  statCpuUtil: document.getElementById('stat-cpu-util'),
  statContextSwitches: document.getElementById('stat-context-switches'),
  btnStart: document.getElementById('btn-start'),
  btnPause: document.getElementById('btn-pause'),
  btnStep: document.getElementById('btn-step'),
  btnReset: document.getElementById('btn-reset'),
  algoSelect: document.getElementById('algo-select'),
  quantumInput: document.getElementById('quantum-input'),
  quantumWrapper: document.getElementById('quantum-wrapper'),
  speedSelect: document.getElementById('speed-select'),
  presetSelect: document.getElementById('preset-select'),
  btnLoadPreset: document.getElementById('btn-load-preset'),
  btnRushHour: document.getElementById('btn-rush-hour'),
  tickDisplay: document.getElementById('tick-display'),
  selectedProcessLabel: document.getElementById('selected-process-label'),
  readyQueueList: document.getElementById('ready-queue-list'),
  waitingQueueList: document.getElementById('waiting-queue-list'),
  activeBayCard: document.getElementById('active-bay-card'),
  ganttLegend: document.getElementById('gantt-legend'),
  ganttChart: document.getElementById('gantt-chart'),
  metricAvgWait: document.getElementById('metric-avg-wait'),
  metricAvgTurnaround: document.getElementById('metric-avg-turnaround'),
  metricAvgResponse: document.getElementById('metric-avg-response'),
  metricUtilization: document.getElementById('metric-utilization'),
  metricsBreakdownNote: document.getElementById('metrics-breakdown-note'),
  whyExplainerText: document.getElementById('why-explainer-text'),
  whyDecisionSelect: document.getElementById('why-decision-select'),
  btnWhyJumpTick: document.getElementById('btn-why-jump-tick'),
  kernelModeIndicator: document.getElementById('kernel-mode-indicator'),
  modeValueText: document.getElementById('mode-value-text'),
  kernelLogList: document.getElementById('kernel-log-list'),
  btnClearLog: document.getElementById('btn-clear-log'),
  syscallBar: document.querySelector('.syscall-bar'),
  sharedResourcesText: document.getElementById('shared-resources-text'),
  tcbTableBody: document.getElementById('tcb-table-body'),
  resourceCards: document.getElementById('resource-cards'),
  deadlockStatusLabel: document.getElementById('deadlock-status-label'),
  deadlockPanel: document.getElementById('deadlock-panel'),
  deadlockExplanation: document.getElementById('deadlock-explanation'),
  btnDeadlockDemo: document.getElementById('btn-deadlock-demo'),
  btnResolveDeadlock: document.getElementById('btn-resolve-deadlock'),
  snapshotCountLabel: document.getElementById('snapshot-count-label'),
  btnTmPrev: document.getElementById('btn-tm-prev'),
  tmSlider: document.getElementById('tm-slider'),
  btnTmNext: document.getElementById('btn-tm-next'),
  tmStatusText: document.getElementById('tm-status-text'),
  btnTmResume: document.getElementById('btn-tm-resume'),
};

let kernelFlashTimer = null;

const PID_COLORS = [
  '#f97316', // orange
  '#38bdf8', // sky blue
  '#22c55e', // green
  '#eab308', // yellow
  '#a78bfa', // violet
  '#2dd4bf', // teal
];

function getPidColor(pid) {
  if (!pid) return '#6b7280';
  return PID_COLORS[Math.abs(Number(pid) - 101) % PID_COLORS.length];
}

function getStateClass(state) {
  if (state === PROCESS_STATES.NEW) return 'state-new';
  if (state === PROCESS_STATES.READY) return 'state-ready';
  if (state === PROCESS_STATES.RUNNING) return 'state-running';
  if (state === PROCESS_STATES.WAITING) return 'state-waiting';
  return 'state-terminated';
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function applyDualViewLabels() {
  const dict = VIEW_LABELS[currentViewMode];
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) {
      el.textContent = dict[key];
    }
  });
  dom.dualViewToggle.textContent =
    currentViewMode === 'story' ? 'View: Story Mode' : 'View: OS Mode';
  dom.kernelModeIndicator.title =
    currentViewMode === 'story'
      ? 'Current Workshop Role (Shop Floor / Shop Manager)'
      : 'Current CPU Privilege Mode (User Mode / Kernel Mode)';
  dom.btnRushHour.title =
    currentViewMode === 'story'
      ? 'Spawn 2–4 predefined vehicle service jobs'
      : 'Spawn 2–4 predefined burst processes';
  const isKernelFlash = dom.kernelModeIndicator.classList.contains('is-kernel');
  dom.modeValueText.textContent = formatModeLabel(
    isKernelFlash ? CPU_MODES.KERNEL : getKernelMode()
  );
}

function updatePlaybackButtons() {
  const isRunningLoop = simulationTimer !== null;
  const done = isSimulationComplete();
  const deadlocked = getDeadlockStatus().detected;
  const replaying = getTimeMachineInfo().isReplaying;

  dom.btnStart.disabled = isRunningLoop || done || deadlocked || replaying;
  dom.btnPause.disabled = !isRunningLoop;
  dom.btnStep.disabled = isRunningLoop || done || deadlocked || replaying;

  dom.openAddJobBtn.disabled = replaying;
  dom.btnRushHour.disabled = replaying;
  dom.btnDeadlockDemo.disabled = replaying;
  dom.btnResolveDeadlock.disabled = replaying || !deadlocked;

  if (dom.syscallBar) {
    dom.syscallBar.querySelectorAll('button').forEach((btn) => {
      btn.disabled = replaying;
    });
  }
}

function updateQuantumVisibility() {
  const isRR = dom.algoSelect.value === ALGORITHMS.RR;
  dom.quantumInput.disabled = !isRR;
  dom.quantumWrapper.style.opacity = isRR ? '1' : '0.5';
}

function renderSummaryAndMetrics() {
  const counts = getProcessSummaryCounts();
  const schedState = getSchedulerState();
  const metrics = calculateMetrics();

  dom.tickDisplay.textContent = String(schedState.currentTick);
  dom.statTotalJobs.textContent = String(counts.total);
  dom.statRunningJobs.textContent = String(counts.running);
  dom.statWaitingJobs.textContent = String(counts.waiting);
  dom.statCompletedJobs.textContent = String(counts.completed);
  dom.statAlgorithm.textContent = schedState.algorithm;
  dom.statCpuUtil.textContent = `${metrics.cpuUtilization.toFixed(0)}%`;
  dom.statContextSwitches.textContent = String(metrics.contextSwitches);

  dom.metricAvgWait.textContent = `${metrics.avgWaiting.toFixed(2)} t`;
  dom.metricAvgTurnaround.textContent = `${metrics.avgTurnaround.toFixed(2)} t`;
  dom.metricAvgResponse.textContent = `${metrics.avgResponse.toFixed(2)} t`;
  dom.metricUtilization.textContent = `${metrics.cpuUtilization.toFixed(1)}%`;
  const unitPlural = currentViewMode === 'story' ? 'vehicles' : 'processes';
  const busyWord = currentViewMode === 'story' ? 'Bay Busy' : 'Busy';
  dom.metricsBreakdownNote.textContent = `Completed: ${metrics.completedCount} / ${metrics.totalCount} ${unitPlural} · ${busyWord}: ${metrics.busyTicks} / ${metrics.currentTick} ticks · Throughput: ${metrics.throughput.toFixed(2)} ${unitPlural}/tick`;
}

function renderQueuesAndBay() {
  const schedState = getSchedulerState();
  const running = schedState.runningPid ? getProcessByPid(schedState.runningPid) : null;
  const ready = schedState.readyQueue.map((pid) => getProcessByPid(pid)).filter(Boolean);
  const waiting = getAllProcesses().filter((p) => p.state === PROCESS_STATES.WAITING);
  const remLabel = currentViewMode === 'story' ? 'Remaining Bay Service' : 'Remaining CPU';

  if (running) {
    dom.activeBayCard.className = 'bay-active-card';
    dom.activeBayCard.innerHTML = `
      <strong>${formatId(running.pid)}: ${escapeHtml(running.name)}</strong>
      <span class="muted-note">${escapeHtml(running.serviceType)} · ${remLabel}: ${running.remainingTime}t · Priority P${running.priority}</span>
    `;
  } else {
    dom.activeBayCard.className = 'bay-empty';
    dom.activeBayCard.textContent =
      currentViewMode === 'story'
        ? 'No vehicle currently in bay (Idle)'
        : 'CPU Idle (No running process)';
  }

  dom.readyQueueList.innerHTML =
    ready.length > 0
      ? ready
          .map(
            (p) =>
              `<div class="queue-item tabular">${formatId(p.pid)} · ${escapeHtml(p.name)} (Rem ${p.remainingTime}t · P${p.priority})</div>`
          )
          .join('')
      : `<span class="empty-hint">${
          currentViewMode === 'story' ? 'Waiting line empty' : 'Ready queue empty'
        }</span>`;

  dom.waitingQueueList.innerHTML =
    waiting.length > 0
      ? waiting
          .map((p) => {
            let waitReason;
            if (p.waitingForResource) {
              const resObj = getResourceById(p.waitingForResource);
              waitReason =
                currentViewMode === 'story'
                  ? `Lock: ${resObj ? resObj.name : p.waitingForResource}`
                  : `Mutex: ${p.waitingForResource}`;
            } else {
              waitReason =
                currentViewMode === 'story'
                  ? `Equip: ${p.ioRemaining}t`
                  : `I/O: ${p.ioRemaining}t`;
            }
            return `<div class="queue-item tabular">${formatId(p.pid)} · ${escapeHtml(p.name)} (${escapeHtml(waitReason)})</div>`;
          })
          .join('')
      : `<span class="empty-hint">${
          currentViewMode === 'story' ? 'No vehicles waiting' : 'Waiting queue empty'
        }</span>`;
}

function renderGanttChart() {
  const { ganttHistory } = getSchedulerState();
  const processes = getAllProcesses();

  if (processes.length > 0) {
    const legendItems = processes
      .map(
        (p) => `
          <span class="gantt-legend-item">
            <span class="gantt-color-swatch" style="background-color: ${getPidColor(p.pid)};"></span>
            <span class="tabular">${formatId(p.pid)}</span>
            <span>(${escapeHtml(p.name)})</span>
          </span>`
      )
      .join('');
    const csLegendText =
      currentViewMode === 'story' ? '= Service Bay Changeover' : '= Context Switch';
    dom.ganttLegend.innerHTML =
      legendItems +
      `<span class="gantt-legend-item"><span class="text-orange tabular">CS</span> <span>${csLegendText}</span></span>`;
  } else {
    dom.ganttLegend.innerHTML = '';
  }

  if (ganttHistory.length === 0) {
    const emptyChartText =
      currentViewMode === 'story'
        ? 'Start or step the shift simulation to record bay timeline ticks.'
        : 'Start or step the simulation to record Gantt ticks.';
    const emptySelectText =
      currentViewMode === 'story' ? 'No assignments yet' : 'No decisions yet';
    dom.ganttChart.innerHTML = `<div class="empty-hint">${emptyChartText}</div>`;
    dom.whyDecisionSelect.innerHTML = `<option value="">${emptySelectText}</option>`;
    dom.whyDecisionSelect.disabled = true;
    dom.btnWhyJumpTick.disabled = true;
    dom.whyExplainerText.textContent =
      currentViewMode === 'story'
        ? 'Select a block in the bay timeline above to view why the shop assigned that vehicle service job at that tick.'
        : 'Select a block in the Gantt chart above to view why the scheduler dispatched that process at that tick.';
    return;
  }

  const csBadgeTitle =
    currentViewMode === 'story' ? 'Service Bay Changeover' : 'Context Switch';

  dom.ganttChart.innerHTML = ganttHistory
    .map((entry) => {
      const isSelected = selectedGanttTick === entry.tick;
      const isIdle = entry.pid === null;
      const pidLabel = isIdle ? 'IDLE' : formatId(entry.pid);
      const color = getPidColor(entry.pid);
      const csDivider = entry.contextSwitch
        ? `<span class="gantt-cs-divider" title="${csBadgeTitle}">CS</span>`
        : '';

      return `${csDivider}
        <button
          type="button"
          class="gantt-block ${isIdle ? 'is-idle' : ''} ${isSelected ? 'is-selected' : ''}"
          style="--pid-color: ${color};"
          data-tick="${entry.tick}"
          title="${escapeHtml(formatDualText(entry.reason))}"
        >
          <span class="gantt-pid tabular">${pidLabel}</span>
          <span class="gantt-time tabular">T${entry.tick}-${entry.tick + 1}</span>
        </button>
      `;
    })
    .join('');

  if (simulationTimer !== null) {
    dom.ganttChart.scrollLeft = dom.ganttChart.scrollWidth;
  }

  if (selectedGanttTick === null || !ganttHistory.some((g) => g.tick === selectedGanttTick)) {
    selectedGanttTick = ganttHistory[ganttHistory.length - 1].tick;
  }

  dom.whyDecisionSelect.disabled = false;
  dom.whyDecisionSelect.innerHTML = ganttHistory
    .map((entry) => {
      const label = entry.pid
        ? `Tick ${entry.tick}: ${formatId(entry.pid)}`
        : `Tick ${entry.tick}: Idle`;
      return `<option value="${entry.tick}">${label}</option>`;
    })
    .join('');
  dom.whyDecisionSelect.value = String(selectedGanttTick);
  dom.btnWhyJumpTick.disabled = false;

  const picked = ganttHistory.find((item) => item.tick === selectedGanttTick);
  if (picked) {
    const csNote = picked.contextSwitch
      ? currentViewMode === 'story'
        ? ' · Service Bay Changeover'
        : ' · Context Switch'
      : '';
    dom.whyExplainerText.textContent = `[Tick ${picked.tick} · ${picked.algorithm}${csNote}] ${formatDualText(picked.reason)}`;
  }
}

function renderPcbTable() {
  const processes = getAllProcesses();
  const selectedPid = getSelectedPid();
  const replaying = getTimeMachineInfo().isReplaying;
  const noSelectionText =
    currentViewMode === 'story' ? 'No vehicle selected' : 'No process selected';

  if (processes.length === 0) {
    const emptyRowText =
      currentViewMode === 'story'
        ? 'No vehicle service jobs loaded.'
        : 'No processes loaded.';
    dom.pcbTableBody.innerHTML = `<tr><td colspan="10" class="empty-cell">${emptyRowText}</td></tr>`;
    dom.selectedProcessLabel.textContent = noSelectionText;
    return;
  }

  const selectedPcb = getProcessByPid(selectedPid);
  dom.selectedProcessLabel.textContent = selectedPcb
    ? `${formatId(selectedPcb.pid)} (${selectedPcb.name})`
    : noSelectionText;

  dom.pcbTableBody.innerHTML = processes
    .map((pcb) => {
      const isSelected = pcb.pid === selectedPid;
      const isTerminated = pcb.state === PROCESS_STATES.TERMINATED;
      const disableMutation = isTerminated || replaying;
      const pidLabel = currentViewMode === 'story' ? `Job #${pcb.pid}` : `${pcb.pid}`;
      const ppidText = pcb.ppid ? formatId(pcb.ppid) : '-';
      const stateLabel = formatStateLabel(pcb.state);

      return `
        <tr data-pid="${pcb.pid}" class="${isSelected ? 'is-selected' : ''}">
          <td class="tabular">${pidLabel}</td>
          <td class="tabular">${ppidText}</td>
          <td>${escapeHtml(pcb.name)}</td>
          <td>${escapeHtml(pcb.serviceType)}</td>
          <td><span class="state-label ${getStateClass(pcb.state)}">${escapeHtml(stateLabel)}</span></td>
          <td class="tabular">
            <input
              type="number"
              class="number-input priority-inline-input"
              data-action="priority"
              data-pid="${pcb.pid}"
              min="1"
              max="10"
              value="${pcb.priority}"
              ${disableMutation ? 'disabled' : ''}
              aria-label="Priority for ${formatId(pcb.pid)}"
            />
          </td>
          <td class="tabular">${pcb.arrivalTime}</td>
          <td class="tabular">${pcb.cpuBurst} / ${pcb.ioBurst}</td>
          <td class="tabular">${pcb.remainingTime}</td>
          <td>
            <div class="action-group">
              <button type="button" class="btn btn-secondary btn-sm" data-action="inspect" data-pid="${pcb.pid}">
                Inspect
              </button>
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                data-action="edit"
                data-pid="${pcb.pid}"
                ${disableMutation ? 'disabled' : ''}
              >
                Edit
              </button>
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                data-action="spawn-child"
                data-pid="${pcb.pid}"
                ${disableMutation ? 'disabled' : ''}
              >
                + Child
              </button>
              <button
                type="button"
                class="btn btn-danger-outline btn-sm"
                data-action="terminate"
                data-pid="${pcb.pid}"
                ${disableMutation ? 'disabled' : ''}
              >
                Terminate
              </button>
              <button
                type="button"
                class="btn btn-danger-outline btn-sm"
                data-action="delete"
                data-pid="${pcb.pid}"
                ${replaying ? 'disabled' : ''}
              >
                Delete
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

function populateParentOptions(excludePid = null, selectedParentPid = null) {
  const activeProcesses = getAllProcesses().filter(
    (p) => p.state !== PROCESS_STATES.TERMINATED && p.pid !== Number(excludePid)
  );
  const noneLabel =
    currentViewMode === 'story'
      ? 'None (Top-level vehicle job)'
      : 'None (Root process)';
  dom.inputParentPid.innerHTML =
    `<option value="">${noneLabel}</option>` +
    activeProcesses
      .map((p) => `<option value="${p.pid}">${formatId(p.pid)} - ${escapeHtml(p.name)}</option>`)
      .join('');
  dom.inputParentPid.value = selectedParentPid ? String(selectedParentPid) : '';
}

function syncJobModalCopy() {
  const isStory = currentViewMode === 'story';
  if (editingPid !== null) {
    dom.addJobTitle.textContent = isStory ? 'Edit Vehicle Service Job' : 'Edit Process';
    dom.submitJobBtn.textContent = isStory ? 'Save Vehicle Job' : 'Save Process';
  } else {
    dom.addJobTitle.textContent = isStory ? 'Add Vehicle Service Job' : 'Add New Process';
    dom.submitJobBtn.textContent = isStory ? 'Create Service Job' : 'Create Process';
  }
  dom.inputJobName.placeholder = isStory
    ? 'e.g., Sedan Civic - Front Tires'
    : 'e.g., Worker Process A';
}

function openAddJobModal() {
  if (getTimeMachineInfo().isReplaying) return;
  editingPid = null;
  dom.addJobForm.reset();
  dom.inputArrival.disabled = false;
  dom.inputArrival.value = String(getSchedulerState().currentTick);
  populateParentOptions(null, null);
  syncJobModalCopy();
  dom.addJobModal.classList.remove('hidden');
  dom.inputJobName.focus();
}

function openEditJobModal(pid) {
  if (getTimeMachineInfo().isReplaying) return;
  const pcb = getProcessByPid(pid);
  if (!pcb || pcb.state === PROCESS_STATES.TERMINATED) return;

  editingPid = pcb.pid;
  dom.inputJobName.value = pcb.name;
  dom.inputServiceType.value = pcb.serviceType;
  dom.inputPriority.value = String(pcb.priority);
  dom.inputArrival.value = String(pcb.arrivalTime);
  dom.inputArrival.disabled = pcb.state !== PROCESS_STATES.NEW;
  dom.inputCpuBurst.value = String(pcb.cpuBurst);
  dom.inputIoBurst.value = String(pcb.ioBurst);
  populateParentOptions(pcb.pid, pcb.ppid);
  syncJobModalCopy();
  dom.addJobModal.classList.remove('hidden');
  dom.inputJobName.focus();
}

function closeAddJobModal() {
  editingPid = null;
  dom.inputArrival.disabled = false;
  dom.addJobModal.classList.add('hidden');
  dom.addJobForm.reset();
}

function openGuideModal() {
  dom.guideModal.classList.remove('hidden');
}

function closeGuideModal() {
  dom.guideModal.classList.add('hidden');
}

function openPcbModal(pid) {
  const pcb = getProcessByPid(pid);
  if (!pcb) return;
  inspectedModalPid = pcb.pid;

  const isStory = currentViewMode === 'story';
  const historyHtml = pcb.transitionHistory
    .map((item) => {
      const fromText = item.from === '-' ? '-' : formatStateLabel(item.from);
      const toText = formatStateLabel(item.to);
      return `
      <div class="history-item">
        <span class="tabular text-orange">[T${item.tick}]</span>
        <span>${escapeHtml(fromText)} &rarr; <strong>${escapeHtml(toText)}</strong>: ${escapeHtml(formatDualText(item.reason))}</span>
      </div>`;
    })
    .join('');

  dom.pcbModalBody.innerHTML = `
    <div class="pcb-kv"><span>${isStory ? 'Job ID / Parent Job' : 'PID / PPID'}</span><strong class="tabular">${pcb.pid} / ${pcb.ppid ?? 'None'}</strong></div>
    <div class="pcb-kv"><span>${isStory ? 'Shop Status' : 'Current State'}</span><strong class="${getStateClass(pcb.state)}">${escapeHtml(formatStateLabel(pcb.state))}</strong></div>
    <div class="pcb-kv"><span>${isStory ? 'Vehicle Job' : 'Process Name'}</span><strong>${escapeHtml(pcb.name)}</strong></div>
    <div class="pcb-kv"><span>${isStory ? 'Service Type' : 'Workload Type'}</span><strong>${escapeHtml(pcb.serviceType)}</strong></div>
    <div class="pcb-kv"><span>${isStory ? 'Priority / Check-In' : 'Priority / Arrival'}</span><strong class="tabular">P${pcb.priority} / Tick ${pcb.arrivalTime}</strong></div>
    <div class="pcb-kv"><span>${isStory ? 'Bay / Equip Remaining' : 'CPU / I/O Remaining'}</span><strong class="tabular">${pcb.remainingTime}t / ${pcb.ioRemaining}t</strong></div>
    <div class="pcb-kv"><span>${isStory ? 'Queue Wait / Shop Turnaround' : 'Wait / Turnaround'}</span><strong class="tabular">${pcb.waitingTime}t / ${pcb.completionTime !== null ? pcb.completionTime - pcb.arrivalTime : '-'}t</strong></div>
    <div class="pcb-kv"><span>${isStory ? 'Bay Response Time' : 'Response Time'}</span><strong class="tabular">${pcb.startTime !== null ? pcb.startTime - pcb.arrivalTime : '-'}t</strong></div>
    <div class="pcb-kv pcb-kv-full">
      <span>${isStory ? 'Mechanic Clipboard (Simulated Registers)' : 'Simulated Registers'}</span>
      <strong class="tabular">PC: ${pcb.registers.PC} · ACC: ${pcb.registers.ACC} · IR: ${pcb.registers.IR} · SP: ${pcb.registers.SP}</strong>
    </div>
    <div class="pcb-kv pcb-kv-full">
      <span>${isStory ? 'Shop Service Lifecycle History' : '5-State Lifecycle History'}</span>
      <div class="history-list">${historyHtml}</div>
    </div>
  `;

  dom.pcbModal.classList.remove('hidden');
}

function closePcbModal() {
  inspectedModalPid = null;
  dom.pcbModal.classList.add('hidden');
}

function pauseSimulation() {
  if (simulationTimer !== null) {
    clearInterval(simulationTimer);
    simulationTimer = null;
  }
  updatePlaybackButtons();
}

function renderKernelLog() {
  const logs = getKernelLogs();

  if (logs.length === 0) {
    const emptyLogText =
      currentViewMode === 'story' ? 'Operations log cleared.' : 'Kernel log cleared.';
    dom.kernelLogList.innerHTML = `<div class="log-entry"><span class="log-text muted-note">${emptyLogText}</span></div>`;
    return;
  }

  dom.kernelLogList.innerHTML = logs
    .map(
      (entry) => `
      <div class="log-entry">
        <span class="log-tick tabular">[T${entry.tick}]</span>
        <span class="log-text"><strong>${escapeHtml(formatLogSource(entry.source))}:</strong> ${escapeHtml(formatDualText(entry.message))}</span>
      </div>`
    )
    .join('');

  dom.kernelLogList.scrollTop = dom.kernelLogList.scrollHeight;
}

function flashKernelMode() {
  dom.kernelModeIndicator.classList.add('is-kernel');
  dom.modeValueText.textContent = formatModeLabel(CPU_MODES.KERNEL);

  if (kernelFlashTimer !== null) {
    clearTimeout(kernelFlashTimer);
  }

  kernelFlashTimer = setTimeout(() => {
    dom.kernelModeIndicator.classList.remove('is-kernel');
    dom.modeValueText.textContent = formatModeLabel(getKernelMode());
    kernelFlashTimer = null;
  }, 450);
}

function runSingleTick() {
  const result = stepSimulationTick();
  if (result.haltedByDeadlock || result.completed) {
    pauseSimulation();
    renderAll();
    return;
  }

  if (result.events && result.events.length > 0) {
    flashKernelMode();
  }

  const { ganttHistory } = getSchedulerState();
  if (ganttHistory.length > 0) {
    selectedGanttTick = ganttHistory[ganttHistory.length - 1].tick;
  }

  renderAll();
}

function startSimulation() {
  if (simulationTimer !== null || isSimulationComplete() || getDeadlockStatus().detected) {
    return;
  }
  const intervalMs = Number(dom.speedSelect.value) || 700;
  logKernelEvent(
    getSchedulerState().currentTick,
    `Simulation started (${dom.algoSelect.value}, ${intervalMs}ms/tick).`,
    'KERNEL'
  );
  simulationTimer = setInterval(runSingleTick, intervalMs);
  renderKernelLog();
  updatePlaybackButtons();
}

function renderThreadsPanel() {
  const selectedPcb = getProcessByPid(getSelectedPid());
  if (!selectedPcb) {
    dom.sharedResourcesText.textContent =
      currentViewMode === 'story'
        ? 'Select a vehicle record from the table to inspect shared work-order workspace details and individual mechanic task clipboards.'
        : 'Select a process row from the PCB table to inspect shared process memory and individual thread private registers.';
    const emptyThreadsText =
      currentViewMode === 'story' ? 'No mechanic tasks to display.' : 'No threads to display.';
    dom.tcbTableBody.innerHTML = `<tr><td colspan="4" class="empty-cell">${emptyThreadsText}</td></tr>`;
    return;
  }

  const shared = getSharedProcessResources(selectedPcb);
  if (currentViewMode === 'story') {
    dom.sharedResourcesText.innerHTML = `
      <strong>Shared:</strong> ${escapeHtml(shared.workOrder)} · Bay Workspace <span class="tabular">${shared.memorySpace}</span> · Equipment Locks: ${escapeHtml(shared.equipmentLocks)}
    `;
  } else {
    dom.sharedResourcesText.innerHTML = `
      <strong>Shared:</strong> Process PID ${selectedPcb.pid} (${escapeHtml(selectedPcb.name)}) · Memory <span class="tabular">${shared.memorySpace}</span> · Mutexes: ${escapeHtml(shared.equipmentLocks)}
    `;
  }

  if (!selectedPcb.threads || selectedPcb.threads.length === 0) {
    const emptyInitText =
      currentViewMode === 'story' ? 'No mechanic tasks initialized.' : 'No threads initialized.';
    dom.tcbTableBody.innerHTML = `<tr><td colspan="4" class="empty-cell">${emptyInitText}</td></tr>`;
    return;
  }

  dom.tcbTableBody.innerHTML = selectedPcb.threads
    .map((tcb) => {
      const stateClass = getStateClass(tcb.state);
      const tidLabel = currentViewMode === 'story' ? `Task #${tcb.tid}` : `T${tcb.tid}`;
      const stateLabel = formatStateLabel(tcb.state);
      return `
        <tr>
          <td class="tabular">${tidLabel}</td>
          <td>${escapeHtml(tcb.name)}</td>
          <td><span class="state-label ${stateClass}">${escapeHtml(stateLabel)}</span></td>
          <td class="tabular">SP:${tcb.privateRegisters.SP} · PC:${tcb.privateRegisters.PC}</td>
        </tr>
      `;
    })
    .join('');
}

function renderResourcesPanel() {
  const resources = getResources();
  const deadlock = getDeadlockStatus();
  const replaying = getTimeMachineInfo().isReplaying;

  if (deadlock.detected) {
    dom.deadlockStatusLabel.textContent =
      currentViewMode === 'story' ? 'Status: GRIDLOCK' : 'Status: DEADLOCK';
    dom.deadlockStatusLabel.className = 'panel-meta text-red';
    dom.deadlockPanel.classList.add('is-deadlocked');
    dom.deadlockExplanation.textContent = formatDualText(deadlock.message);
    dom.btnResolveDeadlock.disabled = replaying;
  } else {
    dom.deadlockStatusLabel.textContent =
      currentViewMode === 'story' ? 'Status: Shop Clear' : 'Status: Normal';
    dom.deadlockStatusLabel.className = 'panel-meta text-green';
    dom.deadlockPanel.classList.remove('is-deadlocked');
    dom.deadlockExplanation.textContent =
      currentViewMode === 'story'
        ? 'Triggers a 2-job circular wait between Pneumatic Tire Changer and Digital Dynamic Wheel Balancer.'
        : 'Triggers a 2-process circular wait between Pneumatic Tire Changer and Digital Dynamic Wheel Balancer.';
    dom.btnResolveDeadlock.disabled = true;
  }

  dom.resourceCards.innerHTML = resources
    .map((res) => {
      const statusText = res.locked
        ? currentViewMode === 'story'
          ? 'In Use (Equipment Lock)'
          : 'Locked (Mutex Held)'
        : 'Available';
      const statusClass = res.locked ? 'text-amber' : 'text-green';
      const ownerPcb = res.ownerPid ? getProcessByPid(res.ownerPid) : null;
      const ownerLabel = ownerPcb
        ? `${formatId(ownerPcb.pid)} (${escapeHtml(ownerPcb.name)})`
        : 'None';
      const waitingLabel =
        res.waitingQueue.length > 0
          ? res.waitingQueue.map((pid) => formatId(pid)).join(', ')
          : 'None';

      return `
        <div class="resource-card">
          <div class="resource-top">
            <strong>${escapeHtml(res.name)}</strong>
            <span class="status-text ${statusClass}">${statusText}</span>
          </div>
          <div class="resource-meta tabular">Owner: ${ownerLabel} · Waiting: ${waitingLabel}</div>
        </div>
      `;
    })
    .join('');
}

function renderTimeMachine() {
  const tm = getTimeMachineInfo();
  const snapWord = currentViewMode === 'story' ? 'checkpoint' : 'snapshot';
  dom.snapshotCountLabel.textContent = `${tm.count} ${snapWord}${tm.count === 1 ? '' : 's'}`;
  const liveText =
    currentViewMode === 'story'
      ? `Viewing live shop floor (Tick ${tm.currentSnapshotTick})`
      : `Viewing live state (Tick ${tm.currentSnapshotTick})`;

  if (tm.count <= 1) {
    dom.tmSlider.min = '0';
    dom.tmSlider.max = '0';
    dom.tmSlider.value = '0';
    dom.tmSlider.disabled = true;
    dom.btnTmPrev.disabled = true;
    dom.btnTmNext.disabled = true;
    dom.btnTmResume.disabled = true;
    dom.tmStatusText.textContent = liveText;
    dom.tmStatusText.className = 'muted-note';
    return;
  }

  dom.tmSlider.disabled = false;
  dom.tmSlider.min = '0';
  dom.tmSlider.max = String(tm.count - 1);
  dom.tmSlider.value = String(tm.viewIndex);

  dom.btnTmPrev.disabled = tm.viewIndex <= 0;
  dom.btnTmNext.disabled = tm.viewIndex >= tm.count - 1;
  dom.btnTmResume.disabled = !tm.isReplaying;

  if (tm.isReplaying) {
    const labelText =
      currentViewMode === 'story'
        ? tm.currentLabel.replace('Deadlock', 'Gridlock')
        : tm.currentLabel;
    dom.tmStatusText.textContent = `Replay Mode: ${labelText} (click Resume Here to branch)`;
    dom.tmStatusText.className = 'muted-note text-orange';
  } else {
    dom.tmStatusText.textContent = liveText;
    dom.tmStatusText.className = 'muted-note';
  }
}

function resetAll(presetKey = currentPresetKey) {
  pauseSimulation();
  currentPresetKey = presetKey;
  selectedGanttTick = null;
  resetSimulation(presetKey);
  renderAll();
}

function resetSimulationStateOnly() {
  pauseSimulation();
  selectedGanttTick = null;
  resetSimulationPreservingProcesses();
  renderAll();
}

function renderAll() {
  renderSummaryAndMetrics();
  renderQueuesAndBay();
  renderGanttChart();
  renderPcbTable();
  renderThreadsPanel();
  renderResourcesPanel();
  renderKernelLog();
  renderTimeMachine();
  updatePlaybackButtons();
}

function bindEvents() {
  dom.dualViewToggle.addEventListener('click', () => {
    currentViewMode = currentViewMode === 'story' ? 'os' : 'story';
    applyDualViewLabels();
    renderAll();
    if (inspectedModalPid !== null && !dom.pcbModal.classList.contains('hidden')) {
      openPcbModal(inspectedModalPid);
    }
    if (!dom.addJobModal.classList.contains('hidden')) {
      const currentParent = dom.inputParentPid.value || null;
      populateParentOptions(editingPid, currentParent);
      syncJobModalCopy();
    }
  });

  dom.btnStart.addEventListener('click', startSimulation);
  dom.btnPause.addEventListener('click', pauseSimulation);
  dom.btnStep.addEventListener('click', runSingleTick);
  dom.btnReset.addEventListener('click', resetSimulationStateOnly);

  dom.algoSelect.addEventListener('change', () => {
    setAlgorithm(dom.algoSelect.value);
    updateQuantumVisibility();
    renderSummaryAndMetrics();
  });

  dom.quantumInput.addEventListener('change', () => {
    setTimeQuantum(dom.quantumInput.value);
    dom.quantumInput.value = String(getSchedulerState().timeQuantum);
  });

  dom.speedSelect.addEventListener('change', () => {
    if (simulationTimer !== null) {
      pauseSimulation();
      startSimulation();
    }
  });

  dom.btnLoadPreset.addEventListener('click', () => {
    resetAll(dom.presetSelect.value);
  });

  dom.btnRushHour.addEventListener('click', () => {
    if (getTimeMachineInfo().isReplaying) return;
    const spawned = triggerRushHour();
    if (spawned.length > 0) {
      flashKernelMode();
      renderAll();
    }
  });

  dom.ganttChart.addEventListener('click', (event) => {
    const block = event.target.closest('.gantt-block');
    if (!block) return;
    selectedGanttTick = Number(block.dataset.tick);
    renderGanttChart();
  });

  dom.whyDecisionSelect.addEventListener('change', () => {
    if (dom.whyDecisionSelect.value === '') return;
    selectedGanttTick = Number(dom.whyDecisionSelect.value);
    renderGanttChart();
  });

  dom.btnWhyJumpTick.addEventListener('click', () => {
    if (selectedGanttTick === null) return;
    pauseSimulation();
    // Jump to snapshot right after that tick completed (selectedGanttTick + 1), or exact tick if available
    const jumped =
      jumpToTickSnapshot(selectedGanttTick + 1) || jumpToTickSnapshot(selectedGanttTick);
    if (jumped) {
      renderAll();
    }
  });

  dom.openGuideBtn.addEventListener('click', openGuideModal);
  dom.closeGuideModalBtn.addEventListener('click', closeGuideModal);
  dom.ackGuideBtn.addEventListener('click', closeGuideModal);

  dom.openAddJobBtn.addEventListener('click', openAddJobModal);
  dom.closeAddJobBtn.addEventListener('click', closeAddJobModal);
  dom.cancelAddJobBtn.addEventListener('click', closeAddJobModal);
  dom.closePcbModalBtn.addEventListener('click', closePcbModal);

  dom.addJobModal.addEventListener('click', (event) => {
    if (event.target === dom.addJobModal) {
      closeAddJobModal();
    }
  });

  dom.pcbModal.addEventListener('click', (event) => {
    if (event.target === dom.pcbModal) {
      closePcbModal();
    }
  });

  dom.guideModal.addEventListener('click', (event) => {
    if (event.target === dom.guideModal) {
      closeGuideModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!dom.addJobModal.classList.contains('hidden')) {
      closeAddJobModal();
    }
    if (!dom.pcbModal.classList.contains('hidden')) {
      closePcbModal();
    }
    if (!dom.guideModal.classList.contains('hidden')) {
      closeGuideModal();
    }
  });

  dom.addJobForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (getTimeMachineInfo().isReplaying) return;
    const tick = getSchedulerState().currentTick;
    const payload = {
      name: dom.inputJobName.value,
      serviceType: dom.inputServiceType.value,
      priority: dom.inputPriority.value,
      arrivalTime: dom.inputArrival.value,
      cpuBurst: dom.inputCpuBurst.value,
      ioBurst: dom.inputIoBurst.value,
      ppid: dom.inputParentPid.value || null,
    };

    if (editingPid !== null) {
      const updated = sysUpdateProcess(editingPid, payload, tick);
      if (updated) {
        setSelectedPid(updated.pid);
      }
    } else {
      const pcb = sysCreateProcess(payload, tick);
      setSelectedPid(pcb.pid);
    }

    syncLiveSnapshot();
    flashKernelMode();
    closeAddJobModal();
    renderAll();
  });

  dom.pcbTableBody.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    const tick = getSchedulerState().currentTick;

    if (button) {
      const action = button.dataset.action;
      const pid = Number(button.dataset.pid);

      if (action === 'inspect') {
        setSelectedPid(pid);
        renderAll();
        openPcbModal(pid);
      } else if (action === 'edit') {
        if (getTimeMachineInfo().isReplaying) return;
        setSelectedPid(pid);
        openEditJobModal(pid);
      } else if (action === 'spawn-child') {
        if (getTimeMachineInfo().isReplaying) return;
        const child = spawnChildProcess(pid, tick);
        if (child) {
          initializeProcessThreads(child);
          enqueueReadyProcess(child.pid);
          setSelectedPid(child.pid);
          logKernelEvent(
            tick,
            `createProcess() -> Parent PID ${pid} spawned Child PID ${child.pid} (${child.threads.length} threads).`,
            'KERNEL'
          );
          syncLiveSnapshot();
          flashKernelMode();
        }
        renderAll();
      } else if (action === 'terminate') {
        if (getTimeMachineInfo().isReplaying) return;
        sysTerminateProcess(pid, tick, 'Terminated manually from PCB table.');
        syncLiveSnapshot();
        flashKernelMode();
        renderAll();
      } else if (action === 'delete') {
        if (getTimeMachineInfo().isReplaying) return;
        sysDeleteProcess(pid, tick);
        syncLiveSnapshot();
        flashKernelMode();
        renderAll();
      }
      return;
    }

    const row = event.target.closest('tr[data-pid]');
    if (row && !event.target.closest('input')) {
      setSelectedPid(Number(row.dataset.pid));
      renderAll();
    }
  });

  dom.pcbTableBody.addEventListener('change', (event) => {
    if (getTimeMachineInfo().isReplaying) return;
    const input = event.target.closest('input[data-action="priority"]');
    if (!input) return;
    updateProcessPriority(Number(input.dataset.pid), input.value);
    syncLiveSnapshot();
    renderAll();
  });

  dom.btnClearLog.addEventListener('click', () => {
    clearKernelLogs();
    renderKernelLog();
  });

  dom.syscallBar.addEventListener('click', (event) => {
    if (getTimeMachineInfo().isReplaying) return;
    const button = event.target.closest('button[data-syscall]');
    if (!button) return;

    const syscall = button.dataset.syscall;
    const schedState = getSchedulerState();
    const targetPid = getSelectedPid() ?? schedState.runningPid;

    if (syscall === 'createThread') {
      const threadName =
        currentViewMode === 'story' ? 'Extra Tire Balance Check' : 'Auxiliary Worker Thread';
      sysCreateThread(targetPid, threadName, schedState.currentTick);
    } else if (syscall === 'joinThread') {
      sysJoinThread(targetPid, null, schedState.currentTick);
    } else if (syscall === 'requestIO') {
      sysRequestIO(schedState.runningPid ?? targetPid, 2, schedState.currentTick);
    } else if (syscall === 'yieldProcess') {
      sysYieldProcess(schedState.runningPid, schedState.currentTick);
    }

    syncLiveSnapshot();
    flashKernelMode();
    renderAll();
  });

  dom.btnDeadlockDemo.addEventListener('click', () => {
    if (getTimeMachineInfo().isReplaying) return;
    pauseSimulation();
    selectedGanttTick = null;
    runDeadlockDemo();
    flashKernelMode();
    renderAll();
  });

  dom.btnResolveDeadlock.addEventListener('click', () => {
    if (getTimeMachineInfo().isReplaying) return;
    const resolved = resolveDeadlockDemo();
    if (resolved) {
      flashKernelMode();
    }
    renderAll();
  });

  dom.btnTmPrev.addEventListener('click', () => {
    pauseSimulation();
    if (stepSnapshotBackward()) {
      selectedGanttTick = null;
      renderAll();
    }
  });

  dom.btnTmNext.addEventListener('click', () => {
    pauseSimulation();
    if (stepSnapshotForward()) {
      selectedGanttTick = null;
      renderAll();
    }
  });

  dom.tmSlider.addEventListener('input', () => {
    pauseSimulation();
    if (previewSnapshot(dom.tmSlider.value)) {
      selectedGanttTick = null;
      renderAll();
    }
  });

  dom.btnTmResume.addEventListener('click', () => {
    pauseSimulation();
    if (resumeFromSnapshot()) {
      flashKernelMode();
      renderAll();
    }
  });
}

// Initialize Phase 3 Dashboard
function init() {
  setAlgorithm(dom.algoSelect.value);
  setTimeQuantum(dom.quantumInput.value);
  updateQuantumVisibility();
  applyDualViewLabels();
  bindEvents();
  resetAll('balanced');
}

init();
