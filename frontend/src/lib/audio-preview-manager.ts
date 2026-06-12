
'use client';

import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import OsmdAudioPlayer from 'osmd-audio-player';
import { patchSoundfontToLocal } from './patch-soundfont';

interface AudioPreviewManagerOptions {
  container: HTMLElement;
  bpm?: number;
  getTempo?: () => number | string;
  followCursor?: boolean;
  autoScroll?: boolean;
}

type CursorWithOptions = {
  cursorOptions?: {
    type?: number;
  };
};

type PlayerWithAudioContext = {
  audioContext?: AudioContext;
  context?: AudioContext;
  ac?: AudioContext;
};

export class AudioPreviewManager {
  public osmd: OpenSheetMusicDisplay | null = null;
  public player: OsmdAudioPlayer | null = null;

  private options: AudioPreviewManagerOptions;
  private _container: HTMLElement;
  private isReady = false;
  private _loadedHash: string | null = null;
  private _loading = false;
  private _initialSvgWidth: number | null = null;

  constructor(options: AudioPreviewManagerOptions) {
    if (!options.container || !(options.container instanceof HTMLElement)) {
      throw new Error('Please pass a valid div container to AudioPreviewManager.');
    }

    this.options = {
      bpm: 100,
      getTempo: undefined,
      followCursor: true,
      autoScroll: true,
      ...options,
    };
    this._container = this.options.container;

    this.osmd = new OpenSheetMusicDisplay(this._container, {
      // @ts-expect-error
      drawCursor: true,
      drawingParameters: 'default',
      // Melody-Forge uses these specific settings for reliable layout
      // We must match them to get the same behavior
      newSystemFromXML: true,
      newSystemFromNewPageInXML: true,
      newPageFromXML: true,

      // Disable internal resize handler to prevent conflict with our ResizeObserver
      autoResize: false,
    });
    // Explicitly set cursor type to Standard (0) to ensure it spans the system if possible
    if (this.osmd.cursor) {
      const cursor = this.osmd.cursor as unknown as CursorWithOptions;
      if (cursor.cursorOptions) {
        cursor.cursorOptions.type = 0;
      }
    }

    // 馃幆 Patch Soundfont to use local files instead of CDN
    // This must be done before creating OsmdAudioPlayer
    patchSoundfontToLocal('/soundfonts/MusyngKite/');

    this.player = new OsmdAudioPlayer();

    // Apply initial BPM if provided
    if (this.options.bpm && this.options.bpm > 0) {
      this.player.setBpm(this.options.bpm);
    }

    // If getTempo is provided, we might want to use it, but OsmdAudioPlayer doesn't support a getter callback directly.
    // We'll rely on the caller to update BPM if it changes, or set it initially.
    if (this.options.getTempo) {
      const t = Number(this.options.getTempo());
      if (!isNaN(t) && t > 0) {
        this.player.setBpm(t);
      }
    }
  }

  private _hash(str: string): string | null {
    if (!str) return null;
    const len = str.length;
    const a = str.charCodeAt(0) || 0;
    const b = str.charCodeAt(len - 1) || 0;
    return `${len}:${a}:${b}`;
  }

