import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Browser, Grid, SceneStamp, SectionText, SiteNav } from "../Elements";
import { C, MONO, SANS, SERIF, arrive, lerp } from "../style";

export const Writing = () => {
  const f = useCurrentFrame();
  const rendered = f > 110;
  const typed = "每一次认真记录，都是与未来的自己对话。".slice(
    0,
    Math.max(0, Math.floor((f - 45) / 3)),
  );
  return (
    <AbsoluteFill style={{ background: C.cream, overflow: "hidden" }}>
      <Grid />
      <SectionText
        kicker="CREATE / 写作"
        title={
          <>
            写下来，
            <br />
            就会清晰。
          </>
        }
        description={
          <>
            所见即所得的 Markdown
            <br />
            公式、代码、多栏排版
          </>
        }
      />
      <div
        style={{
          position: "absolute",
          left: 745,
          top: 175,
          translate: `${(1 - arrive(f, 6)) * 180}px 0px`,
          opacity: lerp(f, [6, 25], [0, 1]),
          transform: `perspective(1800px) rotateY(${lerp(f, [0, 160], [-13, -3])}deg)`,
        }}
      >
        <Browser width={1100} height={760}>
          <SiteNav active="文档" />
          <div style={{ height: 616, display: "flex" }}>
            <div
              style={{
                width: 160,
                padding: "27px 20px",
                fontSize: 21,
                lineHeight: 2.7,
                borderRight: `1px solid ${C.line}`,
                color: "#6f6a60",
              }}
            >
              写作台
              <br />
              <span style={{ color: C.orange }}>▤ 我的文章</span>
              <br />▤ 数学讲义
              <br />▤ 学习笔记
              <br />
              <div style={{ marginTop: 34, fontSize: 17, color: C.orange }}>
                + 新建文章
              </div>
            </div>
            <div style={{ padding: "30px 42px", flex: 1 }}>
              <div
                style={{
                  fontSize: 15,
                  color: C.orange,
                  fontFamily: MONO,
                  letterSpacing: 3,
                }}
              >
                DRAFT / 自动保存
              </div>
              <div
                style={{
                  fontSize: 48,
                  fontWeight: 700,
                  fontFamily: SERIF,
                  marginTop: 20,
                  marginBottom: 22,
                }}
              >
                {rendered ? "让思考留下形状" : "# 让思考留下形状"}
              </div>
              <div
                style={{
                  fontSize: 26,
                  lineHeight: 1.7,
                  color: "#6f6a60",
                  height: 48,
                }}
              >
                {typed}
                <span
                  style={{
                    display: "inline-block",
                    width: 2,
                    height: 28,
                    background: C.orange,
                    opacity: Math.floor(f / 12) % 2,
                    verticalAlign: "middle",
                    marginLeft: 3,
                  }}
                />
              </div>
              <div
                style={{
                  height: 105,
                  marginTop: 24,
                  background: "#efede4",
                  borderRadius: 8,
                  padding: "15px 25px",
                  boxSizing: "border-box",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: rendered ? "Lora" : MONO,
                  fontSize: rendered ? 46 : 24,
                  color: C.orange,
                  opacity: lerp(f, [75, 93], [0, 1]),
                }}
              >
                {rendered ? (
                  <span>
                    e<sup style={{ fontSize: 30 }}>iπ</sup> + 1 = 0
                  </span>
                ) : (
                  "$$ e^{i\\pi} + 1 = 0 $$"
                )}
              </div>
              <div
                style={{
                  marginTop: 25,
                  display: "flex",
                  gap: 22,
                  opacity: lerp(f, [98, 115], [0, 1]),
                }}
              >
                <div
                  style={{
                    flex: 1,
                    padding: 22,
                    border: `1px solid ${C.line}`,
                    borderRadius: 8,
                  }}
                >
                  <div style={{ fontFamily: SERIF, fontSize: 30 }}>
                    清晰表达
                  </div>
                  <div
                    style={{
                      fontSize: 21,
                      color: "#6f6a60",
                      lineHeight: 1.9,
                      marginTop: 12,
                    }}
                  >
                    ▸ 组织思路
                    <br />▸ 即时预览
                    <br />▸ 专注创作
                  </div>
                </div>
                <div
                  style={{
                    flex: 1,
                    padding: 22,
                    background: C.ink,
                    color: C.cream,
                    borderRadius: 8,
                    fontFamily: MONO,
                    fontSize: 20,
                    lineHeight: 1.7,
                  }}
                >
                  <span style={{ color: C.copper }}>const</span> ideas = [];
                  <br />
                  <span style={{ color: C.sage }}>write</span>(thought);
                  <br />
                  <span style={{ color: C.violet }}>return</span> clarity;
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 16,
                  color: "#8a837a",
                  marginTop: 23,
                }}
              >
                <span>Markdown · 公式 · 代码 · 多栏</span>
                <span style={{ color: C.orange }}>✓ 已保存</span>
              </div>
            </div>
          </div>
        </Browser>
      </div>
      <div
        style={{
          position: "absolute",
          left: 124,
          top: 760,
          background: C.orange,
          color: "#fff",
          borderRadius: 100,
          padding: "18px 34px",
          fontFamily: SANS,
          fontSize: 29,
          boxShadow: "0 10px 25px #b3542d30",
          scale: arrive(f, 130),
          opacity: lerp(f, [130, 145], [0, 1]),
        }}
      >
        灵感，从此有了落点。
      </div>
      <SceneStamp number="03" name="沉浸式写作" />
    </AbsoluteFill>
  );
};
