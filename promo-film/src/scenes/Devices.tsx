import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import {
  Browser,
  Grid,
  HomeSurface,
  Photo,
  SceneStamp,
  Tag,
  Title,
} from "../Elements";
import { C, MONO, SERIF, arrive, lerp } from "../style";

export const Devices = () => {
  const f = useCurrentFrame();
  const dark = f > 80;
  return (
    <AbsoluteFill style={{ background: C.cream, overflow: "hidden" }}>
      <Grid />
      <div style={{ position: "absolute", top: 86, left: 115 }}>
        <Tag>DESIGNED FOR YOU / 主题与阅读</Tag>
        <Title size={91} delay={5} style={{ marginTop: 24 }}>
          大屏，小屏，都是你的世界。
        </Title>
      </div>
      <div
        style={{
          position: "absolute",
          left: 185,
          top: 346,
          transform: `perspective(2200px) rotateY(${lerp(f, [0, 160], [-10, 0])}deg)`,
          translate: `0px ${(1 - arrive(f, 12)) * 100}px`,
          opacity: lerp(f, [8, 30], [0, 1]),
        }}
      >
        <Browser width={1180} height={606} dark={dark}>
          <HomeSurface dark={dark} compact />
        </Browser>
      </div>
      <div
        style={{
          position: "absolute",
          left: 1385,
          top: 300,
          width: 315,
          height: 646,
          borderRadius: 45,
          background: "#141413",
          border: "8px solid #27241f",
          boxShadow: "0 30px 60px #0004",
          overflow: "hidden",
          translate: `0px ${(1 - arrive(f, 26)) * 180}px`,
          rotate: "5deg",
          opacity: lerp(f, [25, 46], [0, 1]),
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 90,
            top: 12,
            width: 115,
            height: 24,
            borderRadius: 30,
            background: "#0b0a09",
            zIndex: 2,
          }}
        />
        <div
          style={{
            marginTop: 44,
            padding: 18,
            height: 570,
            background: dark ? "#171514" : C.cream,
            color: dark ? C.cream : C.ink,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 24,
              fontFamily: SERIF,
              color: dark ? C.copper : C.orange,
            }}
          >
            白衣卿相<span style={{ fontSize: 27 }}>☰</span>
          </div>
          <div
            style={{
              height: 212,
              marginTop: 22,
              borderRadius: 10,
              overflow: "hidden",
              position: "relative",
            }}
          >
            <Photo
              asset="summit.png"
              style={{ objectPosition: "68% center" }}
            />
            <div
              style={{
                position: "absolute",
                left: 16,
                bottom: 20,
                fontSize: 33,
                lineHeight: 1.3,
                fontFamily: SERIF,
                color: C.cream,
              }}
            >
              心有山海，
              <br />
              笔下有光。
            </div>
          </div>
          <div style={{ fontSize: 26, fontFamily: SERIF, marginTop: 25 }}>
            随时，打开你的世界。
          </div>
          <div
            style={{
              height: 90,
              marginTop: 22,
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <Photo asset="lake.png" />
          </div>
          <div
            style={{
              fontSize: 17,
              color: dark ? "#aaa090" : "#8a837a",
              marginTop: 17,
            }}
          >
            读一点 · 写一点 · 更进一步
          </div>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 1090,
          top: 286,
          display: "flex",
          gap: 13,
        }}
      >
        {[C.cream, C.ink, "#6b8f71", "#476582"].map((c, i) => (
          <div
            key={c}
            style={{
              width: 27,
              height: 27,
              borderRadius: "50%",
              background: c,
              border: `3px solid ${i === (dark ? 1 : 0) ? C.orange : "#bcb7ad"}`,
              scale: arrive(f, 40 + i * 5),
            }}
          />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: 700,
          top: 970,
          fontFamily: MONO,
          fontSize: 19,
          color: C.muted,
          letterSpacing: 4,
        }}
      >
        LIGHT / DARK / YOUR STYLE
      </div>
      <AbsoluteFill
        style={{
          background: C.copper,
          clipPath: `circle(${interpolate(f, [76, 83, 88], [0, 95, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}% at 70% 50%)`,
          opacity: 0.12,
          pointerEvents: "none",
        }}
      />
      <SceneStamp number="07" name="喜欢的界面" />
    </AbsoluteFill>
  );
};
