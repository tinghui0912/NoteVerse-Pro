// Generated from contracts/realtime/events.schema.json. Do not edit.

export type RealtimeCheckpoint = {
  schemaVersion: 1;
  sequence: number;
};

export type RealtimeResyncRequired = {
  schemaVersion: 1;
  sequence: number;
  reason: "retention_gap" | "cursor_out_of_range" | "invalid_cursor";
};

type NotificationsChanged = {
  schemaVersion: 1;
  sequence: number;
  changeId: string;
  createdAt: string;
  kind: "notifications.changed";
  notificationId: string | null;
};

type ScoreRevisionsChanged = {
  schemaVersion: 1;
  sequence: number;
  changeId: string;
  createdAt: string;
  kind: "score.revisions.changed";
  scoreId: string;
  revisionId: string;
};

type ScoreDerivedAssetsChanged = {
  schemaVersion: 1;
  sequence: number;
  changeId: string;
  createdAt: string;
  kind: "score.derived_assets.changed";
  scoreId: string;
  revisionId: string;
};

type ScoreMetadataChanged = {
  schemaVersion: 1;
  sequence: number;
  changeId: string;
  createdAt: string;
  kind: "score.metadata.changed";
  scoreId: string;
  revisionId: string;
};

type ImportJobsChanged = {
  schemaVersion: 1;
  sequence: number;
  changeId: string;
  createdAt: string;
  kind: "import_jobs.changed";
  importJobId: string;
};

export type RealtimeChange = NotificationsChanged | ScoreRevisionsChanged | ScoreDerivedAssetsChanged | ScoreMetadataChanged | ImportJobsChanged;

const definitions = {
  "RealtimeCheckpoint": {
    "properties": {
      "schemaVersion": {
        "type": "integer",
        "const": 1
      },
      "sequence": {
        "type": "integer",
        "minimum": 0,
        "maximum": 9007199254740991
      }
    }
  },
  "RealtimeResyncRequired": {
    "properties": {
      "schemaVersion": {
        "type": "integer",
        "const": 1
      },
      "sequence": {
        "type": "integer",
        "minimum": 0,
        "maximum": 9007199254740991
      },
      "reason": {
        "type": "string",
        "enum": [
          "retention_gap",
          "cursor_out_of_range",
          "invalid_cursor"
        ]
      }
    }
  },
  "NotificationsChanged": {
    "properties": {
      "schemaVersion": {
        "type": "integer",
        "const": 1
      },
      "sequence": {
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740991
      },
      "changeId": {
        "type": "string",
        "minLength": 1
      },
      "createdAt": {
        "type": "string",
        "format": "date-time",
        "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:[Zz]|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$"
      },
      "kind": {
        "type": "string",
        "const": "notifications.changed"
      },
      "notificationId": {
        "type": [
          "string",
          "null"
        ]
      }
    }
  },
  "ScoreRevisionsChanged": {
    "properties": {
      "schemaVersion": {
        "type": "integer",
        "const": 1
      },
      "sequence": {
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740991
      },
      "changeId": {
        "type": "string",
        "minLength": 1
      },
      "createdAt": {
        "type": "string",
        "format": "date-time",
        "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:[Zz]|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$"
      },
      "kind": {
        "type": "string",
        "const": "score.revisions.changed"
      },
      "scoreId": {
        "type": "string",
        "minLength": 1
      },
      "revisionId": {
        "type": "string",
        "minLength": 1
      }
    }
  },
  "ScoreDerivedAssetsChanged": {
    "properties": {
      "schemaVersion": {
        "type": "integer",
        "const": 1
      },
      "sequence": {
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740991
      },
      "changeId": {
        "type": "string",
        "minLength": 1
      },
      "createdAt": {
        "type": "string",
        "format": "date-time",
        "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:[Zz]|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$"
      },
      "kind": {
        "type": "string",
        "const": "score.derived_assets.changed"
      },
      "scoreId": {
        "type": "string",
        "minLength": 1
      },
      "revisionId": {
        "type": "string",
        "minLength": 1
      }
    }
  },
  "ScoreMetadataChanged": {
    "properties": {
      "schemaVersion": {
        "type": "integer",
        "const": 1
      },
      "sequence": {
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740991
      },
      "changeId": {
        "type": "string",
        "minLength": 1
      },
      "createdAt": {
        "type": "string",
        "format": "date-time",
        "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:[Zz]|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$"
      },
      "kind": {
        "type": "string",
        "const": "score.metadata.changed"
      },
      "scoreId": {
        "type": "string",
        "minLength": 1
      },
      "revisionId": {
        "type": "string",
        "minLength": 1
      }
    }
  },
  "ImportJobsChanged": {
    "properties": {
      "schemaVersion": {
        "type": "integer",
        "const": 1
      },
      "sequence": {
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740991
      },
      "changeId": {
        "type": "string",
        "minLength": 1
      },
      "createdAt": {
        "type": "string",
        "format": "date-time",
        "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:[Zz]|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$"
      },
      "kind": {
        "type": "string",
        "const": "import_jobs.changed"
      },
      "importJobId": {
        "type": "string",
        "minLength": 1
      }
    }
  }
} as const;


type Rule = { type: string | readonly string[]; const?: string | number; enum?: readonly string[]; minimum?: number; maximum?: number; minLength?: number; format?: string; pattern?: string };
function matches(value: unknown, rule: Rule): boolean {
  if (value === null) return Array.isArray(rule.type) && rule.type.includes('null');
  if (rule.const !== undefined && value !== rule.const) return false;
  if (rule.type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value) && value >= (rule.minimum ?? -Infinity) && value <= (rule.maximum ?? Infinity);
  if (typeof value !== 'string' || value.length < (rule.minLength ?? 0)) return false;
  if (rule.enum && !rule.enum.includes(value)) return false;
  if (rule.pattern && !new RegExp(rule.pattern).test(value)) return false;
  if (rule.format === 'date-time') {
    if (!Number.isFinite(Date.parse(value))) return false;
    const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-Tt:]/).map(Number);
    const date = new Date(0); date.setUTCFullYear(year, month - 1, day);
    if (year < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return false;
  }
  return true;
}
function decode(data: string, names: readonly (keyof typeof definitions)[]): unknown {
  try {
    const value: unknown = JSON.parse(data);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const object = value as Record<string, unknown>;
    for (const name of names) {
      const properties = definitions[name].properties;
      if (Object.keys(object).length !== Object.keys(properties).length) continue;
      if (Object.entries(properties).every(([key, rule]) => Object.hasOwn(object, key) && matches(object[key], rule))) return object;
    }
    return null;
  } catch { return null; }
}

export function parseRealtimeCheckpoint(data: string): RealtimeCheckpoint | null {
  return decode(data, ['RealtimeCheckpoint']) as RealtimeCheckpoint | null;
}

export function parseRealtimeResyncRequired(data: string): RealtimeResyncRequired | null {
  return decode(data, ['RealtimeResyncRequired']) as RealtimeResyncRequired | null;
}

export function parseRealtimeChange(data: string): RealtimeChange | null {
  return decode(data, ["NotificationsChanged", "ScoreRevisionsChanged", "ScoreDerivedAssetsChanged", "ScoreMetadataChanged", "ImportJobsChanged"]) as RealtimeChange | null;
}
