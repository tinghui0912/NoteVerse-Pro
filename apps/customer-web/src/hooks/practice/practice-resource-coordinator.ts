/** Shared by STEP and Continuous bindings; a new owner waits for every prior release. */
export class PracticeResourceCoordinator {
  private released: Promise<void> = Promise.resolve();

  waitForRelease(): Promise<void> { return this.released; }

  trackRelease(...pending: (Promise<void> | null | undefined)[]): Promise<void> {
    this.released = Promise.all([this.released, ...pending]).then(() => {});
    return this.released;
  }
}
