// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { opfsStoreFixture } from "../__fixtures__/opfs-store";
import { createOwnedMedia } from "../recording/owned-media";
import type { VideoExportSession } from "./session";
import { exportVideo } from "./export";

vi.mock("./score-model", () => ({
  prepareScorePageCache: vi.fn(async () => new Map()),
  findStablePageNumber: vi.fn(),
  prefetchEventScoreImage: vi.fn(),
  resolveExportPlaybackGeometry: vi.fn(),
}));
vi.mock("./frame-renderer", () => ({
  renderVideoExportFrameAtTime: vi.fn(async () => {}),
}));

function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};

function rig() {
  const store = opfsStoreFixture(),
    started = deferred(),
    closing = deferred();
  let delayClose = false;
  const track = { kind: "video", stop: vi.fn() },
    audio = { kind: "audio", stop: vi.fn() };
  class Stream {
    constructor(private tracks = [track]) {}
    getTracks() {
      return this.tracks;
    }
    getVideoTracks() {
      return this.tracks.filter((t) => t.kind === "video");
    }
    getAudioTracks() {
      return this.tracks.filter((t) => t.kind === "audio");
    }
  }
  class Context {
    createMediaElementSource() {
      return { connect: vi.fn() };
    }
    createMediaStreamDestination() {
      return { stream: new Stream([audio]) };
    }
    resume = vi.fn(async () => {});
    close = vi.fn(async () => {
      if (delayClose) await closing.promise;
    });
  }
  let recorder!: Encoder;
  class Encoder {
    static isTypeSupported = () => true;
    state = "inactive";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onerror: (() => void) | null = null;
    onstop: (() => void) | null = null;
    constructor() {
      recorder = this;
    }
    start = vi.fn((timeslice: number) => {
      expect(timeslice).toBe(1000);
      this.state = "recording";
      started.resolve();
    });
    stop = vi.fn(() => {
      this.state = "inactive";
    });
    chunk(value = new Blob(["encoded"])) {
      this.ondataavailable?.({ data: value });
    }
    finish() {
      this.state = "inactive";
      this.onstop?.();
    }
  }
  vi.stubGlobal("MediaStream", Stream);
  vi.stubGlobal("MediaRecorder", Encoder);
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(navigator, "storage", "get").mockReturnValue({
    getDirectory: store.platform.root,
  } as unknown as StorageManager);
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: store.platform.locks,
  });
  vi.spyOn(crypto, "randomUUID").mockImplementation(
    () =>
      store.platform.randomId() as `${string}-${string}-${string}-${string}-${string}`,
  );
  Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
    configurable: true,
    value: () => new Stream(),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as never);
  for (const [name, value] of Object.entries({
    readyState: 2,
    videoWidth: 640,
    videoHeight: 480,
    currentTime: 1.25,
    duration: 4,
  }))
    Object.defineProperty(HTMLVideoElement.prototype, name, {
      configurable: true,
      get: () => value,
    });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  URL.createObjectURL = vi.fn(() => "blob:input");
  URL.revokeObjectURL = vi.fn();
  const sourceRemoved = vi.fn(async () => {});
  const source = createOwnedMedia(
    new Blob(["source"], { type: "video/webm" }),
    sourceRemoved,
  );
  const session: VideoExportSession = {
    sessionId: "export",
    sourceId: "source",
    scoreIdentity: { scoreId: "s", revisionId: "r", artifactId: "a" },
    video: {
      status: "READY",
      kind: "VIDEO",
      media: source,
      durationMs: 4000,
      mimeType: "video/webm",
    },
    scope: { kind: "FULL", startTick: 0, terminalTick: 4 },
    tempoPlan: {
      selection: { mode: "SCORE" },
      segments: [{ startTick: 0, bpm: 80, source: "PRODUCT_DEFAULT" }],
    },
    recordingTimebase: {
      nominalMediaDurationMs: 4000,
      activeSegments: [
        { perfStartMs: 0, perfEndMs: 4000, mediaStartMs: 0, mediaEndMs: 4000 },
      ],
    },
  };
  const abort = new AbortController();
  const run = () =>
    exportVideo({
      session,
      scoreContainer: document.createElement("div"),
      adapter: { getCursorTimelineEntryForTickRange: () => null } as never,
      scoreEndTick: 4,
      ticksPerQuarter: 1,
      signal: abort.signal,
    });
  return {
    ...store,
    run,
    abort,
    started: started.promise,
    encoder: () => recorder,
    source,
    sourceRemoved,
    delayClose() {
      delayClose = true;
    },
    finishClose: closing.resolve,
  };
}

