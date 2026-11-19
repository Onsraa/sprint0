import { Composition } from "remotion";
import { DemoVideo } from "./demo/DemoVideo";
import { FPS, HEIGHT, TOTAL_DURATION_IN_FRAMES, WIDTH } from "./demo/data";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="DemoVideo"
      component={DemoVideo}
      durationInFrames={TOTAL_DURATION_IN_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  );
};
