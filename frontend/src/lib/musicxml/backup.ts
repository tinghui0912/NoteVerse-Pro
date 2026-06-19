/**
 * MusicXML Backup Operations
 * 
 * Backup 元素规范化函数
 * 
 * @module lib/musicxml-backup
 */

// ============================================================================
// Internal Functions
// ============================================================================

/**
 * 处理连续的 backup 序列：保留最后一个，删除其他，更新 duration
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
 * 合并连续的 backup 元素
 * 
 * 规则：如果两个或多个 backup 元素连续出现（中间没有 note 或 forward），
 * 则保留最后一个 backup，将其 duration 设置为第一个 backup 开始时的累计时间。
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

            const durEl = el.querySelector('duration');
            cumulativeTime += durEl ? parseInt(durEl.textContent || '0', 10) : 0;

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
 * 重新计算小节中所有 backup 元素的 duration
 * 
 * 当插入或删除音符后，backup 的 duration 可能不再正确。此函数会：
 * 1. 遍历 measure 中的所有元素
 * 2. 跟踪累计时间
 * 3. 为每个 backup 计算正确的 duration（= 当前累计时间，使时间线回到 0）
 * 4. 如果计算出的 duration 为 0 或负数，删除该 backup
 * 
 * @param measureEl 需要重新计算的 measure 元素
 */
export function recalculateBackups(measureEl: Element): void {
    // 首先合并连续的 backup（避免处理冗余元素）
    mergeConsecutiveBackups(measureEl);

    // 然后重新计算每个 backup 的 duration
    const elements = Array.from(measureEl.children);
    let cumulativeTime = 0;
    const backupsToRemove: Element[] = [];

    for (const el of elements) {
        const nodeName = el.nodeName.toLowerCase();

        if (nodeName === 'note' || nodeName === 'forward') {
            const durEl = el.querySelector('duration');
            cumulativeTime += durEl ? parseInt(durEl.textContent || '0', 10) : 0;

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
