function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function keepElementInViewport(
  container: HTMLElement,
  element: HTMLElement,
  behavior: ScrollBehavior = 'smooth'
) {
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();

  const containerHeight = container.clientHeight;
  const safeTop = containerRect.top + containerHeight * 0.2;
  const safeBottom = containerRect.top + containerHeight * 0.75;

  if (elementRect.top >= safeTop && elementRect.bottom <= safeBottom) {
    return;
  }

  const offsetWithinContainer = elementRect.top - containerRect.top + container.scrollTop;
  const targetScrollTop = clamp(
    offsetWithinContainer - containerHeight * 0.4,
    0,
    container.scrollHeight
  );

  container.scrollTo({
    top: targetScrollTop,
    behavior,
  });
}

export function focusPageContainer(
  container: HTMLElement,
  pageElement: HTMLElement,
  behavior: ScrollBehavior = 'smooth'
) {
  const containerRect = container.getBoundingClientRect();
  const pageRect = pageElement.getBoundingClientRect();
  const containerHeight = container.clientHeight;

  const offsetWithinContainer = pageRect.top - containerRect.top + container.scrollTop;
  const targetScrollTop = clamp(
    offsetWithinContainer - containerHeight * 0.12,
    0,
    container.scrollHeight
  );

  container.scrollTo({
    top: targetScrollTop,
    behavior,
  });
}

export function getVisibilityRatio(
  container: HTMLElement,
  element: HTMLElement
) {
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();

  const visibleTop = Math.max(containerRect.top, elementRect.top);
  const visibleBottom = Math.min(containerRect.bottom, elementRect.bottom);
  const visibleHeight = Math.max(0, visibleBottom - visibleTop);

  if (elementRect.height <= 0) {
    return 0;
  }

  return visibleHeight / elementRect.height;
}

export function shouldFocusPage(
  container: HTMLElement,
  pageElement: HTMLElement
) {
  return getVisibilityRatio(container, pageElement) < 0.55;
}
