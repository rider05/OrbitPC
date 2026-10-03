import { PlannedScreen } from '../src/components/PlannedScreen';
export default function FilesScreen() {
  return (
    <PlannedScreen
      title="Files"
      subtitle="Planned in OrbitPC_Complete_Plan §17."
      note="Approved-folder file browsing and chunked/resumable transfers require file.list / file.upload / file.download, which are post-MVP. The filesystem is default-deny: no entry in the catalog yet."
    />
  );
}
