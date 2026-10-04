import { AbsoluteFill, useCurrentFrame } from "remotion";
import {
  BrandMark,
  Browser,
  Dust,
  Grid,
  HomeSurface,
  SceneStamp,
  Tag,
  Title,
} from "../Elements";
import { C, MONO, SANS, arrive, lerp } from "../style";

export const Identity = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.cream, overflow: "hidden" }}>
      <Grid />
      <div
        style={{
          position: "absolute",
          left: 1040,
          top: -170,
          width: 940,
          height: 940,
          border: "1px solid #b3542d2a",
          borderRadius: "50%",
          scale: lerp(f, [0, 180], [0.85, 1.12]),
        }}
      />
      <div style={{ position: "absolute", left: 115, top: 190, width: 700 }}>
        <BrandMark size={90} />
        <div style={{ marginTop: 32 }}>
          <Tag>YOUR PERSONAL WORLD</Tag>
        </div>
        <Title
          size={148}
          delay={8}
          style={{ marginTop: 26, whiteSpace: "nowrap" }}
        >
          白衣卿相
        </Title>
        <div
          style={{
            fontSize: 42,
            lineHeight: 1.8,
            fontFamily: SANS,
            marginTop: 34,
            color: "#6f6a60",
          }}
        >
          把知识、生活与热爱，
          <br />
          写成自己的故事。
        </div>
        <div
          style={{
            marginTop: 40,
            fontFamily: MONO,
            fontSize: 24,
            letterSpacing: 3,
            color: C.orange,
          }}
        >
          READ. WRITE. LIVE.
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 870,
          top: 210,
          perspective: 1900,
          translate: `${(1 - arrive(f, 10)) * 180}px 0px`,
          opacity: lerp(f, [6, 26], [0, 1]),
        }}
      >
        <Browser
          width={1180}
          height={656}
          style={{
            transform: `rotateY(${lerp(f, [0, 100], [-22, -12])}deg) rotateZ(-3deg) scale(0.94)`,
            transformOrigin: "left center",
          }}
        >
          <HomeSurface />
        </Browser>
      </div>
      <Dust />
      <SceneStamp number="01" name="个人博客" />
    </AbsoluteFill>
  );
};
