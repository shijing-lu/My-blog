import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  CanvasImage,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { C, MONO, SANS, SERIF, arrive, lerp } from "./style";

export const Tag = ({
  children,
  light = false,
}: {
  children: ReactNode;
  light?: boolean;
}) => (
  <div
    style={{
      fontFamily: MONO,
      fontSize: 24,
      letterSpacing: 5,
      color: light ? C.copper : C.orange,
      display: "flex",
      alignItems: "center",
      gap: 18,
    }}
  >
    <span
      style={{ width: 10, height: 10, background: light ? C.copper : C.orange }}
    />
    {children}
  </div>
);

export const Title = ({
  children,
  delay = 0,
  size = 118,
  style = {},
}: {
  children: ReactNode;
  delay?: number;
  size?: number;
  style?: CSSProperties;
}) => {
  const f = useCurrentFrame();
  return (
    <div
      style={{
        fontFamily: SERIF,
        fontWeight: 700,
        fontSize: size,
        lineHeight: 1.16,
        letterSpacing: -4,
        opacity: lerp(f, [delay, delay + 18], [0, 1]),
        translate: `0px ${(1 - arrive(f, delay)) * 65}px`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const SceneStamp = ({
  number,
  name,
  light = false,
}: {
  number: string;
  name: string;
  light?: boolean;
}) => (
  <div
    style={{
      position: "absolute",
      bottom: 54,
      left: 110,
      right: 110,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      fontFamily: MONO,
      fontSize: 21,
      letterSpacing: 4,
      color: light ? "#ddd4c4" : C.muted,
    }}
  >
    <span>
      {number} / {name}
    </span>
    <span>白衣卿相 · PERSONAL WORLD</span>
  </div>
);

export const Dust = ({ light = false }: { light?: boolean }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      {Array.from({ length: 65 }, (_, i) => {
        const x = (i * 419.7) % 1920;
        const y = (i * 317.2) % 1080;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x + Math.sin(f / 85 + i) * 32,
              top: (y - f * (0.16 + (i % 3) * 0.05) + 1080) % 1080,
              width: i % 5 === 0 ? 4 : 2,
              height: i % 5 === 0 ? 4 : 2,
              background: light ? C.copper : C.orange,
              borderRadius: "50%",
              opacity: 0.1 + (i % 4) * 0.045,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

export const Grid = ({ light = false }: { light?: boolean }) => (
  <AbsoluteFill
    style={{
      backgroundImage: `linear-gradient(${light ? "#ffffff0a" : "#14141308"} 1px, transparent 1px),linear-gradient(90deg,${light ? "#ffffff0a" : "#14141308"} 1px, transparent 1px)`,
      backgroundSize: "96px 96px",
      maskImage: "radial-gradient(ellipse at center, black, transparent 72%)",
    }}
  />
);

export const BrandMark = ({ size = 72 }: { size?: number }) => (
  <CanvasImage
    src={staticFile("assets/brand.png")}
    style={{ width: size, height: size, borderRadius: size / 6 }}
  />
);

export const Photo = ({
  asset,
  style = {},
}: {
  asset: string;
  style?: CSSProperties;
}) => (
  <CanvasImage
    src={staticFile(`assets/${asset}`)}
    style={{ width: "100%", height: "100%", objectFit: "cover", ...style }}
  />
);

export const SiteNav = ({
  dark = false,
  active = "首页",
}: {
  dark?: boolean;
  active?: string;
}) => (
  <div
    style={{
      height: 62,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 34px",
      borderBottom: `1px solid ${dark ? "#ffffff18" : C.line}`,
      fontFamily: SANS,
      fontSize: 20,
      color: dark ? C.cream : C.ink,
    }}
  >
    <span
      style={{
        color: dark ? C.copper : C.orange,
        fontFamily: SERIF,
        fontSize: 26,
      }}
    >
      白衣卿相
    </span>
    <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
      {["首页", "文档", "影集", "日历", "日程", "动态", "归档"].map((t) => (
        <span
          key={t}
          style={{
            fontWeight: t === active ? 700 : 400,
            color: t === active ? (dark ? C.copper : C.orange) : undefined,
          }}
        >
          {t}
        </span>
      ))}
      <span style={{ marginLeft: 12 }}>◐</span>
    </div>
  </div>
);

export const Browser = ({
  children,
  width = 1180,
  height = 650,
  dark = false,
  style = {},
}: {
  children: ReactNode;
  width?: number;
  height?: number;
  dark?: boolean;
  style?: CSSProperties;
}) => (
  <div
    style={{
      width,
      height,
      borderRadius: 20,
      overflow: "hidden",
      background: dark ? "#1b1917" : C.cream,
      boxShadow: "0 36px 90px #00000030",
      border: `1px solid ${dark ? "#ffffff25" : "#e3ddd1"}`,
      fontFamily: SANS,
      ...style,
    }}
  >
    <div
      style={{
        height: 42,
        background: dark ? "#26221f" : "#eeece5",
        display: "flex",
        alignItems: "center",
        padding: "0 22px",
        gap: 9,
      }}
    >
      {["#dd826a", "#e2b65c", "#8faf94"].map((c) => (
        <span
          key={c}
          style={{ width: 10, height: 10, borderRadius: "50%", background: c }}
        />
      ))}
      <div
        style={{
          marginLeft: 110,
          padding: "4px 120px",
          background: dark ? "#141413" : "#faf9f5",
          borderRadius: 6,
          fontSize: 15,
          color: dark ? "#b3aba0" : "#8a837a",
          letterSpacing: 2,
        }}
      >
        白衣卿相 · 个人博客
      </div>
    </div>
    {children}
  </div>
);

export const HomeSurface = ({
  dark = false,
  compact = false,
}: {
  dark?: boolean;
  compact?: boolean;
}) => {
  const fg = dark ? C.cream : C.ink;
  return (
    <div style={{ color: fg }}>
      <SiteNav dark={dark} />
      <div
        style={{
          margin: compact ? "20px" : "24px 34px",
          height: compact ? 250 : 300,
          borderRadius: 12,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <Photo asset="summit.png" />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(90deg,#141413d0,transparent)",
          }}
        />
        <div
          style={{ position: "absolute", left: 34, top: 58, color: C.cream }}
        >
          <div
            style={{
              fontFamily: SERIF,
              fontSize: compact ? 45 : 66,
              lineHeight: 1.22,
            }}
          >
            心有山海，
            <br />
            笔下有光。
          </div>
          <div style={{ fontSize: 18, marginTop: 22, letterSpacing: 3 }}>
            技术教程 · 学习笔记 · 随笔与摄影
          </div>
        </div>
      </div>
      <div style={{ padding: "0 34px", display: "flex", gap: 20 }}>
        {[
          { title: "让知识彼此相连", tag: "学习笔记", asset: "lake.png" },
          { title: "在日常里发现辽阔", tag: "摄影随笔", asset: "city.png" },
          { title: "把想法排进今天", tag: "日程规划", asset: "summit.png" },
        ].map((a) => (
          <div
            key={a.title}
            style={{
              flex: 1,
              background: dark ? "#24211e" : "#ffffff",
              border: `1px solid ${dark ? "#ffffff15" : C.line}`,
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <div style={{ height: compact ? 66 : 86 }}>
              <Photo asset={a.asset} />
            </div>
            <div
              style={{ padding: "14px 16px", fontSize: 21, fontFamily: SERIF }}
            >
              {a.title}
              <div
                style={{
                  fontSize: 14,
                  marginTop: 8,
                  color: dark ? C.copper : C.orange,
                  fontFamily: SANS,
                }}
              >
                {a.tag}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const SectionText = ({
  kicker,
  title,
  description,
  light = false,
  size = 118,
  style = {},
}: {
  kicker: string;
  title: ReactNode;
  description: ReactNode;
  light?: boolean;
  size?: number;
  style?: CSSProperties;
}) => (
  <div
    style={{
      position: "absolute",
      left: 115,
      top: 125,
      color: light ? C.cream : C.ink,
      ...style,
    }}
  >
    <Tag light={light}>{kicker}</Tag>
    <Title delay={12} size={size} style={{ marginTop: 36 }}>
      {title}
    </Title>
    <div
      style={{
        fontFamily: SANS,
        fontSize: 38,
        lineHeight: 1.7,
        marginTop: 32,
        color: light ? "#c9bfb1" : "#6f6a60",
        maxWidth: 620,
      }}
    >
      {description}
    </div>
  </div>
);

export const Viewfinder = () => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    {[
      { left: 64, top: 64 },
      { right: 64, top: 64 },
      { left: 64, bottom: 64 },
      { right: 64, bottom: 64 },
    ].map((p, i) => (
      <div
        key={i}
        style={{
          position: "absolute",
          ...p,
          width: 44,
          height: 44,
          borderColor: "#ffffff77",
          borderStyle: "solid",
          borderWidth:
            i === 0
              ? "2px 0 0 2px"
              : i === 1
                ? "2px 2px 0 0"
                : i === 2
                  ? "0 0 2px 2px"
                  : "0 2px 2px 0",
        }}
      />
    ))}
    <div
      style={{
        position: "absolute",
        right: 96,
        top: 82,
        fontFamily: MONO,
        fontSize: 22,
        color: "#fff",
        letterSpacing: 4,
      }}
    >
      ◉ LIFE IN FRAMES
    </div>
  </AbsoluteFill>
);

export const Underline = ({
  width = 450,
  delay = 36,
}: {
  width?: number;
  delay?: number;
}) => {
  const f = useCurrentFrame();
  return (
    <div
      style={{
        height: 6,
        width,
        background: C.copper,
        transformOrigin: "left",
        scale: `${interpolate(f, [delay, delay + 28], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} 1`,
      }}
    />
  );
};
