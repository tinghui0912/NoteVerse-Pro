import type { Page } from "@playwright/test";

export async function videoExportOutputFiles(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    try {
      const directory = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle("noteverse-video-export-output");
      const names: string[] = [];
      for await (const entry of (
        directory as unknown as { values(): AsyncIterable<{ name: string }> }
      ).values())
        names.push(entry.name);
      return names.sort();
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError")
        return [];
      throw error;
    }
  });
}

/** A deterministic native-OPFS write barrier exercises unmount during output IO. */
export async function installVideoExportOutputBarrier(page: Page) {
  await page.addInitScript(() => {
    const outputFiles = new WeakSet<FileSystemFileHandle>();
    let release!: () => void;
    let gate = Promise.resolve();
    const control = {
      pending: false,
      arm() {
        control.pending = false;
        gate = new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      release() {
        release?.();
      },
    };
    (window as unknown as { __videoOutput: typeof control }).__videoOutput =
      control;
    const getFile = FileSystemDirectoryHandle.prototype.getFileHandle;
    FileSystemDirectoryHandle.prototype.getFileHandle = async function (
      ...args
    ) {
      const file = await getFile.apply(this, args);
      if (this.name === "noteverse-video-export-output") outputFiles.add(file);
      return file;
    };
    const create = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = async function (options) {
      const writer = await create.call(this, options);
      if (outputFiles.has(this)) {
        const write = writer.write.bind(writer);
        writer.write = async (chunk) => {
          control.pending = true;
          await gate;
          return write(chunk);
        };
      }
      return writer;
    };
  });
}
