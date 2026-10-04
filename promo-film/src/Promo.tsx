import { Audio } from "@remotion/media";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { wipe } from "@remotion/transitions/wipe";
import { slide } from "@remotion/transitions/slide";
import { AbsoluteFill, staticFile } from "remotion";
import "./fonts";
import { Intro } from "./scenes/Intro";
import { Identity } from "./scenes/Identity";
import { Knowledge } from "./scenes/Knowledge";
import { Writing } from "./scenes/Writing";
import { Photography } from "./scenes/Photography";
import { Schedule } from "./scenes/Schedule";
import { Notes } from "./scenes/Notes";
import { Devices } from "./scenes/Devices";
import { Finale } from "./scenes/Finale";

export const Promo = () => (
  <AbsoluteFill style={{ background: "#141413" }}>
    <Audio src={staticFile("audio/score.wav")} volume={0.86} />
    <TransitionSeries>
      <TransitionSeries.Sequence name="01 世界很大" durationInFrames={180}>
        <Intro />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={wipe({ direction: "from-left" })}
        timing={linearTiming({ durationInFrames: 18 })}
      />
      <TransitionSeries.Sequence name="02 白衣卿相" durationInFrames={180}>
        <Identity />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: 18 })}
      />
      <TransitionSeries.Sequence name="03 知识相连" durationInFrames={240}>
        <Knowledge />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-bottom" })}
        timing={linearTiming({ durationInFrames: 18 })}
      />
      <TransitionSeries.Sequence name="04 思考与写作" durationInFrames={240}>
        <Writing />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={wipe({ direction: "from-right" })}
        timing={linearTiming({ durationInFrames: 18 })}
      />
      <TransitionSeries.Sequence name="05 生活的片段" durationInFrames={210}>
        <Photography />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: 18 })}
      />
      <TransitionSeries.Sequence name="06 计划执行复盘" durationInFrames={240}>
        <Schedule />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-left" })}
        timing={linearTiming({ durationInFrames: 18 })}
      />
      <TransitionSeries.Sequence name="07 随心录" durationInFrames={180}>
        <Notes />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={wipe({ direction: "from-left" })}
        timing={linearTiming({ durationInFrames: 18 })}
      />
      <TransitionSeries.Sequence name="08 大屏小屏" durationInFrames={180}>
        <Devices />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: 18 })}
      />
      <TransitionSeries.Sequence name="09 自己的世界" durationInFrames={174}>
        <Finale />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);
