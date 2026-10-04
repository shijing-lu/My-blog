import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Dust, Grid, SceneStamp, SectionText } from "../Elements";
import { C, MONO, SANS, SERIF, arrive, lerp } from "../style";

const nodes = [
  {
    x: 760,
    y: 160,
    w: 430,
    h: 180,
    title: "微积分 · 从直觉到证明",
    type: "数学讲义",
    body: "∫ f(x) dx  →  F(x) + C",
    c: C.copper,
  },
  {
    x: 1220,
    y: 145,
    w: 440,
    h: 205,
    title: "理解算法背后的逻辑",
    type: "技术教程",
    body: "输入 → 思考 → 清晰的解法",
    c: C.sage,
  },
  {
    x: 1390,
    y: 485,
    w: 380,
    h: 195,
    title: "知识，有迹可循",
    type: "归档 · 标签",
    body: "主题 / 时间 / 全站搜索",
    c: C.violet,
  },
  {
    x: 700,
    y: 590,
    w: 490,
    h: 205,
    title: "连接每一个新发现",
    type: "学习笔记",
    body: "灵感 → 记录 → 更深的理解",
    c: C.copper,
  },
];
export const Knowledge = () => {
  const f = useCurrentFrame();
  const progress = lerp(f, [20, 105], [0, 1]);
  return (
    <AbsoluteFill
      style={{ background: C.ink, color: C.cream, overflow: "hidden" }}
    >
      <Grid light />
      <Dust light />
      <SectionText
        light
        kicker="KNOWLEDGE / 知识"
        title={
          <>
            让知识，
            <br />
            彼此相连。
          </>
        }
        description={
          <>
            技术教程 · 数学讲义
            <br />
            学习笔记 · 标签归档
          </>
        }
      />
      <svg
        width="1920"
        height="1080"
        style={{ position: "absolute", inset: 0 }}
      >
        <defs>
          <linearGradient id="flow" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor={C.copper} />
            <stop offset="1" stopColor={C.sage} />
          </linearGradient>
        </defs>
        {[
          "M975 335 Q1050 445 1195 465",
          "M1420 355 Q1360 400 1195 465",
          "M1400 580 Q1250 570 1195 465",
          "M945 600 Q1010 470 1195 465",
        ].map((d, i) => (
          <path
            key={d}
            d={d}
            fill="none"
            stroke="url(#flow)"
            strokeWidth={3}
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - lerp(f, [25 + i * 7, 90 + i * 7], [0, 1])}
            opacity={0.7}
          />
        ))}
        <circle
          cx={1195}
          cy={465}
          r={73 + Math.sin(f / 20) * 4}
          fill="#b3542d16"
          stroke="#e08b6e80"
          strokeWidth="2"
        />
        <circle cx={1195} cy={465} r="52" fill={C.copper} />
      </svg>
      <div
        style={{
          position: "absolute",
          left: 1158,
          top: 425,
          width: 80,
          textAlign: "center",
          fontSize: 55,
          color: C.ink,
          fontFamily: SERIF,
          fontWeight: 700,
          opacity: progress,
        }}
      >
        知
      </div>
      {nodes.map((n, i) => (
        <div
          key={n.title}
          style={{
            position: "absolute",
            left: n.x,
            top: n.y,
            width: n.w,
            height: n.h,
            padding: 30,
            boxSizing: "border-box",
            border: `1px solid ${n.c}55`,
            borderRadius: 16,
            background: "#23201dec",
            boxShadow: "0 18px 60px #0006",
            opacity: lerp(f, [10 + i * 8, 30 + i * 8], [0, 1]),
            translate: `0px ${(1 - arrive(f, 10 + i * 8)) * 85 + Math.sin(f / 50 + i) * 6}px`,
            rotate: `${(1 - arrive(f, 10 + i * 8)) * 4}deg`,
          }}
        >
          <div
            style={{
              fontFamily: MONO,
              fontSize: 19,
              letterSpacing: 3,
              color: n.c,
              marginBottom: 17,
            }}
          >
            {n.type}
          </div>
          <div style={{ fontFamily: SERIF, fontSize: 34, color: C.cream }}>
            {n.title}
          </div>
          <div
            style={{
              fontSize: 23,
              fontFamily: SANS,
              color: "#b9afa2",
              marginTop: 17,
            }}
          >
            {n.body}
          </div>
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          left: 930,
          top: 845,
          width: 770,
          height: 64,
          borderBottom: "1px solid #ffffff30",
          fontFamily: SANS,
          fontSize: 28,
          display: "flex",
          gap: 22,
          color: "#d8cabc",
          alignItems: "center",
          opacity: lerp(f, [125, 145], [0, 1]),
        }}
      >
        <span style={{ color: C.copper, fontSize: 35 }}>⌕</span>
        <span>
          {"搜索：" +
            "找到属于你的答案".slice(0, Math.max(0, Math.floor((f - 128) / 3)))}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: MONO,
            fontSize: 20,
            color: C.muted,
          }}
        >
          SEARCH ↵
        </span>
      </div>
      <SceneStamp number="02" name="知识与阅读" light />
    </AbsoluteFill>
  );
};
