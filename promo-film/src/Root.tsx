import { Composition, Folder, Still } from "remotion";
import { Promo } from "./Promo";
import { Intro } from "./scenes/Intro";
import { Identity } from "./scenes/Identity";
import { Knowledge } from "./scenes/Knowledge";
import { Writing } from "./scenes/Writing";
import { Photography } from "./scenes/Photography";
import { Schedule } from "./scenes/Schedule";
import { Notes } from "./scenes/Notes";
import { Devices } from "./scenes/Devices";
import { Finale, Poster } from "./scenes/Finale";

export const RemotionRoot = () => (
  <>
    <Composition
      id="Baiyi-Promo"
      component={Promo}
      width={1920}
      height={1080}
      fps={30}
      durationInFrames={1680}
    />
    <Still id="Baiyi-Poster" component={Poster} width={1920} height={1080} />
    <Folder name="Scenes">
      <Composition
        id="Intro"
        component={Intro}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={180}
      />
      <Composition
        id="Identity"
        component={Identity}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={180}
      />
      <Composition
        id="Knowledge"
        component={Knowledge}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={240}
      />
      <Composition
        id="Writing"
        component={Writing}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={240}
      />
      <Composition
        id="Photography"
        component={Photography}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={210}
      />
      <Composition
        id="Schedule"
        component={Schedule}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={240}
      />
      <Composition
        id="Notes"
        component={Notes}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={180}
      />
      <Composition
        id="Devices"
        component={Devices}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={180}
      />
      <Composition
        id="Finale"
        component={Finale}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={174}
      />
    </Folder>
  </>
);
