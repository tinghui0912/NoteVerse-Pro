import type { Rect } from "./score-camera";

export type CompositeVideoConfig = Readonly<{
  orientation: "landscape" | "portrait";
}>;
type CanvasLayout = Readonly<{
  width: number;
  height: number;
  scoreRect: Rect;
  background: string;
  scoreBackground: string;
}>;
export type CompositeVideoLayout =
  | (CanvasLayout & Readonly<{ kind: "SCORE_ONLY" }>)
  | (CanvasLayout & Readonly<{ kind: "SCORE_AND_VIDEO"; videoRect: Rect }>);

export function getCompositeVideoLayout(
  config: CompositeVideoConfig,
  sourceKind: "AUDIO" | "VIDEO",
): CompositeVideoLayout {
  const portrait = config.orientation === "portrait";
  const width = portrait ? 720 : 1280,
    height = portrait ? 1280 : 720;
  const common = {
    width,
    height,
    background: "#0f172a",
    scoreBackground: "#ffffff",
  };
  if (sourceKind === "AUDIO")
    return {
      ...common,
      kind: "SCORE_ONLY",
      scoreRect: { x: 24, y: 24, width: width - 48, height: height - 48 },
    };
  if (portrait)
    return {
      ...common,
      kind: "SCORE_AND_VIDEO",
      scoreRect: { x: 24, y: 24, width: width - 48, height: 660 },
      videoRect: { x: 24, y: 708, width: width - 48, height: height - 732 },
    };
  return {
    ...common,
    kind: "SCORE_AND_VIDEO",
    scoreRect: { x: 24, y: 24, width: 704, height: height - 48 },
    videoRect: { x: 752, y: 24, width: width - 776, height: height - 48 },
  };
}
