import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import fixtures from '../../../../tests/fixtures/performance/canonical-plans.json';
import {
  linearPlan,
  rational,
} from '../../../../tests/support/performance-plan';
import { decodePerformancePlan } from './plan';
import { Rational } from './rational';
import {
  createScorePerformanceTimeline,
  projectScorePerformanceTimeline,
} from './timeline';

const r = (q: number) => new Rational(BigInt(q));
const note = (start: number, end: number, identity = String(start)) =>
  Object.freeze({
    identity,
    sourceTrackIdentity: 0,
    writtenStart: r(start),
    writtenEnd: r(end),
    midi: 48 + Math.floor(start / 4) * 5 + (start % 4),
    velocity: 0.8,
    instrument: 'acoustic_grand_piano',
  });

describe('canonical note and cursor traversal', () => {
  it.each(fixtures)(
    '$name follows canonical written pitches and exact end',
    ({ plan: dto, path }) => {
      const written = Array.from({ length: 20 }, (_, q) => note(q, q + 1));
      const visual = written.map((n) => ({
        position: n.writtenStart,
        noteIds: [`written-${n.identity}`],
      }));
      const plan = decodePerformancePlan(dto);
      const timeline = projectScorePerformanceTimeline(plan, written, visual);
      expect(timeline.notes.map((n) => n.midi)).toEqual(
        path.map((q) => note(q, q + 1).midi)
      );
      expect(timeline.notes.map((n) => n.performanceStart)).toEqual(
        path.map((_, i) => r(i))
      );
      expect(timeline.notes.map((n) => n.time)).toEqual(
        path.map((_, i) => i * 0.75)
      );
      expect(timeline.duration).toBe(path.length * 0.75);
      expect(timeline.visualEvents.map((e) => e.noteIds)).toEqual(
        path.map((q) => [`written-${q}`])
      );
      expect(timeline.visualEvents.map((e) => e.time)).toEqual(
        path.map((_, i) => i * 0.75)
      );
      expect(timeline.notes.at(-1)!.performanceEnd).toEqual(
        plan.performanceEnd
      );
      expect(new Set(timeline.notes.map((n) => n.identity)).size).toBe(
        path.length
      );
    }
  );

  it('cuts an active source note exactly and excludes later onsets', () => {
    const plan = decodePerformancePlan(
      fixtures.find((f) => f.name === 'dc-fine')!.plan
    );
    const timeline = projectScorePerformanceTimeline(
      plan,
      [note(12, 16), note(14, 15), note(15, 16)],
      []
    );
    expect(
      timeline.notes.map((n) => [n.performanceStart, n.performanceEnd])
    ).toEqual([[r(12), r(14)]]);
    expect(timeline.notes[0].duration).toBe(1.5);
  });

  it('does not retrigger an onset before a partial destination, but replays an exact-entry onset', () => {
    const plan = decodePerformancePlan(
      fixtures.find((f) => f.name === 'ds-fine')!.plan
    );
    const timeline = projectScorePerformanceTimeline(
      plan,
      [note(4, 7), note(5, 6)],
      [
        { position: r(4), noteIds: ['before'] },
        { position: r(5), noteIds: ['entry'] },
      ]
    );
    expect(timeline.notes.map((n) => n.performanceStart)).toEqual([
      r(4),
      r(5),
      r(15),
    ]);
    expect(
      timeline.visualEvents.map((e) => [e.performancePosition, e.noteIds])
    ).toEqual([
      [r(4), ['before']],
      [r(5), ['entry']],
      [r(15), ['entry']],
    ]);
  });

  it('continues a long note across ordinary measure boundaries and cuts at a repeat', () => {
    const linear = decodePerformancePlan(
      fixtures.find((f) => f.name === 'linear')!.plan
    );
    expect(
      projectScorePerformanceTimeline(linear, [note(2, 6)], []).notes[0]
        .duration
    ).toBe(3);
    const repeat = decodePerformancePlan(
      fixtures.find((f) => f.name === 'repeat')!.plan
    );
    expect(
      projectScorePerformanceTimeline(repeat, [note(6, 10)], []).notes.map(
        (n) => [n.performanceStart, n.performanceEnd]
      )
    ).toEqual([
      [r(6), r(8)],
      [r(14), r(16)],
    ]);
  });

  it('merges simultaneous cursor IDs stably and retains independent same-pitch audio tracks', () => {
    const plan = decodePerformancePlan(linearPlan());
    const timeline = projectScorePerformanceTimeline(
      plan,
      [
        note(1, 2),
        {
          ...note(1, 2),
          identity: 'other',
          sourceTrackIdentity: 1,
          instrument: 'violin',
        },
      ],
      [
        { position: r(1), noteIds: ['b', 'a', 'b'] },
        { position: r(1), noteIds: ['a', 'c'] },
      ]
    );
    expect(
      timeline.notes.map((n) => [n.sourceTrackIdentity, n.instrument])
    ).toEqual([
      [0, 'acoustic_grand_piano'],
      [1, 'violin'],
    ]);
    expect(timeline.visualEvents[0].noteIds).toEqual(['b', 'a', 'c']);
  });

  it('does not duplicate onset facts at a necessary zero-duration visit', () => {
    const dto = linearPlan();
    dto.occurrences.unshift({
      ...dto.occurrences[0],
      written_end: rational(0),
      performance_end: rational(0),
    });
    dto.occurrences[1] = { ...dto.occurrences[1], ordinal: 1, visit: 2 };
    const timeline = projectScorePerformanceTimeline(
      decodePerformancePlan(dto),
      [note(0, 1)],
      [{ position: r(0), noteIds: ['same'] }]
    );
    expect(timeline.notes).toHaveLength(1);
    expect(timeline.visualEvents).toHaveLength(1);
  });

  it('ignores MIDI conductor and renderer millisecond fields, and retains plan silence at end', () => {
    const midi = new Midi();
    midi.header.setTempo(999);
    midi.addTrack().addNote({
      midi: 60,
      ticks: 0,
      durationTicks: midi.header.ppq,
      velocity: 0.8,
    });
    const bytes = btoa(String.fromCharCode(...midi.toArray()));
    const timeline = createScorePerformanceTimeline(
      decodePerformancePlan(linearPlan(8)),
      bytes,
      [{ qstamp: 0, on: ['written'], tstamp: 999999, tempo: 999 }]
    );
    expect(timeline.notes[0].duration).toBe(0.75);
    expect(timeline.referenceTempoBpm).toBe(80);
    expect(timeline.visualEvents[0].time).toBe(0);
    expect(timeline.duration).toBe(6);
  });
});
