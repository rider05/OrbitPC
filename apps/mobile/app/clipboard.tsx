import { PlannedScreen } from '../src/components/PlannedScreen';
export default function ClipboardScreen() {
  return (
    <PlannedScreen
      title="Clipboard"
      subtitle="Planned in OrbitPC_Complete_Plan §18."
      note="Today the one-way clipboard.setText command runs from the dashboard. Full phone↔PC sync (getText, manual/auto sync, no server retention) is post-MVP."
      linkHref="/settings"
      linkLabel="Open dashboard settings"
    />
  );
}