  private async _loadFromXml(xmlString: string) {
    if (!xmlString || typeof xmlString !== 'string') {
      throw new Error('AudioPreviewManager.loadFromXml: invalid xmlString');
    }
    if (!this.osmd || !this.player) {
      this.isReady = false;
      return;
    }

    this._loading = true;
    try {
      await this.osmd.load(xmlString);

      // Wait for container to have valid width (melody-forge improvement)
      if (this._container) {
        const el = this._container;
        let guard = 0;
        while (el && el.clientWidth === 0 && guard < 20) {
          await new Promise(r => setTimeout(r, 25)); // Max 500ms wait
          guard++;
        }
      }

      // Force OSMD to calculate layout at a large width to ensure it respects XML system breaks
      // OSMD decides the layout (measures per line) during the first render() based on container width
      // If the container is too narrow, it will override XML breaks and use fewer measures per line
      // We temporarily set a large width, render to lock in the correct layout, then scale with zoom
      const originalWidth = this._container.style.width;
      this._container.style.width = '1600px'; // Large enough for most musical layouts

      await this.osmd.render();

      // Restore original container width
      this._container.style.width = originalWidth;

      // Record initial SVG width for accurate zoom calculations
      const svgElement = this._container.querySelector('svg');
      if (svgElement) {
        this._initialSvgWidth = svgElement.clientWidth;
      }

      // Initialize the audio player with the rendered score
      // This must happen AFTER the first render but BEFORE any zoom adjustments
      // @ts-expect-error - Version compatibility issue between OSMD 1.9.2 and osmd-audio-player 0.7.0
      await this.player.loadScore(this.osmd);

      // CRITICAL: Re-apply BPM after loading score
      // player.loadScore() might reset the BPM to default or read from XML
      // We must ensure the user's requested BPM is applied
      if (this.options.bpm && this.options.bpm > 0) {
        this.player.setBpm(this.options.bpm);
      }

      // Fit to container after rendering to ensure proper initial zoom
      // Note: We do NOT reload the player score here - it's already loaded above
      // Reloading the player on every resize breaks cursor synchronization
      await this.fitToContainer();

      this._loadedHash = this._hash(xmlString);
      this.isReady = true;
    } finally {
      this._loading = false;
    }
  }

  async loadScore(xmlString: string) {
    if (!xmlString || typeof xmlString !== 'string' || xmlString.trim() === '') {
      throw new Error('No playable score (MusicXML is empty)');
    }

    // XML loading cache (melody-forge improvement)
    const h = this._hash(xmlString);
    if (this._loading) {
      throw new Error('Score is already loading. Please wait for the current load to complete.');
    }
    if (h !== this._loadedHash) {
      await this._loadFromXml(xmlString);
    }
  }


  async play() {
    if (!this.player || !this.isReady) {
      throw new Error('Player not ready');
    }

    // Play duplicate call protection (melody-forge improvement)
    const state = this.player.state;
    if (state === 'PLAYING') {
      // @ts-expect-error
      const stepsOk = typeof this.player.iterationSteps === 'number' && typeof this.player.currentIterationStep === 'number';
      // @ts-expect-error
      const atEnd = stepsOk && this.player.currentIterationStep >= this.player.iterationSteps - 1;
      if (!atEnd) {
        return; // Ignore duplicate call
      }
      // At end, stop and continue to restart
      this.stop();
    }

    // Resume AudioContext if suspended (melody-forge improvement)
    const player = this.player as unknown as PlayerWithAudioContext;
    const ctx = player.audioContext || player.context || player.ac;
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (e) {
        console.warn('[AudioPreviewManager] Failed to resume AudioContext:', e);
      }
    }

