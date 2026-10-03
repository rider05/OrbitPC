import { PlannedScreen } from '../src/components/PlannedScreen';
export default function ActivityScreen() {
  return (
    <PlannedScreen
      title="Activity"
      subtitle="Planned in OrbitPC_Complete_Plan §28 (Activity)."
      note="The dashboard shows the last 20 commands and their uncertain/terminal state. A full audit-events list and filtering (GET /computers/:id/audit) is the next step."
    />
  );
}
