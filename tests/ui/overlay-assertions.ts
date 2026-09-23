import { expect, type Locator } from '@playwright/test';

// Keep overlay geometry and hit-testing in one place. A visible popup can still
// be detached from its trigger, outside the viewport, or behind another layer.
export async function expectAnchoredOverlay(popup: Locator, anchor: Locator) {
  await expect(popup).toBeVisible();
  const anchorElement = await anchor.elementHandle();
  if (!anchorElement) throw new Error('Overlay anchor is not mounted');
  await expect.poll(() => popup.evaluate((element, trigger) => {
    const rect = element.getBoundingClientRect();
    const origin = trigger!.getBoundingClientRect();
    const horizontalGap = Math.max(0, origin.left - rect.right, rect.left - origin.right);
    const verticalGap = Math.max(0, origin.top - rect.bottom, rect.top - origin.bottom);
    const points = [
      [rect.left + 8, rect.top + 8],
      [rect.right - 8, rect.top + 8],
      [rect.left + 8, rect.bottom - 8],
      [rect.right - 8, rect.bottom - 8],
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
    ];
    return {
      inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
      anchored: horizontalGap <= 16 && verticalGap <= 16,
      reachable: points.every(([x, y]) => element.contains(document.elementFromPoint(x, y))),
    };
  }, anchorElement), { message: 'Menu must stay beside its trigger, within the viewport, and above other content' })
    .toEqual({ inViewport: true, anchored: true, reachable: true });
  await anchorElement.dispose();
}
