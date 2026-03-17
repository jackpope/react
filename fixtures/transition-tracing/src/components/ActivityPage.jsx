import React, {Suspense, useState, startTransition} from 'react';
import {useData} from '../hooks/useSimulatedDelay';
import styles from './ActivityPage.module.css';

const TracingMarker = React.unstable_TracingMarker;
const Activity = React.Activity;

function VisibleContent({id}) {
  const data = useData('activityVisible', id);
  return (
    <div className={styles.section}>
      <h3>Visible Content</h3>
      <p>Main content for tab {data.id}</p>
      <p className={styles.meta}>
        Loaded at {new Date(data.loadedAt).toLocaleTimeString()}
      </p>
    </div>
  );
}

function HiddenPanel({id}) {
  const data = useData('activityHidden', id);
  return (
    <div className={styles.section}>
      <h3>Pre-rendered Panel</h3>
      <p>Hidden detail panel for tab {data.id}</p>
      <p className={styles.meta}>
        Loaded at {new Date(data.loadedAt).toLocaleTimeString()}
      </p>
    </div>
  );
}

export default function ActivityPage({eventEmitter}) {
  const [tab, setTab] = useState(1);
  const [panelVisible, setPanelVisible] = useState(false);

  function switchTab(newTab) {
    const name = `switch-to-tab(${newTab})`;
    eventEmitter.emit({
      type: 'user-click',
      label: name,
      timestamp: performance.now(),
    });
    startTransition(
      () => {
        setTab(newTab);
      },
      {name}
    );
  }

  function togglePanel() {
    const name = panelVisible ? 'hide-panel' : 'reveal-panel';
    eventEmitter.emit({
      type: 'user-click',
      label: name,
      timestamp: performance.now(),
    });
    startTransition(
      () => {
        setPanelVisible(prev => !prev);
      },
      {name}
    );
  }

  return (
    <div className={styles.page}>
      <h1>Activity (Pre-rendering &amp; Re-suspension)</h1>
      <p className={styles.description}>
        <strong>First load:</strong> Tab 1 suspends (1s delay). The transition
        tracks the pending Suspense boundary until data loads. Sibling
        prewarming fetches Tab 2 in the background.
      </p>
      <p className={styles.description}>
        <strong>Tab switch:</strong> If the other tab's data is already cached
        (via prewarming), the switch completes instantly. If not, the
        already-resolved Suspense boundary re-suspends — React keeps showing
        old content while the new data loads, and transition tracing tracks
        the full loading time.
      </p>
      <p className={styles.description}>
        <strong>Hidden panel:</strong> Pre-renders inside{' '}
        {'<Activity mode="hidden">'} and does <strong>not</strong> block the
        transition. Click "Reveal Panel" to show it — appears instantly if
        already loaded.
      </p>
      <p className={styles.description}>
        <strong>Concurrent transitions:</strong> Tab switches and panel reveals
        are independent transitions. Switch to Tab 2 and quickly click "Reveal
        Panel" to see two transitions tracked simultaneously in the event log.
      </p>

      <div className={styles.tabBar}>
        <button
          className={tab === 1 ? styles.tabActive : styles.tab}
          onClick={() => switchTab(1)}>
          Tab 1
        </button>
        <button
          className={tab === 2 ? styles.tabActive : styles.tab}
          onClick={() => switchTab(2)}>
          Tab 2
        </button>
        <button className={styles.revealButton} onClick={togglePanel}>
          {panelVisible ? 'Hide Panel' : 'Reveal Panel'}
        </button>
      </div>

      <TracingMarker name="activity-page">
        <Suspense
          name="activity:visible"
          fallback={
            <div className={styles.meta}>Loading visible content...</div>
          }>
          <VisibleContent id={tab} />
        </Suspense>

        <Activity mode={panelVisible ? 'visible' : 'hidden'}>
          <Suspense
            name="activity:hidden-panel"
            fallback={
              <div className={styles.meta}>Loading hidden panel...</div>
            }>
            <HiddenPanel id={tab} />
          </Suspense>
        </Activity>
      </TracingMarker>
    </div>
  );
}
