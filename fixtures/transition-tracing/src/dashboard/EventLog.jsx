import React, {useEffect, useRef} from 'react';
import styles from './EventLog.module.css';

const colorMap = {
  'user-click': '#a371f7',
  'transition-start': '#58a6ff',
  'transition-progress': '#d29922',
  'transition-complete': '#3fb950',
  'marker-progress': '#d29922',
  'marker-complete': '#3fb950',
  'marker-incomplete': '#f85149',
  'transition-incomplete': '#f85149',
};

function formatMs(value) {
  if (value == null) {
    return '';
  }
  return `${Number(value).toFixed(1)}ms`;
}

function EventRow({event}) {
  const color = colorMap[event.type] || '#999';

  const isClick = event.type === 'user-click';
  let nameDisplay = isClick ? event.label : event.name;
  if (event.marker) {
    nameDisplay = `${event.name} > ${event.marker}`;
  }

  let timestamps = '';
  if (event.startTime != null && event.endTime != null) {
    timestamps = `start: ${formatMs(event.startTime)} end: ${formatMs(event.endTime)}`;
  } else if (event.startTime != null && event.currentTime != null) {
    timestamps = `start: ${formatMs(event.startTime)} current: ${formatMs(event.currentTime)}`;
  } else if (event.startTime != null) {
    timestamps = `start: ${formatMs(event.startTime)}`;
  }

  let detail = null;
  if (event.pending && event.pending.length > 0) {
    detail = (
      <span className={styles.pending}>
        pending: [
        {event.pending
          .map(p => (typeof p === 'object' ? p.name : p))
          .join(', ')}
        ]
      </span>
    );
  } else if (event.deletions) {
    detail = (
      <span className={styles.deletions}>
        deletions: {JSON.stringify(event.deletions)}
      </span>
    );
  }

  return (
    <div className={isClick ? styles.clickRow : styles.row}>
      <span className={styles.dot} style={{backgroundColor: color}} />
      <span className={styles.typeLabel} style={{color}}>
        {event.type}
      </span>
      <span className={styles.name}>{nameDisplay}</span>
      <span className={styles.timestamp}>{timestamps}</span>
      <span className={styles.detail}>{detail}</span>
    </div>
  );
}

export default function EventLog({events, onClear}) {
  const bottomRef = useRef(null);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({behavior: 'smooth'});
    }
  }, [events]);

  if (!events || events.length === 0) {
    return (
      <div className={styles.empty}>No transition events recorded yet.</div>
    );
  }

  return (
    <div className={styles.container}>
      {events.map((event, index) => (
        <EventRow key={index} event={event} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
