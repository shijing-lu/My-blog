import {
  MOTION_SCALE,
  type MotionStrength,
  type TextureStrength,
} from "@/cadence/shared/config/appearance";

/** Apply only module-owned attributes; the site theme always stays authoritative. */
export function applyCadenceAppearance(
  root: Pick<HTMLElement, "dataset" | "style">,
  texture: TextureStrength,
  motion: MotionStrength,
): void {
  root.dataset.texture = texture;
  root.dataset.motion = motion;
  root.style.setProperty("--motion-scale", String(MOTION_SCALE[motion]));
}
