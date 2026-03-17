import React, {useState, useTransition} from 'react';
import styles from './App.module.css';
import NavBar from './components/NavBar';
import HomePage from './components/HomePage';
import ProfilePage from './components/ProfilePage';
import SearchPage from './components/SearchPage';
import ActivityPage from './components/ActivityPage';
import CpuSuspensePage from './components/CpuSuspensePage';
import TracingDashboard from './dashboard/TracingDashboard';
import {clearCache} from './hooks/useSimulatedDelay';

export default function App({eventEmitter}) {
  const [page, setPage] = useState('home');
  const [profileId, setProfileId] = useState(null);
  const [isPending, startTransition] = useTransition();

  function navigate(target, id) {
    eventEmitter.emit({
      type: 'user-click',
      label:
        id !== undefined
          ? `navigate-to-${target}(${id})`
          : `navigate-to-${target}`,
      timestamp: performance.now(),
    });
    clearCache();
    startTransition(
      () => {
        setPage(target);
        if (id !== undefined) {
          setProfileId(id);
        }
      },
      {
        name:
          id !== undefined
            ? `navigate-to-${target}(${id})`
            : `navigate-to-${target}`,
      }
    );
  }

  let content;
  switch (page) {
    case 'profile':
      content = <ProfilePage id={profileId} eventEmitter={eventEmitter} />;
      break;
    case 'search':
      content = <SearchPage />;
      break;
    case 'activity':
      content = <ActivityPage eventEmitter={eventEmitter} />;
      break;
    case 'cpu':
      content = <CpuSuspensePage />;
      break;
    case 'home':
    default:
      content = <HomePage />;
      break;
  }

  return (
    <div className={styles.app}>
      <div className={styles.main}>
        <NavBar
          onNavigate={navigate}
          currentPage={page}
          profileId={profileId}
          isPending={isPending}
        />
        <div
          className={styles.content}
          style={{opacity: isPending ? 0.6 : 1, transition: 'opacity 0.2s'}}>
          {content}
        </div>
      </div>
      <TracingDashboard eventEmitter={eventEmitter} />
    </div>
  );
}
