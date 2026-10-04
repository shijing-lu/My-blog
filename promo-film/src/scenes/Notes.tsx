import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Dust, Grid, SceneStamp, Tag, Title } from "../Elements";
import { C, MONO, SANS, SERIF, arrive, lerp } from "../style";

const notes = [
  {
    x: 105,
    y: 150,
    w: 440,
    rot: -9,
    title: "读到一句话",
    body: "继续追问，\n新的发现正在路上。",
    tag: "#阅读 #灵感",
    c: C.copper,
  },
  {
    x: 1290,
    y: 120,
    w: 440,
    rot: 8,
    title: "新的解题思路",
    body: "换一个角度，\n复杂也会变得清晰。",
    tag: "#数学 #思考",
    c: C.sage,
  },
  {
    x: 170,
    y: 620,
    w: 430,
    rot: -5,
    title: "把今天记下来",
    body: "今天的专注，\n是明天的底气。",
    tag: "#日常 #成长",
    c: C.violet,
  },
  {
    x: 1270,
    y: 610,
    w: 440,
    rot: 6,
    title: "黄昏里的光",
    body: "收集一瞬间，\n也收集一种心情。",
    tag: "#摄影 #生活",
    c: C.copper,
  },
];
export const Notes = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{ background: C.ink, color: C.cream, overflow: "hidden" }}
    >
      <Grid light />
      <Dust light />
      <svg
        width="1920"
        height="1080"
        style={{ position: "absolute", inset: 0, opacity: 0.3 }}
      >
        {notes.map((n, i) => (
          <path
            key={i}
            d={`M${n.x + 210} ${n.y + 150} Q960 540 960 540`}
            stroke={n.c}
            strokeWidth="1"
            fill="none"
            pathLength="1"
            strokeDasharray="1"
            strokeDashoffset={1 - lerp(f, [30, 90], [0, 1])}
          />
        ))}
      </svg>
      {notes.map((n, i) => (
        <div
          key={n.title}
          style={{
            position: "absolute",
            left: n.x,
            top: n.y,
            width: n.w,
            padding: 32,
            boxSizing: "border-box",
            background: "#24211e",
            border: `1px solid ${n.c}66`,
            borderRadius: 14,
            boxShadow: "0 24px 70px #0009",
            rotate: `${n.rot * (1 - lerp(f, [20, 180], [0, 0.25]))}deg`,
            opacity: lerp(f, [i * 8, i * 8 + 20], [0, 1]),
            translate: `0px ${(1 - arrive(f, i * 8)) * 100 + Math.sin(f / 38 + i) * 7}px`,
          }}
        >
          <div
            style={{
              fontSize: 18,
              fontFamily: MONO,
              color: "#8a837a",
              letterSpacing: 3,
            }}
          >
            QUICK NOTE / 灵感
          </div>
          <div style={{ fontFamily: SERIF, fontSize: 37, marginTop: 18 }}>
            {n.title}
          </div>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 27,
              lineHeight: 1.75,
              whiteSpace: "pre-line",
              color: "#c3b7a7",
              marginTop: 20,
            }}
          >
            {n.body}
          </div>
          <div
            style={{
              fontSize: 21,
              fontFamily: SANS,
              marginTop: 23,
              color: n.c,
            }}
          >
            {n.tag}
          </div>
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          left: 580,
          right: 580,
          top: 345,
          textAlign: "center",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center" }}>
          <Tag light>CAPTURE / 随心录</Tag>
        </div>
        <Title delay={23} size={88} style={{ marginTop: 32 }}>
          一个念头，
          <br />
          也值得珍藏。
        </Title>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 29,
            color: "#ad9f8d",
            marginTop: 30,
          }}
        >
          随手记录，让灵感有处可归。
        </div>
      </div>
      <SceneStamp number="06" name="灵感与日常" light />
    </AbsoluteFill>
  );
};
