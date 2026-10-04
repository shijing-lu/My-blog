import { Easing, interpolate, spring } from "remotion";

export const C = {
  ink: "#141413",
  cream: "#faf9f5",
  orange: "#b3542d",
  copper: "#e08b6e",
  line: "#e3ddd1",
  muted: "#8a837a",
  sage: "#8faf94",
  violet: "#a99cc9",
};
export const SERIF = "WenKai, Microsoft YaHei, sans-serif";
export const SANS = "Microsoft YaHei, Arial, sans-serif";
export const MONO = "Consolas, monospace";
export const ease = Easing.bezier(0.16, 1, 0.3, 1);
export const lerp = (f: number, range: number[], values: number[]) =>
  interpolate(f, range, values, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
export const arrive = (f: number, delay = 0) =>
  spring({
    fps: 30,
    frame: f - delay,
    config: { damping: 24, stiffness: 110, mass: 0.85 },
  });
