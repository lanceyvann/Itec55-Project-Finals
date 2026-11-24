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
  resolveDeadlockDemo,
  resumeFromSnapshot,
  runDeadlockDemo,
  stepSimulationTick,
  stepSnapshotBackward,
  stepSnapshotForward,
  syncLiveSnapshot,
} from './simulation.js';

// Dual View Terminology Dictionary (Story View <-> OS View)
const VIEW_LABELS = {
  story: {
    brandSubtitle: 'Automotive Tire Service Workshop Simulator',
    navScheduler: 'Service Bay & Gantt',
    navProcesses: 'Vehicle Records',
    navResources: 'Mechanics & Equipment',
    navKernel: 'Operations Log',
    kpiTotal: 'Total Vehicle Jobs',
    kpiRunning: 'Undergoing Tire Service',
    kpiWaiting: 'Waiting for Equipment',
    kpiCompleted: 'Service Completed',
    kpiUtilization: 'Active Bay Utilization',
    baySectionTitle: 'Active Service Bay & Queues',
    contextSwitchLabel: 'Service Bay Changeovers',
    cpuLabel: 'Active Service Bay (Running)',
    readyQueueLabel: 'Vehicles Waiting for Service (Ready Queue)',
    waitingQueueLabel: 'Waiting for Equipment / I/O (Waiting Queue)',
    metricUtilLabel: 'Bay Utilization',
    pcbTableTitle: 'Vehicle Service Records (Process Control Blocks)',
    pcbHint: 'Click a vehicle record to view mechanic tasks',
    colPid: 'Job ID',
    colPpid: 'Parent Job',
    colJobName: 'Vehicle Job',
    colServiceType: 'Service Type',
    colPcbState: 'Shop Status',
    colBurst: 'Service / Equip',
    threadTitle: 'Mechanic Service Tasks (Threads / TCB)',
    sharedResourcesLabel: 'Shared Work-Order Resources',
    colTid: 'Task ID',
    colTaskName: 'Mechanic Task',
    colTcbState: 'Task Status',
    colPrivateRegs: 'Mechanic Clipboard (Private)',
    equipmentTitle: 'Service Equipment & Mutex Locks',
    kernelTitle: 'Shop Operations Manager (Kernel Log)',
    pcbModalTitle: 'Vehicle Service Record (PCB)',
    addJobBtn: '+ Add Vehicle Job',
    fieldJobName: 'Vehicle / Job Name',
    fieldServiceType: 'Tire Service Type',
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
    metricUtilLabel: 'CPU Utilization',
    pcbTableTitle: 'Process Control Blocks (PCB)',
    pcbHint: 'Click a PCB row to inspect its TCB threads',
    colPid: 'PID',
    colPpid: 'PPID',
    colJobName: 'Process Name',
    colServiceType: 'Workload Type',
    colPcbState: 'State',
    colBurst: 'Burst (CPU/I/O)',
    threadTitle: 'Thread Control Blocks (TCB)',
    sharedResourcesLabel: 'Shared Process Resources',
    colTid: 'TID',
    colTaskName: 'Thread Name',
    colTcbState: 'State',
    colPrivateRegs: 'Private Registers',
    equipmentTitle: 'Shared Resources & Mutex Locks',
    kernelTitle: 'OS Kernel & System Calls Log',
    pcbModalTitle: 'Process Control Block (PCB) Details',
    addJobBtn: '+ Add Process',
    fieldJobName: 'Process Name',
    fieldServiceType: 'Workload Type',
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
  const unitPlural = currentViewMode === 'story' ? 'jobs' : 'processes';
  dom.metricsBreakdownNote.textContent = `Completed: ${metrics.completedCount} / ${metrics.totalCount} ${unitPlural} · Busy: ${metrics.busyTicks} / ${metrics.currentTick} ticks · Throughput: ${metrics.throughput.toFixed(2)} ${unitPlural}/tick`;
}

function renderQueuesAndBay() {
  const schedState = getSchedulerState();
  const running = schedState.runningPid ? getProcessByPid(schedState.runningPid) : null;
  const ready = schedState.readyQueue.map((pid) => getProcessByPid(pid)).filter(Boolean);
  const waiting = getAllProcesses().filter((p) => p.state === PROCESS_STATES.WAITING);

  if (running) {
    dom.activeBayCard.className = 'bay-active-card';
    dom.activeBayCard.innerHTML = `
      <strong>${formatId(running.pid)}: ${escapeHtml(running.name)}</strong>
      <span class="muted-note">${escapeHtml(running.serviceType)} · Remaining CPU: ${running.remainingTime}t · Priority P${running.priority}</span>
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
      : '<span class="empty-hint">Queue empty</span>';

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
    dom.ganttChart.innerHTML =
      '<div class="empty-hint">Start or step the simulation to record timeline ticks.</div>';
    dom.whyDecisionSelect.innerHTML = '<option value="">No decisions yet</option>';
    dom.whyDecisionSelect.disabled = true;
    dom.btnWhyJumpTick.disabled = true;
    dom.whyExplainerText.textContent =
      currentViewMode === 'story'
        ? 'Select a block in the Gantt chart above to view why the scheduler picked that vehicle service job at that tick.'
        : 'Select a block in the Gantt chart above to view why the scheduler dispatched that process at that tick.';
    return;
  }

  dom.ganttChart.innerHTML = ganttHistory
    .map((entry) => {
      const isSelected = selectedGanttTick === entry.tick;
      const isIdle = entry.pid === null;
      const pidLabel = isIdle ? 'IDLE' : formatId(entry.pid);
      const color = getPidColor(entry.pid);
      const csDivider = entry.contextSwitch
        ? '<span class="gantt-cs-divider" title="Context Switch / Service Bay Changeover">CS</span>'
        : '';

      return `${csDivider}
        <button
          type="button"
          class="gantt-block ${isIdle ? 'is-idle' : ''} ${isSelected ? 'is-selected' : ''}"
          style="--pid-color: ${color};"
          data-tick="${entry.tick}"
          title="${escapeHtml(entry.reason)}"
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
    const csNote = picked.contextSwitch ? ' · Context Switch' : '';
    dom.whyExplainerText.textContent = `[Tick ${picked.tick} · ${picked.algorithm}${csNote}] ${picked.reason}`;
  }
}

function renderPcbTable() {
  const processes = getAllProcesses();
  const selectedPid = getSelectedPid();
  const replaying = getTimeMachineInfo().isReplaying;

  if (processes.length === 0) {
    dom.pcbTableBody.innerHTML =
      '<tr><td colspan="10" class="empty-cell">No vehicle service jobs loaded.</td></tr>';
    dom.selectedProcessLabel.textContent = 'No job selected';
    return;
  }

  const selectedPcb = getProcessByPid(selectedPid);
  dom.selectedProcessLabel.textContent = selectedPcb
    ? `${formatId(selectedPcb.pid)} (${selectedPcb.name})`
    : 'No job selected';

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
        <span>${escapeHtml(fromText)} &rarr; <strong>${escapeHtml(toText)}</strong>: ${escapeHtml(item.reason)}</span>
      </div>`;
    })
    .join('');

  dom.pcbModalBody.innerHTML = `
    <div class="pcb-kv"><span>${isStory ? 'Job ID / Parent Job' : 'PID / PPID'}</span><strong class="tabular">${pcb.pid} / ${pcb.ppid ?? 'None'}</strong></div>
    <div class="pcb-kv"><span>${isStory ? 'Shop Status' : 'Current State'}</span><strong class="${getStateClass(pcb.state)}">${escapeHtml(formatStateLabel(pcb.state))}</strong></div>
    <div class="pcb-kv"><span>${isStory ? 'Vehicle Job' : 'Process Name'}</span><strong>${escapeHtml(pcb.name)}</strong></div>
    <div class="pcb-kv"><span>${isStory ? 'Service Type' : 'Workload Type'}</span><strong>${escapeHtml(pcb.serviceType)}</strong></div>
    <div class="pcb-kv"><span>Priority / Arrival</span><strong class="tabular">P${pcb.priority} / Tick ${pcb.arrivalTime}</strong></div>
    <div class="pcb-kv"><span>${isStory ? 'Bay / Equip Remaining' : 'CPU / I/O Remaining'}</span><strong class="tabular">${pcb.remainingTime}t / ${pcb.ioRemaining}t</strong></div>
    <div class="pcb-kv"><span>Wait / Turnaround</span><strong class="tabular">${pcb.waitingTime}t / ${pcb.completionTime !== null ? pcb.completionTime - pcb.arrivalTime : '-'}t</strong></div>
    <div class="pcb-kv"><span>Response Time</span><strong class="tabular">${pcb.startTime !== null ? pcb.startTime - pcb.arrivalTime : '-'}t</strong></div>
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
    dom.kernelLogList.innerHTML =
      '<div class="log-entry"><span class="log-text muted-note">Kernel log cleared.</span></div>';
    return;
  }

  dom.kernelLogList.innerHTML = logs
    .map(
      (entry) => `
      <div class="log-entry">
        <span class="log-tick tabular">[T${entry.tick}]</span>
        <span class="log-text"><strong>${escapeHtml(entry.source)}:</strong> ${escapeHtml(entry.message)}</span>
      </div>`
    )
    .join('');

  dom.kernelLogList.scrollTop = dom.kernelLogList.scrollHeight;
}

