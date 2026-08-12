/**
 * MusicXML Backup Operations
 *
 * Normalizes MusicXML `backup` elements after timeline edits.
 *
 * @module lib/musicxml-backup
 */

// ============================================================================
// Internal Functions
// ============================================================================

function getTimelineDuration(element: Element): number {
    const nodeName = element.nodeName.toLowerCase();
    if (nodeName === 'note' && element.querySelector('chord')) return 0;
    if (nodeName !== 'note' && nodeName !== 'forward') return 0;

    const durationEl = element.querySelector('duration');
    return durationEl ? parseInt(durationEl.textContent || '0', 10) : 0;
}

/**
 * Collapses a consecutive `backup` sequence to the final element and updates
 * its duration to the timeline position before the sequence started.
 */
function processConsecutiveBackups(
    backups: { element: Element; timeAtStart: number }[]
): void {
    if (backups.length <= 1) return;

    const correctDuration = backups[0].timeAtStart;
    const lastBackup = backups[backups.length - 1];

    for (let i = 0; i < backups.length - 1; i++) {
        backups[i].element.parentNode?.removeChild(backups[i].element);
    }

    const durationEl = lastBackup.element.querySelector('duration');
    if (durationEl) {
        if (correctDuration > 0) {
            durationEl.textContent = String(correctDuration);
        } else {
            lastBackup.element.parentNode?.removeChild(lastBackup.element);
        }
    }
}

/**
 * Merges adjacent `backup` elements when no `note` or `forward` appears
 * between them. Only the final `backup` remains, with a duration equal to the
 * cumulative timeline position where the sequence began.
 */
function mergeConsecutiveBackups(measureEl: Element): void {
    const elements = Array.from(measureEl.children);
    let cumulativeTime = 0;
    let backupsInSequence: { element: Element; timeAtStart: number }[] = [];

    for (const el of elements) {
        const nodeName = el.nodeName.toLowerCase();

        if (nodeName === 'note' || nodeName === 'forward') {
            if (backupsInSequence.length > 1) {
                processConsecutiveBackups(backupsInSequence);
            }
            backupsInSequence = [];

            cumulativeTime += getTimelineDuration(el);

        } else if (nodeName === 'backup') {
            backupsInSequence.push({ element: el, timeAtStart: cumulativeTime });

            const durEl = el.querySelector('duration');
            cumulativeTime -= durEl ? parseInt(durEl.textContent || '0', 10) : 0;
        }
    }

    if (backupsInSequence.length > 1) {
        processConsecutiveBackups(backupsInSequence);
    }
}

// ============================================================================
// Exported Functions
// ============================================================================

/**
 * Recalculates every `backup` duration in a measure after inserting or deleting
 * notes.
 *
 * The function walks the measure in document order, tracks cumulative timeline
 * duration, writes each `backup` duration to the current timeline position so
 * the cursor returns to zero, and removes backups whose calculated duration is
 * zero or negative.
 *
 * @param measureEl Measure element to normalize.
 */
export function recalculateBackups(measureEl: Element): void {
    // Merge consecutive backups first so recalculation does not preserve redundant elements.
    mergeConsecutiveBackups(measureEl);

    // Recalculate each remaining backup duration.
    const elements = Array.from(measureEl.children);
    let cumulativeTime = 0;
    const backupsToRemove: Element[] = [];

    for (const el of elements) {
        const nodeName = el.nodeName.toLowerCase();

        if (nodeName === 'note' || nodeName === 'forward') {
            cumulativeTime += getTimelineDuration(el);

        } else if (nodeName === 'backup') {
            const durEl = el.querySelector('duration');

            if (cumulativeTime > 0) {
                if (durEl) {
                    durEl.textContent = String(cumulativeTime);
                }
                cumulativeTime = 0;
            } else {
                backupsToRemove.push(el);
            }
        }
    }

    backupsToRemove.forEach(el => {
        el.parentNode?.removeChild(el);
    });
}
