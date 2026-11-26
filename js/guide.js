// =========================================================
// Dual View Scenario Mapping Reference
// Provides the 1-to-1 Story Mode <-> OS Mode mapping table endered inside the Guide Modal.
// =========================================================

export const DUAL_VIEW_TERMINOLOGY = Object.freeze([
  ['Shop Floor / Shop Manager', 'User Mode / Kernel Mode', 'Normal execution vs. privileged manager/kernel actions'],
  ['Shop Operations Manager', 'OS Kernel', 'Coordinates jobs, waiting lines, syscalls, and equipment locks'],
  ['Active Service Bay', 'CPU', 'Executes 1 active job or process per simulation tick'],
  ['Vehicle Service Job (Job #001)', 'Process (PID 001)', 'Independent work order starting at 001 with fixed or custom bursts'],
  ['Parent Job (000 = Top-Level)', 'Parent Process (PPID / 000)', 'Tracks parent-child spawn relationships without renumbering'],
  ['Vehicle Service Record', 'PCB (Process Control Block)', 'Stores PID, PPID, state, priority, registers, and lifecycle history'],
  ['Mechanic Service Task (Task #)', 'Thread (TCB / TID)', 'Sub-tasks sharing workspace memory with private clipboards'],
  ['Bay Waiting Line / Equip Wait Line', 'Ready Queue / Waiting Queue', 'Waiting lines for service bay dispatch or equipment I/O'],
  ['Bay Turn (Q)', 'Time Quantum (Q)', 'Max ticks per turn under Round Robin before rotation'],
  ['Equipment Lock', 'Mutex Lock', 'Exclusive lock on Tire Changer or Wheel Balancer'],
  ['Service Bay Changeover', 'Context Switch (CS)', 'Switching the bay or CPU from one job/process to another'],
  ['Shop Gridlock', 'Deadlock', '2-job circular wait between Tire Changer and Wheel Balancer'],
  ['Rush Hour', 'Burst Workload', 'Spawns 2–4 predefined fixed-attribute jobs with next available IDs'],
  ['Shift Replay (Checkpoints)', 'Time Machine (Snapshots)', 'Tick-by-tick history scrubbing and Resume Here branching'],
]);
