import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Photo, Viewfinder } from "../Elements";
import { C, MONO, SANS, SERIF, lerp } from "../style";

export const Photography = () => {
  const f = useCurrentFrame();
  const expanded = f > 104;
  return (
    <AbsoluteFill
      style={{ background: C.ink, overflow: "hidden", color: C.cream }}
    >
      <AbsoluteFill>
        <Photo
          asset={expanded ? "lake.png" : "city.png"}
          style={{
            scale: interpolate(f, [0, 210], [1.08, 1.2]),
            objectPosition: "center",
          }}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background: expanded
            ? "linear-gradient(90deg,#14141377,#14141305)"
            : "#14141322",
        }}
      />
      {!expanded && (
        <>
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 630,
              height: 1080,
              overflow: "hidden",
              borderRight: "5px solid #141413",
              translate: `${lerp(f, [0, 35], [-640, 0])}px 0px`,
            }}
          >
            <Photo
              asset="summit.png"
              style={{
                objectPosition: "68% center",
                scale: interpolate(f, [0, 105], [1.12, 1.04]),
              }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              width: 630,
              height: 1080,
              overflow: "hidden",
              borderLeft: "5px solid #141413",
              translate: `${lerp(f, [8, 43], [640, 0])}px 0px`,
            }}
          >
            <Photo
              asset="lake.png"
              style={{
                objectPosition: "65% center",
                scale: interpolate(f, [0, 105], [1.03, 1.14]),
              }}
            />
          </div>
          <AbsoluteFill
            style={{
              background: "linear-gradient(0deg,#141413ac,transparent 85%)",
            }}
          />
        </>
      )}
      <div
        style={{
          position: "absolute",
          left: 120,
          top: expanded ? 315 : 575,
          opacity: lerp(f, [20, 40], [0, 1]),
          translate: `0px ${lerp(f, [20, 55], [50, 0])}px`,
        }}
      >
        <div
          style={{
            fontFamily: MONO,
            fontSize: 24,
            letterSpacing: 7,
            marginBottom: 24,
            color: "#f5d2b4",
          }}
        >
          LIFE / 摄影与随笔
        </div>
        <div
          style={{
            fontFamily: SERIF,
            fontSize: expanded ? 122 : 110,
            lineHeight: 1.2,
            fontWeight: 700,
            textShadow: "0 4px 22px #0005",
          }}
        >
          让生活，
          <br />
          不止发生。
        </div>
        <div
          style={{
            fontFamily: SANS,
            fontSize: 38,
            marginTop: 28,
            letterSpacing: 3,
          }}
        >
          收藏每个值得停留的瞬间。
        </div>
      </div>
      <Viewfinder />
      <div
        style={{
          position: "absolute",
          right: 106,
          bottom: 91,
          fontFamily: MONO,
          fontSize: 21,
          letterSpacing: 4,
        }}
      >
        STORIES / MOMENTS / GALLERY
      </div>
      <AbsoluteFill
        style={{
          background: "#fff9ef",
          opacity: lerp(f, [99, 104, 112], [0, 0.65, 0]),
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
