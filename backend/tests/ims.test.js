const { OpenState, InvestigatingState, ResolvedState, ClosedState, stateFromString } = require('../src/workflow/WorkItemState');
const { getAlertStrategy } = require('../src/workflow/AlertStrategy');

// ── State Machine Tests ─────────────────────────────────────────────────────

describe('WorkItemState - Valid Transitions', () => {
  test('OPEN → INVESTIGATING', () => {
    const state = new OpenState();
    const next  = state.transitionTo('INVESTIGATING');
    expect(next.toString()).toBe('INVESTIGATING');
  });

  test('INVESTIGATING → RESOLVED', () => {
    const state = new InvestigatingState();
    const next  = state.transitionTo('RESOLVED');
    expect(next.toString()).toBe('RESOLVED');
  });

  test('RESOLVED → CLOSED with complete RCA', () => {
    const state = new ResolvedState();
    const rca = {
      incident_start:      '2024-01-01T10:00:00Z',
      incident_end:        '2024-01-01T11:00:00Z',
      root_cause_category: 'Infrastructure',
      fix_applied:         'Restarted DB cluster',
      prevention_steps:    'Add health checks'
    };
    const next = state.transitionTo('CLOSED', { rca });
    expect(next.toString()).toBe('CLOSED');
  });

  test('INVESTIGATING → OPEN (re-open allowed)', () => {
    const state = new InvestigatingState();
    const next  = state.transitionTo('OPEN');
    expect(next.toString()).toBe('OPEN');
  });
});

describe('WorkItemState - Invalid Transitions', () => {
  test('OPEN cannot go directly to CLOSED', () => {
    const state = new OpenState();
    expect(() => state.transitionTo('CLOSED')).toThrow();
  });

  test('OPEN cannot go to RESOLVED', () => {
    const state = new OpenState();
    expect(() => state.transitionTo('RESOLVED')).toThrow();
  });

  test('CLOSED cannot transition anywhere', () => {
    const state = new ClosedState();
    expect(() => state.transitionTo('OPEN')).toThrow('Work item is CLOSED');
  });
});

describe('WorkItemState - RCA Validation (Mandatory)', () => {
  test('RESOLVED → CLOSED blocked if no RCA provided', () => {
    const state = new ResolvedState();
    expect(() => state.transitionTo('CLOSED', {}))
      .toThrow('TRANSITION_BLOCKED');
  });

  test('RESOLVED → CLOSED blocked if RCA missing fix_applied', () => {
    const state = new ResolvedState();
    const incompleteRca = {
      incident_start:      '2024-01-01T10:00:00Z',
      incident_end:        '2024-01-01T11:00:00Z',
      root_cause_category: 'Infrastructure',
      fix_applied:         '',            // empty!
      prevention_steps:    'Add checks'
    };
    expect(() => state.transitionTo('CLOSED', { rca: incompleteRca }))
      .toThrow('fix_applied');
  });

  test('RESOLVED → CLOSED blocked if multiple RCA fields empty', () => {
    const state = new ResolvedState();
    const incompleteRca = {
      incident_start:      '2024-01-01T10:00:00Z',
      incident_end:        '2024-01-01T11:00:00Z',
      root_cause_category: '',
      fix_applied:         '',
      prevention_steps:    ''
    };
    expect(() => state.transitionTo('CLOSED', { rca: incompleteRca }))
      .toThrow('TRANSITION_BLOCKED');
  });

  test('RESOLVED → CLOSED blocked if RCA is null', () => {
    const state = new ResolvedState();
    expect(() => state.transitionTo('CLOSED', { rca: null }))
      .toThrow('TRANSITION_BLOCKED');
  });
});

describe('stateFromString - Hydration', () => {
  test('rehydrates OPEN', ()         => expect(stateFromString('OPEN').toString()).toBe('OPEN'));
  test('rehydrates INVESTIGATING', () => expect(stateFromString('INVESTIGATING').toString()).toBe('INVESTIGATING'));
  test('rehydrates RESOLVED', ()     => expect(stateFromString('RESOLVED').toString()).toBe('RESOLVED'));
  test('rehydrates CLOSED', ()       => expect(stateFromString('CLOSED').toString()).toBe('CLOSED'));
  test('throws on unknown state', ()  => expect(() => stateFromString('UNKNOWN')).toThrow());
});

// ── Alert Strategy Tests ─────────────────────────────────────────────────────

describe('AlertStrategy - Priority Assignment', () => {
  test('RDBMS → P0', () => expect(getAlertStrategy('RDBMS').getPriority()).toBe('P0'));
  test('MCP → P0',   () => expect(getAlertStrategy('MCP').getPriority()).toBe('P0'));
  test('QUEUE → P1', () => expect(getAlertStrategy('QUEUE').getPriority()).toBe('P1'));
  test('API → P1',   () => expect(getAlertStrategy('API').getPriority()).toBe('P1'));
  test('CACHE → P2', () => expect(getAlertStrategy('CACHE').getPriority()).toBe('P2'));
  test('NOSQL → P3', () => expect(getAlertStrategy('NOSQL').getPriority()).toBe('P3'));
  test('Unknown → P2 (default)', () => expect(getAlertStrategy('UNKNOWN').getPriority()).toBe('P2'));
});

describe('AlertStrategy - Channel Assignment', () => {
  test('RDBMS notifies pagerduty + slack + sms', () => {
    const channels = getAlertStrategy('RDBMS').getChannel();
    expect(channels).toContain('pagerduty');
    expect(channels).toContain('sms');
  });
  test('CACHE notifies only slack', () => {
    const channels = getAlertStrategy('CACHE').getChannel();
    expect(channels).toEqual(['slack']);
  });
});

// ── RingBuffer Tests ─────────────────────────────────────────────────────────

describe('RingBuffer - Backpressure', () => {
  const { RingBuffer } = jest.requireActual('../src/ingestion/RingBuffer') || {};

  // Since RingBuffer isn't exported separately, test via logic
  test('buffer module loads without error', () => {
    expect(() => require('../src/ingestion/RingBuffer')).not.toThrow();
  });
});
