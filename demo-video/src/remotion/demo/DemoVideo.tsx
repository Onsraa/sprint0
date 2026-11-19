import { loadFont } from "@remotion/google-fonts/Inter";
import React from "react";
import { AbsoluteFill, Audio, Sequence, Series, staticFile } from "remotion";

loadFont("normal", { weights: ["400", "500", "600", "700"] });
import { Caption } from "./components/Caption";
import { LoopTracker } from "./components/LoopTracker";
import { SCENES } from "./data";
import { A0Title } from "./scenes/A0Title";
import { A1Split } from "./scenes/A1Split";
import { A2Mongo } from "./scenes/A2Mongo";
import { A3Ratify } from "./scenes/A3Ratify";
import { A4Verify } from "./scenes/A4Verify";
import { A5Compound } from "./scenes/A5Compound";
import { A6Close } from "./scenes/A6Close";
import { AnimaticCard } from "./scenes/AnimaticCard";
import { T } from "./theme";

// Scene registry — the architecture explainer. AnimaticCard is the fallback
// for any scene not yet built.
const SCENE_COMPONENTS: Record<
  string,
  React.FC<{ scene: (typeof SCENES)[number]; index: number }>
> = {
  a0: A0Title,
  a1: A1Split,
  a2: A2Mongo,
  a3: A3Ratify,
  a4: A4Verify,
  a5: A5Compound,
  a6: A6Close,
};

export const DemoVideo: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: T.bgBase }}>
      <Series>
        {SCENES.map((scene, index) => {
          const SceneComp = SCENE_COMPONENTS[scene.id] ?? AnimaticCard;
          return (
            <Series.Sequence
              key={scene.id}
              durationInFrames={scene.durationInFrames}
              premountFor={30}
            >
              <SceneComp scene={scene} index={index} />
              <Sequence from={scene.leadFrames} layout="none">
                <Audio src={staticFile(scene.audioFile)} />
              </Sequence>
              {!scene.meta.noCaption && (
                <Caption
                  text={scene.vo}
                  leadFrames={scene.leadFrames}
                  voDurationSec={scene.voDurationSec}
                />
              )}
              <LoopTracker active={scene.meta.stage} />
            </Series.Sequence>
          );
        })}
      </Series>
    </AbsoluteFill>
  );
};
