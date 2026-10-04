import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Browser, Grid, SceneStamp, SectionText, SiteNav } from "../Elements";
import { C, MONO, SANS, SERIF, arrive, lerp } from "../style";

export const Schedule = () => {
  const f = useCurrentFrame();
  const p = lerp(f, [65, 205], [0.13, 0.84]);
  const number = Math.floor(lerp(f, [35, 180], [0, 25]));
  return (
    <AbsoluteFill style={{ background: C.cream, overflow: "hidden" }}>
      <Grid />
      <SectionText
        kicker="FOCUS / 日程"
        size={104}
        title={
          <>
            想法，
            <br />
            也有时间表。
          </>
        }
        description={
          <>
            计划 → 执行 → 复盘
            <br />
            让每一天，向前一步。
          </>
        }
      />
      <div
        style={{
          position: "absolute",
          left: 745,
          top: 145,
          opacity: lerp(f, [0, 25], [0, 1]),
          translate: `${(1 - arrive(f, 8)) * 130}px 0px`,
        }}
      >
        <Browser width={1090} height={785}>
          <SiteNav active="日程" />
          <div style={{ padding: "25px 32px", color: C.ink }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ fontFamily: SERIF, fontSize: 37 }}>
                今天，专注重要的事。
              </div>
              <div style={{ fontFamily: MONO, fontSize: 17, color: C.orange }}>
                TODAY / 站主工作台
              </div>
            </div>
            <div style={{ display: "flex", gap: 24, marginTop: 28 }}>
              <div
                style={{
                  width: 470,
                  background: "#fff",
                  border: `1px solid ${C.line}`,
                  borderRadius: 13,
                  padding: 24,
                  boxSizing: "border-box",
                }}
              >
                <div
                  style={{ fontSize: 24, fontFamily: SERIF, marginBottom: 24 }}
                >
                  今日时间轴
                </div>
                {[
                  {
                    t: "09:00",
                    title: "深读一章数学讲义",
                    min: "专注 · 60 分钟",
                    color: "#b3542d",
                  },
                  {
                    t: "10:30",
                    title: "写下一个新发现",
                    min: "创作 · 45 分钟",
                    color: "#6b8f71",
                  },
                  {
                    t: "14:00",
                    title: "整理照片与随笔",
                    min: "记录 · 30 分钟",
                    color: "#8a7fbf",
                  },
                ].map((s, i) => (
                  <div
                    key={s.t}
                    style={{
                      display: "flex",
                      gap: 20,
                      marginBottom: 20,
                      translate: `0px ${(1 - arrive(f, 20 + i * 13)) * 32}px`,
                      opacity: lerp(f, [15 + i * 13, 32 + i * 13], [0, 1]),
                    }}
                  >
                    <div
                      style={{
                        fontFamily: MONO,
                        fontSize: 21,
                        color: "#8a837a",
                        paddingTop: 10,
                      }}
                    >
                      {s.t}
                    </div>
                    <div
                      style={{
                        flex: 1,
                        background: `${s.color}12`,
                        borderLeft: `4px solid ${s.color}`,
                        borderRadius: 5,
                        padding: "15px 17px",
                      }}
                    >
                      <div style={{ fontSize: 24, fontFamily: SERIF }}>
                        {s.title}
                      </div>
                      <div
                        style={{ fontSize: 16, color: s.color, marginTop: 10 }}
                      >
                        {s.min}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div
                style={{
                  flex: 1,
                  background: C.ink,
                  color: C.cream,
                  borderRadius: 13,
                  position: "relative",
                  padding: "24px",
                  boxSizing: "border-box",
                }}
              >
                <div
                  style={{
                    fontSize: 22,
                    color: C.copper,
                    fontFamily: MONO,
                    letterSpacing: 3,
                  }}
                >
                  正在专注 / FOCUS
                </div>
                <svg
                  width="350"
                  height="295"
                  style={{ display: "block", margin: "4px auto" }}
                >
                  <circle
                    cx="175"
                    cy="155"
                    r="113"
                    stroke="#ffffff13"
                    strokeWidth="8"
                    fill="none"
                  />
                  <circle
                    cx="175"
                    cy="155"
                    r="113"
                    stroke={C.copper}
                    strokeWidth="8"
                    fill="none"
                    strokeLinecap="round"
                    pathLength="1"
                    strokeDasharray={`${p} 1`}
                    transform="rotate(-90 175 155)"
                  />
                  <text
                    x="175"
                    y="152"
                    textAnchor="middle"
                    fill={C.cream}
                    fontFamily={MONO}
                    fontSize="72"
                  >
                    {String(number).padStart(2, "0")}:00
                  </text>
                  <text
                    x="175"
                    y="197"
                    textAnchor="middle"
                    fill="#aea394"
                    fontSize="23"
                    fontFamily={SANS}
                  >
                    把时间交给热爱
                  </text>
                </svg>
                <div
                  style={{
                    fontSize: 27,
                    textAlign: "center",
                    fontFamily: SERIF,
                  }}
                >
                  一段投入，一点成长。
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    justifyContent: "center",
                    marginTop: 23,
                    fontSize: 20,
                  }}
                >
                  <div
                    style={{
                      padding: "12px 30px",
                      background: "#2b2722",
                      borderRadius: 8,
                    }}
                  >
                    暂停
                  </div>
                  <div
                    style={{
                      padding: "12px 30px",
                      background: C.copper,
                      color: C.ink,
                      borderRadius: 8,
                    }}
                  >
                    结束并复盘
                  </div>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 23, display: "flex", gap: 14 }}>
              {["长期计划", "待办坐标", "专注记录", "周期复盘"].map((t, i) => (
                <div
                  key={t}
                  style={{
                    padding: "12px 24px",
                    background: "#efede4",
                    borderRadius: 100,
                    fontFamily: SANS,
                    fontSize: 20,
                    scale: arrive(f, 105 + i * 9),
                    opacity: lerp(f, [105 + i * 9, 121 + i * 9], [0, 1]),
                  }}
                >
                  {t}
                </div>
              ))}
            </div>
          </div>
        </Browser>
      </div>
      <SceneStamp number="05" name="规划与专注" />
    </AbsoluteFill>
  );
};