    await this.player.play();
  }

  /**
   * Play from a specific step position using the jumpToStep API
   * 
   * osmd-audio-player DOES support seeking via player.jumpToStep(step)!
   * This method:
   * 1. Pauses playback
   * 2. Resets cursor if target is before current position
   * 3. Advances cursor to target step
   * 4. Updates scheduler.setIterationStep()
   * 
   * After jumpToStep, call play() to resume from the new position.
   */
  async playFromStep(targetStep: number): Promise<void> {
    if (!this.player || !this.isReady) {
      throw new Error('Player not ready');
    }

    // @ts-expect-error
    const scheduler = this.player.scheduler;

    // Resume AudioContext if suspended (required before any audio operations)
    const player = this.player as unknown as PlayerWithAudioContext;
    const ctx = player.audioContext || player.context || player.ac;
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (e) {
        console.warn('[playFromStep] Failed to resume AudioContext:', e);
      }
    }

    // Custom seek implementation that avoids jumpToStep's +1 offset issue
    // jumpToStep internally does: schedulerStep = step + 1, which causes audio
    // to start one step AFTER the user's target position.
    // 
    // We'll directly set the internal state to start exactly at targetStep:
    // @ts-expect-error
    const cursor = this.player.cursor;

    // 1. Reset cursor to beginning - REMOVED
    // We assume handleSeek has already positioned the cursor correctly.
    // Resetting here causes a visual "rewind" glitch that bothers the user.
    /*
    if (cursor && typeof cursor.reset === 'function') {
      cursor.reset();
      console.log('[playFromStep] Cursor reset to beginning');
    }

    // 2. Advance cursor to target position (matching jumpToStep behavior)
    // @ts-expect-error
    let currentStep = 0;
    while (currentStep < targetStep && cursor && !cursor.Iterator?.EndReached) {
      cursor.next();
      currentStep++;
    }
    console.log('[playFromStep] Cursor advanced to step:', currentStep);
    */

    // 3. Set player's internal currentIterationStep
    // @ts-expect-error
    this.player.currentIterationStep = targetStep;

    // 4. Set scheduler.stepQueueIndex to targetStep (NOT targetStep + 1!)
    // This is the key fix - we want audio to start at targetStep, not targetStep + 1
    if (scheduler) {
      scheduler.stepQueueIndex = targetStep;
      // Also update scheduler's currentTick to match the step's tick
      if (scheduler.stepQueue && scheduler.stepQueue.steps && scheduler.stepQueue.steps[targetStep]) {
        scheduler.currentTick = scheduler.stepQueue.steps[targetStep].tick;
      }
    }

    // 5. Show cursor if hidden
    if (cursor && typeof cursor.show === 'function') {
      cursor.show();
    }

    await this.player.play();
  }

  stop() {
    if (this.player && this.isReady) {
      try {
        this.player.stop();
      } catch (e) {
        console.warn("Player stop error", e);
      }
    }
  }

  destroy() {
    if (this.player) {
      this.stop();
    }
    this.osmd = null;
    this.player = null;
    this.isReady = false;
  }

  setTempo(bpm: number) {
    if (this.player && typeof bpm === 'number' && bpm > 0) {
      this.player.setBpm(bpm);
    }
  }

  /**
   * Fit OSMD rendering to container size by adjusting zoom.
   * This ensures the score is always visible and properly scaled.
   * Modeled after melody-forge's fitOsmdContain function.
   */
  async fitToContainer() {
    if (!this._container || !this.osmd) return;

    const containerWidth = this._container.clientWidth;
    const svgElement = this._container.querySelector('svg');

    if (!svgElement) return;

    const svgWidth = svgElement.clientWidth;

    // Calculate zoom to fit width
    // Use the initial SVG width (at zoom=1.0) for accurate calculations
    // This prevents cumulative error from repeated resizing
    const initialWidth = this._initialSvgWidth || svgWidth;
    const targetZoom = (containerWidth / initialWidth) * 0.98;

    // Apply zoom
    this.osmd.Zoom = targetZoom;

    // Capture current cursor position before render
    let cursorTimeStamp = null;
    if (this.osmd.cursor) {
      cursorTimeStamp = this.osmd.cursor.Iterator.currentTimeStamp;
    }

    try {
      this.osmd.render();

      // Re-apply cursor options as render() recreates the cursor
      if (this.osmd.cursor) {
        // @ts-expect-error
        this.osmd.cursor.cursorOptions.type = 0; // Standard cursor
      }

      // Fix cursor height after render to override Tailwind's height: auto
      // osmd.render() recreates the cursor element, so we need to reapply the fix
      if (this.osmd.cursor) {
        if (this._container && this.options.followCursor) {
          try {
            this.osmd.cursor.show();
          } catch (e) {
            console.warn('[AudioPreviewManager] Failed to show cursor:', e);
          }
        }

        // Restore cursor position if we had one
        if (cursorTimeStamp) {
          this.osmd.cursor.reset();
          // Manually advance cursor to the saved timestamp
          // This is necessary because MusicPartManagerIterator doesn't have a seek method
          const iterator = this.osmd.cursor.Iterator;

          while (
            iterator.currentTimeStamp.RealValue < cursorTimeStamp.RealValue &&
            !iterator.EndReached
          ) {
            this.osmd.cursor.next();
          }

          this.osmd.cursor.update();
        } else {
          this.osmd.cursor.reset();
          try {
            this.osmd.cursor.update();
          } catch (e) {
            console.warn('[AudioPreviewManager] Failed to update cursor:', e);
          }
        }

        // Fix cursor visibility and height
        // Tailwind CSS sets `img { height: auto }` which overrides OSMD's height attribute.
        // We need to explicitly set CSS height style to match the HTML height attribute.
        this._fixCursorHeight();
      } else {
        console.warn('[AudioPreviewManager] Cursor not available!');
      }
    } catch (e) {
      console.warn('[AudioPreviewManager] fitToContainer render error:', e);
    }
  }

  /**
   * Fix cursor height issue caused by Tailwind CSS's `img { height: auto }`.
   * This method syncs CSS height style with HTML height attribute.
   * Call this after cursor.show(), cursor.reset(), or cursor.next().
   */
  fixCursorHeight() {
    this._fixCursorHeight();
  }

  private _fixCursorHeight() {
    if (!this.osmd?.cursor?.cursorElement) return;

    const cursor = this.osmd.cursor.cursorElement;

    // Ensure visibility
    cursor.style.display = 'block';
    cursor.style.visibility = 'visible';

    // Fix Tailwind CSS conflict: Tailwind's img { height: auto } overrides OSMD's height attribute
    // OSMD sets the height attribute (HTML attribute), but CSS styles have higher priority
    // We need to explicitly sync the height attribute to the CSS style property

    // Strategy: Calculate height manually from the GraphicSheet to ensure it covers all staves
    // This fixes the 1px bug AND ensures the cursor adapts to variable staff distances (e.g. measures 8-13)

    try {
      const iterator = this.osmd.cursor.Iterator;
      const measureIndex = iterator.CurrentMeasureIndex;
      const measureList = this.osmd.GraphicSheet.MeasureList;

      if (measureList && measureList[measureIndex]) {
        const staves = measureList[measureIndex];
        if (staves && staves.length > 0) {
          // Get top of the first staff (GraphicalMeasure)
          const topMeasure = staves[0];
          // Get bottom of the last staff (GraphicalMeasure)
          const bottomMeasure = staves[staves.length - 1];

          if (topMeasure && bottomMeasure) {
            const topBox = topMeasure.PositionAndShape;
            const bottomBox = bottomMeasure.PositionAndShape;

            if (topBox && bottomBox) {
              // Calculate vertical distance in OSMD units
              // AbsolutePosition.y is usually the top line of the staff
              const topY = topBox.AbsolutePosition.y;
              const bottomY = bottomBox.AbsolutePosition.y;

              // 4.0 is the height of a standard 5-line staff in OSMD units (4 spaces * 1 unit)
              const staffHeight = 4.0;

              // Total height in OSMD units
              const totalHeightUnits = (bottomY - topY) + staffHeight;

              // Convert to pixels: Units * 10 * Zoom
              // (Standard OSMD unit is 10px at 100% zoom)
              const pixelHeight = totalHeightUnits * 10.0 * this.osmd.Zoom;

              if (pixelHeight > 0) {
                cursor.style.height = pixelHeight + 'px';
                return;
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('[AudioPreviewManager] Manual cursor height calculation failed:', e);
    }

    // Fallback: Use standard grand staff height (2 staves + spacing)
    // Treble staff (4 units) + Bass staff (4 units) + typical spacing (2 units) = 10 units
    // At 100% zoom: 10 units * 10px/unit = 100px
    const STANDARD_GRAND_STAFF_HEIGHT_UNITS = 10;
    cursor.style.height = (STANDARD_GRAND_STAFF_HEIGHT_UNITS * 10 * this.osmd.Zoom) + 'px';
  }
}
