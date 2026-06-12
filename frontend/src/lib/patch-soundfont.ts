/**
 * Soundfont Monkey Patch Utility
 * 
 * Patches window.Soundfont.instrument to redirect soundfont requests
 * from remote CDN to local files in the public directory.
 * 
 * @remarks
 * This is based on Melody Forge's implementation and is necessary because
 * osmd-audio-player does not expose configuration options for soundfont URLs.
 * The patch intercepts the Soundfont.instrument() function and overrides
 * the nameToUrl option to use local paths.
 * 
 * @see {@link https://github.com/jimutt/osmd-audio-player | osmd-audio-player}
 */

declare global {
    interface Window {
        Soundfont?: {
            instrument: (
                ctx: AudioContext,
                name: string,
                opts?: Record<string, unknown>
            ) => unknown;
            __patched_local_root?: string;
        };
    }
}

/**
 * Patch Soundfont.instrument to use local soundfont files
 * 
 * @param root - Local soundfont directory path (default: '/soundfonts/MusyngKite/')
 * @returns boolean - Whether the patch was successfully applied
 * 
 * @example
 * ```typescript
 * // Apply patch before creating OsmdAudioPlayer
 * patchSoundfontToLocal();
 * const player = new OsmdAudioPlayer();
 * ```
 */
export function patchSoundfontToLocal(
    root: string = '/soundfonts/MusyngKite/'
): boolean {
    // Check if running in browser
    if (typeof window === 'undefined') {
        console.warn('[patchSoundfontToLocal] Not in browser environment');
        return false;
    }

    const sf = window.Soundfont;

    // Guard: Soundfont not available
    if (!sf || typeof sf.instrument !== 'function') {
        console.warn('[patchSoundfontToLocal] Soundfont not available on window');
        return false;
    }

    // Guard: Already patched (idempotent)
    if (sf.__patched_local_root === root) {
        return false;
    }

    // Save original function
    const originalInstrument = sf.instrument;

    // Create wrapper function that overrides nameToUrl
    sf.instrument = function (
        ctx: AudioContext,
        name: string,
        opts?: Record<string, unknown>
    ): unknown {
        // Merge options with local path override
        const customOpts = Object.assign(
            {
                soundfont: 'MusyngKite',
                format: 'mp3'
            },
            opts || {},
            {
                /**
                 * Override nameToUrl to use local files
                 * 
                 * @param instrument - Instrument name (e.g., 'acoustic_grand_piano')
                 * @param soundfont - Soundfont name (e.g., 'MusyngKite')
                 * @param format - File format (e.g., 'mp3')
                 * @returns Local file URL
                 */
                nameToUrl: (
                    instrument: string,
                    soundfont: string,
                    format: string
                ): string => {
                    return `${root}${instrument}-${format || 'mp3'}.js`;
                },

                /**
                 * Validate soundfont URL format
                 * @param url - URL to validate
                 * @returns true if URL matches soundfont pattern
                 */
                isSoundfontURL: (url: string): boolean => {
                    return /\.js(\?.*)?$/i.test(url);
                }
            }
        );

        // Call original function with modified options
        return originalInstrument.call(this, ctx, name, customOpts);
    };

    // Mark as patched to prevent duplicate patching
    try {
        sf.__patched_local_root = root;
    } catch (e) {
        console.warn('[patchSoundfontToLocal] Failed to mark as patched:', e);
    }

    return true;
}
