import React, {useState, useEffect} from 'react';
import EventLog from './EventLog';
import Timeline from './Timeline';
import styles from './TracingDashboard.module.css';

export function createTracingCallbacks() {
  const eventEmitter = {
    listeners: [],
    subscribe(fn) {
      eventEmitter.listeners.push(fn);
      return () => {
        eventEmitter.listeners = eventEmitter.listeners.filter(l => l !== fn);
      };
    },
    emit(event) {
      eventEmitter.listeners.forEach(fn => fn(event));
    },
  };

  const callbacks = {
    onTransitionStart(name, startTime) {
      eventEmitter.emit({
        type: 'transition-start',
        name,
        startTime,
        timestamp: performance.now(),
      });
    },
    onTransitionProgress(name, startTime, currentTime, pending) {
      eventEmitter.emit({
        type: 'transition-progress',
        name,
        startTime,
        currentTime,
        pending: [...pending],
        timestamp: performance.now(),
      });
    },
    onTransitionComplete(name, startTime, endTime) {
      eventEmitter.emit({
        type: 'transition-complete',
        name,
        startTime,
        endTime,
        timestamp: performance.now(),
      });
    },
    onMarkerProgress(name, marker, startTime, currentTime, pending) {
      eventEmitter.emit({
        type: 'marker-progress',
        name,
        marker,
        startTime,
        currentTime,
        pending: [...pending],
        timestamp: performance.now(),
      });
    },
    onMarkerComplete(name, marker, startTime, endTime) {
      eventEmitter.emit({
        type: 'marker-complete',
        name,
        marker,
        startTime,
        endTime,
        timestamp: performance.now(),
      });
    },
    onMarkerIncomplete(name, marker, startTime, deletions) {
      eventEmitter.emit({
        type: 'marker-incomplete',
        name,
        marker,
        startTime,
        deletions,
        timestamp: performance.now(),
      });
    },
    onTransitionIncomplete(name, startTime, deletions) {
      eventEmitter.emit({
        type: 'transition-incomplete',
        name,
        startTime,
        deletions,
        timestamp: performance.now(),
      });
    },
  };

  return {callbacks, eventEmitter};
}

export default function TracingDashboard({eventEmitter}) {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    if (!eventEmitter) {
      return;
    }
    const unsubscribe = eventEmitter.subscribe(event => {
      setEvents(prev => [...prev, event]);
    });
    return unsubscribe;
  }, [eventEmitter]);

  const handleClear = () => {
    setEvents([]);
  };

  return (
    <div className={styles.container}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <h3 className={styles.title}>Event Log</h3>
          <button className={styles.clearButton} onClick={handleClear}>
            Clear
          </button>
        </div>
        <div className={styles.panelContent}>
          <EventLog events={events} onClear={handleClear} />
        </div>
      </div>
      <div className={styles.panel}>
        <div className={styles.header}>
          <h3 className={styles.title}>Timeline</h3>
        </div>
        <div className={styles.panelContent}>
          <Timeline events={events} />
        </div>
      </div>
    </div>
  );
}
