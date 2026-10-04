import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, SANS, SERIF, lerp } from "../style";
import { Dust, Photo } from "../Elements";

export const Intro = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{ background: C.ink, color: C.cream, overflow: "hidden" }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: lerp(f, [40, 68], [0, 1]),
          clipPath: `circle(${lerp(f, [38, 94], [1, 90])}% at 69% 43%)`,
        }}
      >
        <Photo
          asset="summit.png"
          style={{
            scale: interpolate(f, [0, 180], [1.18, 1.02]),
            translate: `${interpolate(f, [0, 180], [-22, 0])}px 0px`,
          }}
        />
      </div>
      <AbsoluteFill
        style={{
          background: "linear-gradient(90deg,#141413b0 0%,#14141305 75%)",
        }}
      />
      <Dust light />
      <div
        style={{
          position: "absolute",
          left: 120,
          top: 215,
          fontFamily: SERIF,
          fontSize: 206,
          fontWeight: 700,
          letterSpacing: -8,
          opacity: lerp(f, [2, 20], [0, 1]) * (1 - lerp(f, [53, 66], [0, 1])),
          translate: `0px ${lerp(f, [0, 28], [60, 0])}px`,
          scale: lerp(f, [0, 64], [0.94, 1.04]),
        }}
      >
        世界很大。
      </div>
      <div
        style={{
          position: "absolute",
          left: 120,
          top: 240,
          opacity: lerp(f, [64, 80], [0, 1]),
          translate: `0px ${lerp(f, [64, 100], [70, 0])}px`,
        }}
      >
        <div
          style={{
            fontFamily: SANS,
            fontSize: 37,
            letterSpacing: 14,
            color: "#e5c7b0",
            marginBottom: 30,
          }}
        >
          每一次思考，都通向远方
        </div>
        <div
          style={{
            fontFamily: SERIF,
            fontSize: 116,
            lineHeight: 1.25,
            fontWeight: 700,
          }}
        >
          给思考，
          <br />
          一个自己的世界。
        </div>
        <div
          style={{
            marginTop: 35,
            width: lerp(f, [86, 130], [0, 430]),
            height: 4,
            background: C.copper,
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 100,
          left: 125,
          fontFamily: "Lora",
          fontSize: 27,
          letterSpacing: 7,
          opacity: lerp(f, [86, 105], [0, 0.75]),
        }}
      >
        A WORLD OF YOUR OWN.
      </div>
    </AbsoluteFill>
  );
};
