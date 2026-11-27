// Generated from contracts/practice/score/artifact.schema.json. Do not edit.
export const PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION = 1 as const;
export const MAX_JSON_SAFE_INTEGER = 9007199254740991 as const;
export const PRACTICE_PIANO_KEY_MIN = 21 as const;
export const PRACTICE_PIANO_KEY_MAX = 108 as const;
export type MeterSegment = {
  denominator: number;
  numerator: number;
  startTick: number;
};
export type PracticeAttack = {
  attackId: string;
  noteIds: (string)[];
  pianoKey: number;
};
export type PracticeMoment = {
  attacks: (PracticeAttack)[];
  canonicalEndTick: number;
  continuationNoteIds: (string)[];
  groupId: string;
  onsetTick: number;
};
export type PracticeScoreEvent = {
  durationTicks: number;
  eventId: string;
  onsetTick: number;
};
export type PracticeScoreNote = {
  eventId: string;
  measureNumber: string;
  noteId: string;
  pianoKey: number;
  renderNoteId: string;
  staffId: string;
  tieTypes: ("start" | "stop")[];
  voiceId: string;
};
export type TempoSegment = {
  bpm: number;
  startTick: number;
};
export type PracticeScoreArtifact = {
  artifactId: string;
  events: (PracticeScoreEvent)[];
  meterSegments: (MeterSegment)[];
  moments: (PracticeMoment)[];
  notes: (PracticeScoreNote)[];
  schemaVersion: 1;
  scoreEndTick: number;
  scoreTempoSegments: (TempoSegment)[];
  ticksPerQuarter: number;
};
const schema = {
  "$defs": {
    "Identity": {
      "minLength": 1,
      "type": "string"
    },
    "MeterSegment": {
      "additionalProperties": false,
      "properties": {
        "denominator": {
          "$ref": "#/$defs/TicksPerQuarter"
        },
        "numerator": {
          "$ref": "#/$defs/TicksPerQuarter"
        },
        "startTick": {
          "$ref": "#/$defs/ScoreTick"
        }
      },
      "required": [
        "startTick",
        "numerator",
        "denominator"
      ],
      "title": "PracticeScoreMeterSegmentRead",
      "type": "object"
    },
    "PracticeAttack": {
      "additionalProperties": false,
      "properties": {
        "attackId": {
          "$ref": "#/$defs/Identity"
        },
        "noteIds": {
          "items": {
            "$ref": "#/$defs/Identity"
          },
          "minItems": 1,
          "type": "array"
        },
        "pianoKey": {
          "$ref": "#/$defs/PracticePianoKey"
        }
      },
      "required": [
        "attackId",
        "pianoKey",
        "noteIds"
      ],
      "title": "PracticeScoreAttackRead",
      "type": "object"
    },
    "PracticeMoment": {
      "additionalProperties": false,
      "properties": {
        "attacks": {
          "items": {
            "$ref": "#/$defs/PracticeAttack"
          },
          "minItems": 1,
          "type": "array"
        },
        "canonicalEndTick": {
          "$ref": "#/$defs/ScoreTick"
        },
        "continuationNoteIds": {
          "items": {
            "$ref": "#/$defs/Identity"
          },
          "type": "array"
        },
        "groupId": {
          "$ref": "#/$defs/Identity"
        },
        "onsetTick": {
          "$ref": "#/$defs/ScoreTick"
        }
      },
      "required": [
        "groupId",
        "onsetTick",
        "canonicalEndTick",
        "attacks",
        "continuationNoteIds"
      ],
      "title": "PracticeScoreMomentRead",
      "type": "object"
    },
    "PracticePianoKey": {
      "maximum": 108,
      "minimum": 21,
      "type": "integer"
    },
    "PracticeScoreEvent": {
      "additionalProperties": false,
      "properties": {
        "durationTicks": {
          "$ref": "#/$defs/ScoreTick"
        },
        "eventId": {
          "$ref": "#/$defs/Identity"
        },
        "onsetTick": {
          "$ref": "#/$defs/ScoreTick"
        }
      },
      "required": [
        "eventId",
        "onsetTick",
        "durationTicks"
      ],
      "title": "PracticeScoreEventRead",
      "type": "object"
    },
    "PracticeScoreNote": {
      "additionalProperties": false,
      "properties": {
        "eventId": {
          "$ref": "#/$defs/Identity"
        },
        "measureNumber": {
          "type": "string"
        },
        "noteId": {
          "$ref": "#/$defs/Identity"
        },
        "pianoKey": {
          "$ref": "#/$defs/PracticePianoKey"
        },
        "renderNoteId": {
          "$ref": "#/$defs/Identity"
        },
        "staffId": {
          "type": "string"
        },
        "tieTypes": {
          "items": {
            "enum": [
              "start",
              "stop"
            ],
            "type": "string"
          },
          "type": "array",
          "uniqueItems": true
        },
        "voiceId": {
          "type": "string"
        }
      },
      "required": [
        "noteId",
        "eventId",
        "pianoKey",
        "renderNoteId",
        "measureNumber",
        "staffId",
        "voiceId",
        "tieTypes"
      ],
      "title": "PracticeScoreNoteRead",
      "type": "object"
    },
    "ScoreTick": {
      "maximum": 9007199254740991,
      "minimum": 0,
      "type": "integer"
    },
    "TempoSegment": {
      "additionalProperties": false,
      "properties": {
        "bpm": {
          "exclusiveMinimum": 0,
          "type": "number"
        },
        "startTick": {
          "$ref": "#/$defs/ScoreTick"
        }
      },
      "required": [
        "startTick",
        "bpm"
      ],
      "title": "PracticeScoreTempoSegmentRead",
      "type": "object"
    },
    "TicksPerQuarter": {
      "$ref": "#/$defs/ScoreTick",
      "minimum": 1
    }
  },
  "$id": "https://noteverse.app/contracts/practice/score/artifact.schema.json",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "additionalProperties": false,
  "properties": {
    "artifactId": {
      "maxLength": 40,
      "minLength": 40,
      "pattern": "^practice-score-artifact:[0-9a-f]{16}$",
      "type": "string"
    },
    "events": {
      "items": {
        "$ref": "#/$defs/PracticeScoreEvent"
      },
      "minItems": 1,
      "type": "array"
    },
    "meterSegments": {
      "items": {
        "$ref": "#/$defs/MeterSegment"
      },
      "minItems": 1,
      "type": "array"
    },
    "moments": {
      "items": {
        "$ref": "#/$defs/PracticeMoment"
      },
      "minItems": 1,
      "type": "array"
    },
    "notes": {
      "items": {
        "$ref": "#/$defs/PracticeScoreNote"
      },
      "minItems": 1,
      "type": "array"
    },
    "schemaVersion": {
      "const": 1,
      "type": "integer"
    },
    "scoreEndTick": {
      "$ref": "#/$defs/ScoreTick"
    },
    "scoreTempoSegments": {
      "items": {
        "$ref": "#/$defs/TempoSegment"
      },
      "type": "array"
    },
    "ticksPerQuarter": {
      "$ref": "#/$defs/TicksPerQuarter"
    }
  },
  "required": [
    "schemaVersion",
    "artifactId",
    "notes",
    "events",
    "moments",
    "meterSegments",
    "scoreTempoSegments",
    "ticksPerQuarter",
    "scoreEndTick"
  ],
  "title": "PracticeScoreArtifactRead",
  "type": "object"
} as const;

