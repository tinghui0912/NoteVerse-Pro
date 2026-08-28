function escapeCssId(id: string) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id);
  }
  return id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function findElementByVerovioId(container: HTMLElement, verovioId: string) {
  return (
    container.querySelector<HTMLElement>(`[data-id="${verovioId}"]`) ??
    container.querySelector<HTMLElement>(`#${escapeCssId(verovioId)}`)
  );
}

export class PracticeSummaryAnnotationController {
  private readonly annotationClasses = [
    'practice-summary-note-problem',
    'practice-summary-note-review',
  ];
  private annotatedNoteIds: string[] = [];

  clear(container: HTMLElement) {
    for (const noteId of this.annotatedNoteIds) {
      findElementByVerovioId(container, noteId)?.classList.remove(...this.annotationClasses);
    }
    this.annotatedNoteIds = [];
  }

  apply(
    container: HTMLElement,
    annotations: {
      problemNoteIds: string[];
      reviewNoteIds: string[];
    }
  ) {
    this.clear(container);
    this.applyClass(container, annotations.reviewNoteIds, 'practice-summary-note-review');
    this.applyClass(container, annotations.problemNoteIds, 'practice-summary-note-problem');
  }

  private applyClass(container: HTMLElement, noteIds: string[], className: string) {
    const uniqueNoteIds = Array.from(new Set(noteIds.filter(Boolean)));
    for (const noteId of uniqueNoteIds) {
      const node = findElementByVerovioId(container, noteId);
      if (!node) {
        continue;
      }
      node.classList.remove(...this.annotationClasses);
      node.classList.add(className);
      this.annotatedNoteIds.push(noteId);
    }
  }
}