beforeEach(() => {
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    get: () => ({}),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("returns an independent exact file-backed owner, preserving source and retained output lifetimes", async () => {
  const f = rig(),
    pending = f.run();
  await f.started;
  f.encoder().chunk(new Blob(["A"]));
  f.encoder().chunk(new Blob(["BC"]));
  f.encoder().finish();
  const result = await pending;
  expect(result.media).not.toBe(f.source);
  expect(result.media.blob).not.toBe(f.source.blob);
  expect(result.media.byteSize).toBe(3);
  expect(result.media.blob.size).toBe(3);
  expect(result.mimeType).toBe("video/webm;codecs=vp9,opus");
  expect(result.media.blob.type).toBe(result.mimeType);
  expect(result.durationMs).toBe(1250);
  expect(f.close).toHaveBeenCalledOnce();
  expect(f.sourceRemoved).not.toHaveBeenCalled();
  const lease = result.media.retain();
  await result.media.release();
  expect(f.files.size).toBe(1);
  await lease.release();
  expect(f.files.size).toBe(0);
  expect(f.remove).toHaveBeenCalledOnce();
  await f.source.release();
  expect(f.sourceRemoved).toHaveBeenCalledOnce();
});

it("drains A then B and the final dataavailable before closing/sealing, even after stop", async () => {
  const f = rig(),
    a = deferred(),
    b = deferred(),
    order: string[] = [];
  const original = f.write.getMockImplementation()!;
  f.write.mockImplementation(async (id, chunk) => {
    order.push(chunk.size === 1 ? "A" : "B");
    await (chunk.size === 1 ? a.promise : b.promise);
    await original(id, chunk);
  });
  const pending = f.run();
  await f.started;
  f.encoder().chunk(new Blob(["A"]));
  f.encoder().chunk(new Blob(["BB"]));
  f.encoder().finish();
  await flush();
  expect(order).toEqual(["A"]);
  expect(f.close).not.toHaveBeenCalled();
  a.resolve();
  await flush();
  expect(order).toEqual(["A", "B"]);
  expect(f.close).not.toHaveBeenCalled();
  Object.defineProperty(HTMLVideoElement.prototype, "currentTime", {
    configurable: true,
    get: () => 99,
  });
  b.resolve();
  const result = await pending;
  expect(result.durationMs).toBe(1250);
  expect(f.close).toHaveBeenCalledOnce();
  expect(result.media.byteSize).toBe(3);
  await result.media.release();
});

it.each([
  "before chunk",
  "pending write",
  "before stop",
  "drain",
  "sealed",
] as const)("abort %s cannot publish or revive output", async (point) => {
  const f = rig(),
    write = deferred();
  if (point === "pending write" || point === "drain") {
    const original = f.write.getMockImplementation()!;
    f.write.mockImplementation(async (id, chunk) => {
      await write.promise;
      await original(id, chunk);
    });
  }
  if (point === "sealed") f.delayClose();
  const outcome = f.run().then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await f.started;
  const lateData = f.encoder().ondataavailable!,
    lateStop = f.encoder().onstop!;
  if (point !== "before chunk") f.encoder().chunk();
  if (point === "drain" || point === "sealed") f.encoder().finish();
  await flush();
  if (point === "sealed") expect(f.close).toHaveBeenCalledOnce();
  f.abort.abort();
  write.resolve();
  f.finishClose();
  lateData({ data: new Blob(["late"]) });
  lateStop();
  expect(await outcome).toMatchObject({ error: { name: "AbortError" } });
  expect(f.files.size).toBe(0);
  expect(f.held.size).toBe(0);
  expect(f.remove).toHaveBeenCalledOnce();
  await flush();
  expect(f.files.size).toBe(0);
  expect(f.sourceRemoved).not.toHaveBeenCalled();
});

it.each(["writer first", "encoder first"] as const)(
  "%s failure has one public failure and one partial retirement",
  async (ordering) => {
    const f = rig(),
      write = deferred();
    f.write.mockImplementation(async () => {
      await write.promise;
    });
    const reject = vi.fn(),
      outcome = f.run().catch((error) => {
        reject(error);
        return error;
      });
    await f.started;
    const lateStop = f.encoder().onstop!;
    f.encoder().chunk();
    await flush();
    if (ordering === "encoder first") f.encoder().onerror!();
    write.reject(new Error("disk failed"));
    await flush();
    lateStop();
    const error = await outcome;
    expect(error.message).toBe(
      ordering === "encoder first"
        ? "video_export_failed:encoding"
        : "video_export_failed:output_write",
    );
    expect(f.encoder().stop).toHaveBeenCalledOnce();
    expect(reject).toHaveBeenCalledOnce();
    expect(f.files.size).toBe(0);
    expect(f.held.size).toBe(0);
    expect(f.remove).toHaveBeenCalledOnce();
  },
);

it("rejects empty output and removes its sealed file", async () => {
  const f = rig(),
    outcome = f.run().catch((error) => error);
  await f.started;
  f.encoder().finish();
  expect(await outcome).toMatchObject({
    message: "video_export_failed:empty_output",
  });
  expect(f.files.size).toBe(0);
  expect(f.held.size).toBe(0);
  expect(f.remove).toHaveBeenCalledOnce();
});

it("fails closed when exact writer bytes disagree with the final file size", async () => {
  const f = rig();
  f.write.mockImplementation(async () => {});
  const outcome = f.run().catch((error) => error);
  await f.started;
  f.encoder().chunk();
  f.encoder().finish();
  expect(await outcome).toBeInstanceOf(Error);
  expect(f.files.size).toBe(0);
  expect(f.held.size).toBe(0);
});

it("fails unavailable without OPFS instead of creating an in-memory output", async () => {
  const f = rig();
  vi.spyOn(navigator, "storage", "get").mockReturnValue({} as StorageManager);
  await expect(f.run()).rejects.toThrow(
    "video_export_unavailable:output_storage",
  );
  expect(f.files.size).toBe(0);
});

it("incrementally accepts more than 100 MiB using one reusable small chunk and a counting writer", async () => {
  const f = rig();
  let bytes = 0,
    outstanding = 0,
    maximum = 0,
    writes = 0;
  f.write.mockImplementation(async (_id, chunk) => {
    maximum = Math.max(maximum, ++outstanding);
    bytes += chunk.size;
    writes++;
    outstanding--;
  });
  const getFile = f.directory.getFileHandle.getMockImplementation()!;
  f.directory.getFileHandle.mockImplementation(async (...args) => {
    const file = await getFile(...args);
    return {
      ...file,
      getFile: async () => {
        const raw = new File([], "logical-output");
        Object.defineProperty(raw, "size", { value: bytes });
        raw.slice = (_start, _end, type) => {
          const view = new Blob([], { type });
          Object.defineProperty(view, "size", { value: bytes });
          return view;
        };
        return raw;
      },
    };
  });
  const pending = f.run();
  await f.started;
  const chunk = new Blob(["x".repeat(64 * 1024)]);
  for (let index = 0; index < 1601; index++) {
    f.encoder().chunk(chunk);
    await flush();
    expect(f.write.mock.calls[0]?.[1]).toBe(chunk);
    f.write.mockClear();
  }
  f.encoder().finish();
  const result = await pending;
  expect(bytes).toBeGreaterThan(100 * 1024 * 1024);
  expect(result.media.byteSize).toBe(bytes);
  expect(maximum).toBe(1);
  expect(f.files.get("capture-1")).toEqual([]);
  expect(writes).toBe(1601);
  f.write.mockClear();
  await result.media.release();
  expect(f.files.size).toBe(0);
});

it("rejects an already-cancelled request as AbortError without opening output storage", async () => {
  const f = rig();
  f.abort.abort("caller cancellation");
  await expect(f.run()).rejects.toMatchObject({ name: "AbortError" });
  expect(f.directory.getDirectoryHandle).not.toHaveBeenCalled();
  expect(f.files.size).toBe(0);
});
it("requires Web Locks for output storage", async () => {
  const f = rig();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: undefined,
  });
  await expect(f.run()).rejects.toThrow(
    "video_export_unavailable:output_storage",
  );
  expect(f.files.size).toBe(0);
});
