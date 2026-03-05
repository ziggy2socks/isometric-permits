/**
 * AppShell — top-level shell that renders the shared sidebar
 * alongside whichever view is active (iso or map).
 */
import { usePermits } from './PermitContext';
import PermitSidebar from './PermitSidebar';
import IsoView from './IsoView';
import MapView from './MapView';
import './PermitSidebar.css';

export default function AppShell() {
  const { view } = usePermits();

  return (
    <div className="shell">
      <PermitSidebar />
      <div className="shell-view">
        {view === 'iso' ? <IsoView /> : <MapView />}
      </div>
    </div>
  );
}
