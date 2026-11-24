// =========================================================
// PitStop OS - Resource & Mutex Management (Phase 6)
// Manages the two primary service equipment resources:
// 1. Pneumatic Tire Changer
// 2. Digital Dynamic Wheel Balancer
// =========================================================

import {
  PROCESS_STATES,
  getProcessByPid,
  transitionProcessState,
} from './processes.js';

export const EQUIPMENT_IDS = {
  CHANGER: 'changer',
  BALANCER: 'balancer',
};

let resources = [];
let deadlockDetected = false;
let deadlockMessage = '';

/**
 * Initializes the two primary tire shop equipment resources.
 */
export function resetResources() {
  resources = [
    {
      id: EQUIPMENT_IDS.CHANGER,
      name: 'Pneumatic Tire Changer',
      available: true,
      locked: false,
      ownerPid: null,
      waitingQueue: [],
    },
    {
      id: EQUIPMENT_IDS.BALANCER,
      name: 'Digital Dynamic Wheel Balancer',
      available: true,
      locked: false,
      ownerPid: null,
      waitingQueue: [],
    },
  ];
  deadlockDetected = false;
  deadlockMessage = '';
}

export function getResources() {
  return resources;
}

export function getResourceById(resourceId) {
  return resources.find((r) => r.id === resourceId) || null;
}

export function getDeadlockStatus() {
  return {
    detected: deadlockDetected,
    message: deadlockMessage,
  };
}

/**
 * Maps a tire service type to its primary equipment resource (if any).
 */
export function getRequiredResourceForService(serviceType) {
  if (serviceType === 'Tire Replacement') return EQUIPMENT_IDS.CHANGER;
  if (serviceType === 'Wheel Balancing') return EQUIPMENT_IDS.BALANCER;
  return null;
}

/**
 * Attempts to acquire a mutex lock on an equipment resource for a process.
 * Returns { acquired: boolean, reason: string }.
 */
export function acquireResource(resourceId, pid, tick = 0) {
  const res = getResourceById(resourceId);
  const pcb = getProcessByPid(pid);
  if (!res || !pcb || pcb.state === PROCESS_STATES.TERMINATED) {
    return { acquired: false, reason: 'Invalid resource or inactive process.' };
  }

  // Already owns this lock
  if (res.ownerPid === pcb.pid) {
    return { acquired: true, reason: `PID ${pcb.pid} already holds ${res.name}.` };
  }

  // Available -> lock mutex immediately
  if (res.available && !res.locked) {
    res.available = false;
    res.locked = true;
    res.ownerPid = pcb.pid;
    res.waitingQueue = res.waitingQueue.filter((id) => id !== pcb.pid);
    if (!pcb.heldResources.includes(res.name)) {
      pcb.heldResources.push(res.name);
    }
    if (pcb.waitingForResource === res.id) {
      pcb.waitingForResource = null;
    }
    return {
      acquired: true,
      reason: `PID ${pcb.pid} locked mutex on ${res.name}.`,
    };
  }

  // Locked by another process -> place PID in waiting queue
  if (!res.waitingQueue.includes(pcb.pid)) {
    res.waitingQueue.push(pcb.pid);
  }
  pcb.waitingForResource = res.id;

  if (pcb.state !== PROCESS_STATES.WAITING) {
    transitionProcessState(
      pcb,
      PROCESS_STATES.WAITING,
      tick,
      `Waiting for mutex lock on ${res.name} (held by PID ${res.ownerPid}).`
    );
  }

  checkCircularDeadlock();

  return {
    acquired: false,
    reason: `Mutex busy: PID ${pcb.pid} added to ${res.name} waiting queue (owner: PID ${res.ownerPid}).`,
  };
}

/**
 * Releases a resource mutex held by a process and wakes the next waiting PID.
 * Returns array of woken PIDs so the scheduler can re-enqueue them.
 */
export function releaseResource(resourceId, pid = null, tick = 0) {
  const res = getResourceById(resourceId);
  if (!res || res.ownerPid === null) return [];

  if (pid !== null && res.ownerPid !== Number(pid)) {
    return [];
  }

  const prevOwner = getProcessByPid(res.ownerPid);
  if (prevOwner) {
    prevOwner.heldResources = prevOwner.heldResources.filter(
      (name) => name !== res.name
    );
  }

  res.available = true;
  res.locked = false;
  res.ownerPid = null;

  const wokenPids = [];

  // Hand mutex lock to the next active waiting process in FIFO order
  while (res.waitingQueue.length > 0) {
    const nextPid = res.waitingQueue.shift();
    const nextPcb = getProcessByPid(nextPid);
    if (nextPcb && nextPcb.state !== PROCESS_STATES.TERMINATED) {
      res.available = false;
      res.locked = true;
      res.ownerPid = nextPcb.pid;
      nextPcb.waitingForResource = null;
      if (!nextPcb.heldResources.includes(res.name)) {
        nextPcb.heldResources.push(res.name);
      }
      if (nextPcb.state === PROCESS_STATES.WAITING) {
        transitionProcessState(
          nextPcb,
          PROCESS_STATES.READY,
          tick,
          `Acquired released mutex on ${res.name}; returned to Ready Queue.`
        );
      }
      wokenPids.push(nextPcb.pid);
      break;
    }
  }

  checkCircularDeadlock();
  return wokenPids;
}

/**
 * Releases all equipment mutexes held or awaited by a terminated process.
 */
export function releaseAllResourcesForPid(pid, tick = 0) {
  const numPid = Number(pid);
  const woken = [];

  for (const res of resources) {
    res.waitingQueue = res.waitingQueue.filter((id) => id !== numPid);
    if (res.ownerPid === numPid) {
      woken.push(...releaseResource(res.id, numPid, tick));
    }
  }

  const pcb = getProcessByPid(numPid);
  if (pcb) {
    pcb.heldResources = [];
    pcb.waitingForResource = null;
  }

  checkCircularDeadlock();
  return woken;
}

/**
 * Detects a 2-resource circular wait deadlock among active processes.
 */
export function checkCircularDeadlock() {
  const changer = getResourceById(EQUIPMENT_IDS.CHANGER);
  const balancer = getResourceById(EQUIPMENT_IDS.BALANCER);

  if (!changer || !balancer) {
    deadlockDetected = false;
    deadlockMessage = '';
    return false;
  }

  if (changer.ownerPid !== null && balancer.ownerPid !== null) {
    const ownerA = changer.ownerPid;
    const ownerB = balancer.ownerPid;

    const aWantsBalancer = balancer.waitingQueue.includes(ownerA);
    const bWantsChanger = changer.waitingQueue.includes(ownerB);

    if (ownerA !== ownerB && aWantsBalancer && bWantsChanger) {
      deadlockDetected = true;
      deadlockMessage = `DEADLOCK DETECTED: PID ${ownerA} holds Pneumatic Tire Changer and waits for Wheel Balancer, while PID ${ownerB} holds Wheel Balancer and waits for Pneumatic Tire Changer.`;
      return true;
    }
  }

  deadlockDetected = false;
  deadlockMessage = '';
  return false;
}

export function exportResourceState() {
  return {
    resources: JSON.parse(JSON.stringify(resources)),
    deadlockDetected,
    deadlockMessage,
  };
}

export function importResourceState(snapshot) {
  if (!snapshot) return;
  resources = JSON.parse(JSON.stringify(snapshot.resources));
  deadlockDetected = Boolean(snapshot.deadlockDetected);
  deadlockMessage = snapshot.deadlockMessage || '';
}
