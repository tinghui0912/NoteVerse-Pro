
'use client';

/**
 * 元数据编辑 Hook - 管理乐谱元数据
 * 
 * 所有更新函数同时更新结构元数据和 <credit> 显示元素，
 * credit 属性精确对齐 MuseScore 4 A4 导出标准。
 */

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useXmlUpdater } from './use-xml-updater';

// MuseScore 4 A4 导出标准坐标配置（与后端 text_config.py XmlLayoutConfig 一致）
const CREDIT_CONFIG = {
    TITLE_CENTER_X: '600.241935',
    TITLE: {
        defaultY: '1611.210312',
        fontSize: '22',
        justify: 'center',
        valign: 'top',
        creditType: 'title',
    },
    SUBTITLE: {
        defaultY: '1554.060198',
        fontSize: '14',
        justify: 'center',
        valign: 'top',
        creditType: 'subtitle',
    },
    COMPOSER: {
        defaultX: '1114.7587',
        defaultY: '1511.210312',
        justify: 'right',
        valign: 'bottom',
        creditType: 'composer',
    },
    LYRICIST: {
        defaultX: '85.725171',
        defaultY: '1511.210312',
        justify: 'left',
        valign: 'bottom',
        creditType: 'lyricist',
    },
    COPYRIGHT: {
        defaultX: '600.241935',
        defaultY: '85.725171',
        fontSize: '9',
        justify: 'center',
        valign: 'bottom',
        creditType: 'rights',
    },
} as const;

/**
 * 查找包含指定 credit-type 的 <credit> 元素
 */
function findCreditByType(xmlDoc: XMLDocument, creditType: string): Element | null {
    const credits = xmlDoc.querySelectorAll('credit');
    for (const credit of credits) {
        const typeEl = credit.querySelector('credit-type');
        if (typeEl?.textContent === creditType) {
            return credit;
        }
    }
    return null;
}

/**
 * 更新或创建 <credit> 元素（精确对齐 MuseScore 4 导出标准）
 * 
 * 结构：
 * <credit page="1">
 *   <credit-type>...</credit-type>
 *   <credit-words default-x="..." default-y="..." justify="..." valign="..." [font-size="..."]>text</credit-words>
 * </credit>
 */
function upsertCredit(
    xmlDoc: XMLDocument,
    root: Element,
    creditType: string,
    text: string,
    attrs: {
        defaultX: string;
        defaultY: string;
        justify: string;
        valign: string;
        fontSize?: string;
    }
): void {
    let credit = findCreditByType(xmlDoc, creditType);

    if (!text || text.trim() === '') {
        // 文本为空时移除整个 credit 元素
        if (credit) credit.parentNode?.removeChild(credit);
        return;
    }

    if (credit) {
        // 已存在 → 仅更新 credit-words 文本，保留所有属性
        const cw = credit.querySelector('credit-words');
        if (cw) {
            cw.textContent = text;
        }
    } else {
        // 不存在 → 创建完整的 credit 元素
        credit = xmlDoc.createElement('credit');
        credit.setAttribute('page', '1');

        // credit-type 在 credit-words 之前（MuseScore 标准顺序）
        const ct = xmlDoc.createElement('credit-type');
        ct.textContent = creditType;
        credit.appendChild(ct);

        const cw = xmlDoc.createElement('credit-words');
        cw.setAttribute('default-x', attrs.defaultX);
        cw.setAttribute('default-y', attrs.defaultY);
        cw.setAttribute('justify', attrs.justify);
        cw.setAttribute('valign', attrs.valign);
        if (attrs.fontSize) {
            cw.setAttribute('font-size', attrs.fontSize);
        }
        cw.textContent = text;
        credit.appendChild(cw);

        // 插入到 <part-list> 之前
        const partList = xmlDoc.querySelector('part-list');
        if (partList) {
            root.insertBefore(credit, partList);
        } else {
            root.appendChild(credit);
        }
    }
}

