import React, {Suspense} from 'react';
import {useData} from '../hooks/useSimulatedDelay';
import {getDelay} from '../data/fakeApi';
import styles from './CpuSuspensePage.module.css';

const TracingMarker = React.unstable_TracingMarker;

function HeavyContent() {
  // Simulate CPU-heavy synchronous rendering. The delay is configurable
  // via the Delay Config panel (cpuRenderWork). This blocks the render
  // thread — exactly the scenario CPU Suspense is designed to handle by
  // deferring to a retry lane so the fallback paints first.
  const ms = getDelay('cpuRenderWork');
  const start = performance.now();
  while (performance.now() - start < ms) {
    // busy wait — simulates expensive computation during render
  }

  const items = [];
  for (let i = 0; i < 20; i++) {
    items.push(
      <div key={i} className={styles.gridItem}>
        Item {i + 1}
      </div>
    );
  }
  return (
    <div className={styles.section}>
      <h3>Deferred Content ({ms}ms render work)</h3>
      <p>
        This content was inside a <code>{'<Suspense defer>'}</code> boundary.
        React showed the fallback first, then rendered these children on a
        retry lane after {ms}ms of synchronous work.
      </p>
      <div className={styles.grid}>{items}</div>
    </div>
  );
}

function AsyncContent() {
  const data = useData('cpuHeavyData', 'default');
  return (
    <div className={styles.section}>
      <h3>Async Content</h3>
      <p>
        This content is inside a regular <code>{'<Suspense>'}</code> boundary
        with data fetching. Compare its loading time in the event log against
        the deferred boundary above.
      </p>
      <p className={styles.meta}>
        Loaded at {new Date(data.loadedAt).toLocaleTimeString()}
      </p>
    </div>
  );
}

export default function CpuSuspensePage() {
  return (
    <div className={styles.page}>
      <h1>CPU Suspense</h1>
      <p className={styles.description}>
        <code>{'<Suspense defer>'}</code> tells React to show the fallback
        first and render children on a retry lane. This is for CPU-heavy
        synchronous subtrees that shouldn't block the initial paint — not for
        data fetching.
      </p>
      <p className={styles.description}>
        Because the retry renders synchronous content, the deferred boundary
        resolves almost immediately. In the event log, the{' '}
        <code>cpu:deferred-section</code> marker completes nearly instantly
        while the <code>cpu:async-section</code> marker stays pending until
        data loads — showing the difference between CPU deferral and data
        fetching.
      </p>
      <TracingMarker name="cpu-suspense">
        <TracingMarker name="cpu:deferred-section">
          <Suspense
            defer
            name="cpu:deferred"
            fallback={
              <div className={styles.meta}>Deferring heavy content...</div>
            }>
            <HeavyContent />
          </Suspense>
        </TracingMarker>

        <TracingMarker name="cpu:async-section">
          <Suspense
            name="cpu:async-data"
            fallback={
              <div className={styles.meta}>Loading async data...</div>
            }>
            <AsyncContent />
          </Suspense>
        </TracingMarker>
      </TracingMarker>
    </div>
  );
}
