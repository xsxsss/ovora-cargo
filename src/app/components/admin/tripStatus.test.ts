import { describe, expect, it } from 'vitest';
import { isLiveTrip, offerStatusBreakdown, tripStatusBreakdown, tripStatusKey } from './tripStatus';

describe('tripStatusKey', () => {
  it('maps current statuses', () => {
    expect(tripStatusKey({ status: 'planned' })).toBe('planned');
    expect(tripStatusKey({ status: 'inProgress' })).toBe('inProgress');
    expect(tripStatusKey({ status: 'frozen' })).toBe('frozen');
    expect(tripStatusKey({ status: 'completed' })).toBe('completed');
    expect(tripStatusKey({ status: 'cancelled' })).toBe('cancelled');
  });

  it('treats legacy active/scheduled and missing status as planned', () => {
    expect(tripStatusKey({ status: 'active' })).toBe('planned');
    expect(tripStatusKey({ status: 'scheduled' })).toBe('planned');
    expect(tripStatusKey({})).toBe('planned');
  });

  it('soft-deleted trip is cancelled whatever its status', () => {
    expect(tripStatusKey({ status: 'inProgress', deletedAt: '2026-09-14T00:00:00Z' })).toBe('cancelled');
  });
});

describe('isLiveTrip', () => {
  it('is true only before completion or cancellation', () => {
    expect(isLiveTrip({ status: 'planned' })).toBe(true);
    expect(isLiveTrip({ status: 'frozen' })).toBe(true);
    expect(isLiveTrip({ status: 'completed' })).toBe(false);
    expect(isLiveTrip({ status: 'planned', deletedAt: 'x' })).toBe(false);
  });
});

describe('breakdowns', () => {
  it('counts trips per status and drops empty buckets', () => {
    const data = tripStatusBreakdown([{ status: 'planned' }, { status: 'active' }, { status: 'completed' }, null]);
    expect(data).toEqual([
      { name: 'Запланированы', value: 2, color: '#f59e0b' },
      { name: 'Завершены', value: 1, color: '#10b981' },
    ]);
  });

  it('counts declined and rejected offers together', () => {
    const data = offerStatusBreakdown([{ status: 'declined' }, { status: 'rejected' }, { status: 'cancelled' }]);
    expect(data.find(d => d.name === 'Отклонены')?.value).toBe(2);
    expect(data.find(d => d.name === 'Отменены')?.value).toBe(1);
  });
});