type SchemaNode = {
  $ref?: string; type?: string; const?: unknown; enum?: readonly unknown[];
  properties?: Readonly<Record<string, SchemaNode>>; required?: readonly string[];
  additionalProperties?: boolean; items?: SchemaNode; minItems?: number; uniqueItems?: boolean;
  minimum?: number; maximum?: number; exclusiveMinimum?: number;
  minLength?: number; maxLength?: number; pattern?: string;
};
export class PracticeScoreStructureError extends Error {
  readonly code = 'practice_score_invalid';
}
function reject(path: string): never {
  throw new PracticeScoreStructureError(`Invalid PracticeScoreArtifact structure at ${path}`);
}
function validate(node: SchemaNode, value: unknown, path: string): void {
  if (node.$ref) {
    const name = node.$ref.slice('#/$defs/'.length);
    const definitions: Readonly<Record<string, SchemaNode>> = schema.$defs;
    const { $ref: reference, ...constraints } = node;
    void reference;
    validate({ ...definitions[name], ...constraints }, value, path);
    return;
  }
  if ('const' in node && value !== node.const) reject(path);
  if (node.enum && !node.enum.includes(value)) reject(path);
  switch (node.type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) reject(path);
      const row = value as Record<string, unknown>, properties = node.properties!;
      if (node.required!.some(key => !Object.hasOwn(row, key)) || Object.keys(row).some(key => !Object.hasOwn(properties, key))) reject(path);
      for (const [key, child] of Object.entries(properties)) validate(child, row[key], `${path}.${key}`);
      break;
    }
    case 'array':
      if (!Array.isArray(value) || value.length < (node.minItems ?? 0)) reject(path);
      for (let i = 0; i < value.length; i++) {
        if (!Object.hasOwn(value, i)) reject(path);
        validate(node.items!, value[i], `${path}[${i}]`);
      }
      if (node.uniqueItems && new Set(value).size !== value.length) reject(path);
      break;
    case 'string':
      if (typeof value !== 'string' || [...value].length < (node.minLength ?? 0) ||
          node.maxLength !== undefined && [...value].length > node.maxLength ||
          node.pattern !== undefined && !new RegExp(node.pattern).test(value)) reject(path);
      break;
    case 'integer':
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value) ||
          node.type === 'integer' && !Number.isSafeInteger(value) ||
          node.minimum !== undefined && value < node.minimum ||
          node.maximum !== undefined && value > node.maximum ||
          node.exclusiveMinimum !== undefined && value <= node.exclusiveMinimum) reject(path);
      break;
  }
}
/** Structural admission only; preserves the exact caller object without repair or freezing. */
export function decodePracticeScoreArtifact(value: unknown): PracticeScoreArtifact {
  validate(schema, value, '$');
  return value as PracticeScoreArtifact;
}
