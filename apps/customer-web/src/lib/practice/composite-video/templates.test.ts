import { expect, it } from "vitest";
import { getCompositeVideoLayout } from "./templates";
it.each(["landscape", "portrait"] as const)(
  "separates VIDEO panels in %s",
  (orientation) => {
    const layout = getCompositeVideoLayout({ orientation }, "VIDEO");
    expect(layout.kind).toBe("SCORE_AND_VIDEO");
    if (layout.kind !== "SCORE_AND_VIDEO")
      throw new Error("Expected video panels");
    expect([layout.width, layout.height]).toEqual(
      orientation === "landscape" ? [1280, 720] : [720, 1280],
    );
    expect(layout.videoRect.width).toBeGreaterThan(0);
    expect(
      orientation === "landscape"
        ? layout.scoreRect.x + layout.scoreRect.width < layout.videoRect.x
        : layout.scoreRect.y + layout.scoreRect.height < layout.videoRect.y,
    ).toBe(true);
  },
);
it.each(["landscape", "portrait"] as const)(
  "gives AUDIO the whole score canvas in %s",
  (orientation) => {
    const layout = getCompositeVideoLayout({ orientation }, "AUDIO");
    expect(layout.kind).toBe("SCORE_ONLY");
    expect(layout).not.toHaveProperty("videoRect");
    expect(layout.scoreRect.width).toBe(layout.width - 48);
    expect(layout.scoreRect.height).toBe(layout.height - 48);
  },
);
