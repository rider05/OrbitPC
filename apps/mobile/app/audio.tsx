import { PlannedScreen } from '../src/components/PlannedScreen';
export default function AudioScreen() {
  return (
    <PlannedScreen
      title="Audio"
      subtitle="Planned in OrbitPC_Complete_Plan §19."
      note="Media controls (play/pause, volume, mute) and PC→phone audio streaming require audio.start/stop and a real media path (WebRTC/local), both post-MVP."
    />
  );
}
