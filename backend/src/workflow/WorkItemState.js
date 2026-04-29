/**
 * STATE PATTERN — Work Item Lifecycle
 * Each state encapsulates its own transition rules.
 * Invalid transitions throw, preventing illegal state changes.
 *
 * Lifecycle: OPEN → INVESTIGATING → RESOLVED → CLOSED
 *            (CLOSED requires a complete RCA object)
 */

class WorkItemState {
  constructor(name) { this.name = name; }
  transitionTo(targetState, context) {
    throw new Error(`Transition to ${targetState} is not allowed from ${this.name}`);
  }
  toString() { return this.name; }
}

class OpenState extends WorkItemState {
  constructor() { super('OPEN'); }
  transitionTo(targetState) {
    if (targetState === 'INVESTIGATING') return new InvestigatingState();
    throw new Error(`Cannot transition from OPEN to ${targetState}`);
  }
}

class InvestigatingState extends WorkItemState {
  constructor() { super('INVESTIGATING'); }
  transitionTo(targetState) {
    if (targetState === 'RESOLVED') return new ResolvedState();
    if (targetState === 'OPEN')     return new OpenState();   // allow re-open
    throw new Error(`Cannot transition from INVESTIGATING to ${targetState}`);
  }
}

class ResolvedState extends WorkItemState {
  constructor() { super('RESOLVED'); }
  transitionTo(targetState, context = {}) {
    if (targetState === 'CLOSED') {
      // ── Mandatory RCA guard ─────────────────────────────────────────────
      const rca = context.rca;
      if (!rca) {
        throw new Error('TRANSITION_BLOCKED: RCA object is required to close an incident');
      }
      const required = ['incident_start', 'incident_end', 'root_cause_category', 'fix_applied', 'prevention_steps'];
      const missing = required.filter(f => !rca[f] || String(rca[f]).trim() === '');
      if (missing.length > 0) {
        throw new Error(`TRANSITION_BLOCKED: RCA is incomplete. Missing fields: ${missing.join(', ')}`);
      }
      return new ClosedState();
    }
    if (targetState === 'INVESTIGATING') return new InvestigatingState(); // allow re-investigate
    throw new Error(`Cannot transition from RESOLVED to ${targetState}`);
  }
}

class ClosedState extends WorkItemState {
  constructor() { super('CLOSED'); }
  transitionTo(targetState) {
    throw new Error(`Work item is CLOSED. No further transitions allowed.`);
  }
}

// ── Factory: rehydrate state from a string (e.g. loaded from DB) ───────────
const stateFromString = (stateName) => {
  const map = {
    OPEN:          new OpenState(),
    INVESTIGATING: new InvestigatingState(),
    RESOLVED:      new ResolvedState(),
    CLOSED:        new ClosedState()
  };
  const state = map[stateName?.toUpperCase()];
  if (!state) throw new Error(`Unknown state: ${stateName}`);
  return state;
};

module.exports = { OpenState, InvestigatingState, ResolvedState, ClosedState, stateFromString };
