import type { EventId, NotationId, TieId } from './model';

export type StemDirectionOverride = 'up' | 'down' | 'none' | 'double';
export type NotationPlacementOverride = 'above' | 'below';

export type EventNotationControl = {
  readonly kind: 'eventNotation';
  readonly eventId: EventId;
  /**
   * Missing means automatic engraving. A present value is an explicit
   * MusicXML-compatible override, including `none` for a no-stem note.
   */
  readonly stemDirection?: StemDirectionOverride;
};

export type TieNotationControl = {
  readonly kind: 'tieNotation';
  readonly tieId: TieId;
  /** Missing means automatic engraving placement. */
  readonly placement?: NotationPlacementOverride;
};

export type SlurNotationControl = {
  readonly kind: 'slurNotation';
  readonly notationId: NotationId;
  /** Missing means automatic engraving placement. */
  readonly placement?: NotationPlacementOverride;
};

export type BeamNotationControl = {
  readonly kind: 'beamNotation';
  readonly notationId: NotationId;
  readonly eventIds: readonly [EventId, ...EventId[]];
  /** Missing means automatic beam/stem placement. */
  readonly direction?: Extract<StemDirectionOverride, 'up' | 'down'>;
};

export type NotationControl =
  | EventNotationControl
  | TieNotationControl
  | SlurNotationControl
  | BeamNotationControl;

export function getEventNotationControl(
  controls: readonly NotationControl[],
  eventId: EventId,
): EventNotationControl | undefined {
  return controls.find((control): control is EventNotationControl => (
    control.kind === 'eventNotation' && control.eventId === eventId
  ));
}

export function getEventStemDirectionOverride(
  controls: readonly NotationControl[],
  eventId: EventId,
): StemDirectionOverride | undefined {
  return getEventNotationControl(controls, eventId)?.stemDirection;
}