function flashKernelMode() {
  dom.kernelModeIndicator.classList.add('is-kernel');
  dom.modeValueText.textContent = CPU_MODES.KERNEL;

  if (kernelFlashTimer !== null) {
    clearTimeout(kernelFlashTimer);
  }

  kernelFlashTimer = setTimeout(() => {
    dom.kernelModeIndicator.classList.remove('is-kernel');
    dom.modeValueText.textContent = getKernelMode();
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
        ? 'Select a vehicle record from the table to inspect shared work-order resources and individual mechanic task clipboards.'
        : 'Select a process row from the PCB table to inspect shared process memory and individual thread private registers.';
    dom.tcbTableBody.innerHTML =
      '<tr><td colspan="4" class="empty-cell">No threads to display.</td></tr>';
    return;
  }

  const shared = getSharedProcessResources(selectedPcb);
  if (currentViewMode === 'story') {
    dom.sharedResourcesText.innerHTML = `
      <strong>Shared:</strong> ${escapeHtml(shared.workOrder)} · Bay Workspace <span class="tabular">${shared.memorySpace}</span> · Equipment Locks: ${escapeHtml(shared.equipmentLocks)}
    `;
  } else {
    dom.sharedResourcesText.innerHTML = `
      <strong>Shared:</strong> ${escapeHtml(shared.workOrder)} · Memory <span class="tabular">${shared.memorySpace}</span> · Mutexes: ${escapeHtml(shared.equipmentLocks)}
    `;
  }

  if (!selectedPcb.threads || selectedPcb.threads.length === 0) {
    dom.tcbTableBody.innerHTML =
      '<tr><td colspan="4" class="empty-cell">No threads initialized.</td></tr>';
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
    dom.deadlockStatusLabel.textContent = 'Status: DEADLOCK';
    dom.deadlockStatusLabel.className = 'panel-meta text-red';
    dom.deadlockPanel.classList.add('is-deadlocked');
    dom.deadlockExplanation.textContent = deadlock.message;
    dom.btnResolveDeadlock.disabled = replaying;
  } else {
    dom.deadlockStatusLabel.textContent = 'Status: Normal';
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
  dom.snapshotCountLabel.textContent = `${tm.count} snapshot${tm.count === 1 ? '' : 's'}`;

  if (tm.count <= 1) {
    dom.tmSlider.min = '0';
    dom.tmSlider.max = '0';
    dom.tmSlider.value = '0';
    dom.tmSlider.disabled = true;
    dom.btnTmPrev.disabled = true;
    dom.btnTmNext.disabled = true;
    dom.btnTmResume.disabled = true;
    dom.tmStatusText.textContent = `Viewing live state (Tick ${tm.currentSnapshotTick})`;
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
    dom.tmStatusText.textContent = `Replay Mode: ${tm.currentLabel} (click Resume Here to branch)`;
    dom.tmStatusText.className = 'muted-note text-orange';
  } else {
    dom.tmStatusText.textContent = `Viewing live state (Tick ${tm.currentSnapshotTick})`;
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
  dom.btnReset.addEventListener('click', () => resetAll(currentPresetKey));

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
      sysCreateThread(targetPid, 'Extra Tire Balance Check', schedState.currentTick);
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
