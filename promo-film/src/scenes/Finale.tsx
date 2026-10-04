import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { BrandMark, Dust, Photo } from "../Elements";
import { C, MONO, SANS, SERIF, lerp } from "../style";

export const Finale = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{ background: C.ink, color: C.cream, overflow: "hidden" }}
    >
      <Photo
        asset="summit.png"
        style={{ scale: interpolate(f, [0, 174], [1.15, 1.02]) }}
      />
      <AbsoluteFill
        style={{
          background: "linear-gradient(0deg,#141413e8,#14141335 65%,#141413a0)",
        }}
      />
      <Dust light />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          opacity: lerp(f, [3, 22], [0, 1]),
          translate: `0px ${lerp(f, [0, 37], [65, 0])}px`,
        }}
      >
        <BrandMark size={80} />
        <div
          style={{
            fontFamily: MONO,
            fontSize: 26,
            letterSpacing: 9,
            color: "#e7c2a5",
            marginTop: 26,
          }}
        >
          YOUR PERSONAL WORLD
        </div>
        <div
          style={{
            fontFamily: SERIF,
            fontSize: 220,
            fontWeight: 700,
            lineHeight: 1.2,
            letterSpacing: 16,
            marginTop: 20,
            textShadow: "0 8px 40px #0007",
          }}
        >
          白衣卿相
        </div>
        <div
          style={{
            height: 4,
            width: lerp(f, [26, 60], [0, 570]),
            background: C.copper,
            marginTop: 20,
          }}
        />
        <div
          style={{
            fontFamily: SERIF,
            fontSize: 61,
            marginTop: 32,
            letterSpacing: 4,
          }}
        >
          把思考，变成自己的世界。
        </div>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 31,
            color: "#c9bdac",
            letterSpacing: 6,
            marginTop: 34,
          }}
        >
          从一次记录开始。
        </div>
      </div>
      <AbsoluteFill
        style={{ background: C.ink, opacity: lerp(f, [157, 173], [0, 0.65]) }}
      />
    </AbsoluteFill>
  );
};

export const Poster = () => (
  <AbsoluteFill style={{ background: C.ink, color: C.cream }}>
    <Photo asset="summit.png" />
    <AbsoluteFill
      style={{ background: "linear-gradient(0deg,#141413d0,#14141315 75%)" }}
    />
    <div
      style={{
        position: "absolute",
        left: 115,
        top: 128,
        fontFamily: MONO,
        fontSize: 25,
        letterSpacing: 6,
        color: C.copper,
      }}
    >
      PERSONAL WORLD / 2026
    </div>
    <div style={{ position: "absolute", left: 108, bottom: 130 }}>
      <div
        style={{
          fontFamily: SERIF,
          fontSize: 185,
          fontWeight: 700,
          lineHeight: 1.2,
        }}
      >
        白衣卿相
      </div>
      <div
        style={{
          width: 540,
          height: 5,
          background: C.copper,
          margin: "20px 0 27px",
        }}
      />
      <div style={{ fontFamily: SERIF, fontSize: 64 }}>
        把思考，变成自己的世界。
      </div>
      <div
        style={{
          fontFamily: SANS,
          fontSize: 31,
          color: "#d3c5b0",
          marginTop: 28,
          letterSpacing: 4,
        }}
      >
        知识 · 写作 · 摄影 · 日程 · 灵感
      </div>
    </div>
    <div style={{ position: "absolute", right: 118, bottom: 140 }}>
      <BrandMark size={106} />
    </div>
  </AbsoluteFill>
);