export function useMetadataEditor() {
    const { updateMusicXML } = useXmlUpdater();
    const t = useTranslations('editor.actions');

    const updateKeySignature = useCallback((newKey: string) => {
        updateMusicXML(xmlDoc => {
            let m1 = xmlDoc.querySelector('measure[number="1"]') || xmlDoc.querySelector('measure');
            if (!m1) return;
            let attrs = m1.querySelector('attributes');
            if (!attrs) {
                attrs = xmlDoc.createElement('attributes');
                m1.insertBefore(attrs, m1.firstChild);
            }
            let key = attrs.querySelector('key');
            if (!key) {
                key = xmlDoc.createElement('key');
                attrs.appendChild(key);
            }
            let fifths = key.querySelector('fifths');
            if (!fifths) {
                fifths = xmlDoc.createElement('fifths');
                key.appendChild(fifths);
            }
            fifths.textContent = newKey;
        }, t('updateKey'));
    }, [updateMusicXML, t]);

    const updateTimeSignature = useCallback((newTime: string) => {
        updateMusicXML(xmlDoc => {
            const [beats, beatType] = newTime.split('/');
            let m1 = xmlDoc.querySelector('measure[number="1"]') || xmlDoc.querySelector('measure');
            if (!m1) return;
            let attrs = m1.querySelector('attributes');
            if (!attrs) {
                attrs = xmlDoc.createElement('attributes');
                m1.insertBefore(attrs, m1.firstChild);
            }
            let time = attrs.querySelector('time');
            if (!time) {
                time = xmlDoc.createElement('time');
                attrs.appendChild(time);
            }
            let b = time.querySelector('beats');
            if (!b) {
                b = xmlDoc.createElement('beats');
                time.appendChild(b);
            }
            b.textContent = beats;
            let bt = time.querySelector('beat-type');
            if (!bt) {
                bt = xmlDoc.createElement('beat-type');
                time.appendChild(bt);
            }
            bt.textContent = beatType;
        }, t('updateTimeSignature'));
    }, [updateMusicXML, t]);

    const updateTempo = useCallback((newTempo: string) => {
        updateMusicXML(xmlDoc => {
            let m1 = xmlDoc.querySelector('measure[number="1"]') || xmlDoc.querySelector('measure');
            if (!m1) return;
            let sound = m1.querySelector('sound');
            if (!sound) {
                sound = xmlDoc.createElement('sound');
                const attrs = m1.querySelector('attributes');
                if (attrs && attrs.nextSibling) {
                    m1.insertBefore(sound, attrs.nextSibling);
                } else if (attrs) {
                    m1.appendChild(sound);
                } else {
                    m1.insertBefore(sound, m1.firstChild);
                }
            }
            sound.setAttribute('tempo', newTempo);
        }, t('updateTempo'));
    }, [updateMusicXML, t]);

    const updateScoreMainTitle = useCallback((title: string) => {
        updateMusicXML(xmlDoc => {
            const root = xmlDoc.querySelector('score-partwise') || xmlDoc.documentElement;

            // 1. 更新 <work-title>
            let work = xmlDoc.querySelector('work');
            if (!work) {
                work = xmlDoc.createElement('work');
                root.insertBefore(work, root.firstChild);
            }
            let workTitle = work.querySelector('work-title');
            if (!workTitle) {
                workTitle = xmlDoc.createElement('work-title');
                work.appendChild(workTitle);
            }
            workTitle.textContent = title;

            // 2. 同步更新 <credit>（title）
            upsertCredit(xmlDoc, root, CREDIT_CONFIG.TITLE.creditType, title, {
                defaultX: CREDIT_CONFIG.TITLE_CENTER_X,
                defaultY: CREDIT_CONFIG.TITLE.defaultY,
                justify: CREDIT_CONFIG.TITLE.justify,
                valign: CREDIT_CONFIG.TITLE.valign,
                fontSize: CREDIT_CONFIG.TITLE.fontSize,
            });
        }, t('updateTitle'));
    }, [updateMusicXML, t]);

    const updateScoreSubtitle = useCallback((subtitle: string) => {
        updateMusicXML(xmlDoc => {
            const root = xmlDoc.querySelector('score-partwise') || xmlDoc.documentElement;

            // 只更新 <credit>（subtitle），不再使用 <movement-title>
            upsertCredit(xmlDoc, root, CREDIT_CONFIG.SUBTITLE.creditType, subtitle, {
                defaultX: CREDIT_CONFIG.TITLE_CENTER_X,
                defaultY: CREDIT_CONFIG.SUBTITLE.defaultY,
                justify: CREDIT_CONFIG.SUBTITLE.justify,
                valign: CREDIT_CONFIG.SUBTITLE.valign,
                fontSize: CREDIT_CONFIG.SUBTITLE.fontSize,
            });
        }, t('updateSubtitle'));
    }, [updateMusicXML, t]);

    const updateScoreCopyright = useCallback((copyright: string) => {
        updateMusicXML(xmlDoc => {
            const root = xmlDoc.querySelector('score-partwise') || xmlDoc.documentElement;

            // 1. 更新 <identification><rights>
            let identification = xmlDoc.querySelector('identification');
            if (!identification) {
                identification = xmlDoc.createElement('identification');
                root.appendChild(identification);
            }
            let rights = identification.querySelector('rights');
            if (!rights) {
                rights = xmlDoc.createElement('rights');
                identification.appendChild(rights);
            }
            rights.textContent = copyright;

            // 2. 同步更新 <credit>（rights）
            upsertCredit(xmlDoc, root, CREDIT_CONFIG.COPYRIGHT.creditType, copyright, {
                defaultX: CREDIT_CONFIG.COPYRIGHT.defaultX,
                defaultY: CREDIT_CONFIG.COPYRIGHT.defaultY,
                justify: CREDIT_CONFIG.COPYRIGHT.justify,
                valign: CREDIT_CONFIG.COPYRIGHT.valign,
                fontSize: CREDIT_CONFIG.COPYRIGHT.fontSize,
            });
        }, t('updateCopyright'));
    }, [updateMusicXML, t]);

    /**
     * 更新 <creator type="..."> 元素 + 对应的 <credit> 元素
     */
    const updateCreator = useCallback((type: 'composer' | 'lyricist', text: string) => {
        updateMusicXML(xmlDoc => {
            const root = xmlDoc.querySelector('score-partwise') || xmlDoc.documentElement;

            // 1. 更新 <identification><creator>
            let identification = xmlDoc.querySelector('identification');
            if (!identification) {
                identification = xmlDoc.createElement('identification');
                const work = xmlDoc.querySelector('work');
                if (work && work.nextSibling) {
                    root.insertBefore(identification, work.nextSibling);
                } else if (work) {
                    root.appendChild(identification);
                } else {
                    root.insertBefore(identification, root.firstChild);
                }
            }

            // 查找已有的 creator 元素
            const creators = identification.querySelectorAll('creator');
            let existing: Element | null = null;
            creators.forEach(el => {
                if (el.getAttribute('type') === type) existing = el;
            });

            if (!text || text.trim() === '') {
                if (existing) identification.removeChild(existing);
            } else {
                if (!existing) {
                    existing = xmlDoc.createElement('creator');
                    existing.setAttribute('type', type);
                    // 插入到 identification 的最前面（MuseScore 顺序：creator → rights → encoding）
                    identification.insertBefore(existing, identification.firstChild);
                }
                existing.textContent = text;
            }

            // 2. 同步更新 <credit>
            const cfg = type === 'composer' ? CREDIT_CONFIG.COMPOSER : CREDIT_CONFIG.LYRICIST;
            upsertCredit(xmlDoc, root, cfg.creditType, text, {
                defaultX: cfg.defaultX,
                defaultY: cfg.defaultY,
                justify: cfg.justify,
                valign: cfg.valign,
            });
        }, t(type === 'composer' ? 'updateComposer' : 'updateLyricist'));
    }, [updateMusicXML, t]);

    const updateScoreComposer = useCallback((text: string) => updateCreator('composer', text), [updateCreator]);
    const updateScoreLyricist = useCallback((text: string) => updateCreator('lyricist', text), [updateCreator]);

    return {
        updateKeySignature,
        updateTimeSignature,
        updateTempo,
        updateScoreMainTitle,
        updateScoreSubtitle,
        updateScoreCopyright,
        updateScoreComposer,
        updateScoreLyricist,
    };
}
