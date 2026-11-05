import type { PracticeScoreArtifact } from '@/lib/practice/score/artifact';
import { artifactWithKeys } from './piano-key-artifact';
const leadingRestArtifact: PracticeScoreArtifact = artifactWithKeys([[60]]);
leadingRestArtifact.events[0].onsetTick = 2;
leadingRestArtifact.moments[0].groupId = 'g-rest-1';
leadingRestArtifact.moments[0].onsetTick = 2;
leadingRestArtifact.moments[0].canonicalEndTick = 3;

leadingRestArtifact.scoreEndTick = 3;
leadingRestArtifact.meterSegments = [{ startTick: 0, numerator: 4, denominator: 4,   }];
leadingRestArtifact.scoreTempoSegments = [{ startTick: 0, bpm: 80 }, { startTick: 2, bpm: 100 }];
export { leadingRestArtifact };
