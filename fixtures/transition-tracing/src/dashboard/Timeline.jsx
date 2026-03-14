import React, {useMemo} from 'react';
import styles from './Timeline.module.css';

const barColors = {
  complete: '#3fb950',
  incomplete: '#f85149',
  'in-progress': '#58a6ff',
};

function buildTransitions(events) {
  const transitionMap = new Map();
  const clicks = [];

  for (const event of events) {
    if (event.type === 'user-click') {
      clicks.push(event);
      continue;
    }

    const isMarker = event.type.startsWith('marker-');
    if (!isMarker && !event.type.startsWith('transition-')) {
      continue;
    }

    const transitionKey = `${event.name}::${event.startTime}`;

    if (!transitionMap.has(transitionKey)) {
      transitionMap.set(transitionKey, {
        name: event.name,
        startTime: event.startTime,
        endTime: null,
        status: 'in-progress',
        markers: new Map(),
      });
    }

    const transition = transitionMap.get(transitionKey);

    if (isMarker) {
      const markerKey = `${event.marker}::${event.startTime}`;
      if (!transition.markers.has(markerKey)) {
        transition.markers.set(markerKey, {
          name: event.marker,
          startTime: event.startTime,
          endTime: null,
          status: 'in-progress',
        });
      }
      const marker = transition.markers.get(markerKey);
      if (event.type === 'marker-complete') {
        marker.endTime = event.endTime;
        marker.status = 'complete';
      } else if (event.type === 'marker-incomplete') {
        marker.endTime = event.timestamp;
        marker.status = 'incomplete';
      } else if (
        event.type === 'marker-progress' &&
        event.currentTime != null
      ) {
        marker.endTime = event.currentTime;
      }
    } else {
      if (event.type === 'transition-complete') {
        transition.endTime = event.endTime;
        transition.status = 'complete';
      } else if (event.type === 'transition-incomplete') {
        transition.endTime = event.timestamp;
        transition.status = 'incomplete';
      } else if (
        event.type === 'transition-progress' &&
        event.currentTime != null
      ) {
        transition.endTime = event.currentTime;
      }
    }
  }

  return {
    transitions: Array.from(transitionMap.values()),
    clicks,
  };
}

// Fixed scale: 1ms = this many pixels within active regions
const PX_PER_MS = 1;
// Compressed gap width in pixels
const GAP_PX = 28;
// Padding around active regions in ms
const REGION_PADDING_MS = 20;
// Minimum gap in ms before we compress
const MIN_GAP_MS = 50;

function buildTimeMapping(transitions, clicks) {
  // Collect all active time ranges (transitions + click moments)
  const ranges = [];
  for (const t of transitions) {
    const end = t.endTime || t.startTime;
    ranges.push({start: t.startTime, end});
    for (const m of t.markers.values()) {
      const mEnd = m.endTime || m.startTime;
      ranges.push({start: m.startTime, end: mEnd});
    }
  }
  for (const c of clicks) {
    ranges.push({start: c.timestamp, end: c.timestamp});
  }

  if (ranges.length === 0) {
    return {toPixels: () => 0, trackWidth: 0, gaps: []};
  }

  // Add padding and sort
  const padded = ranges
    .map(r => ({
      start: r.start - REGION_PADDING_MS,
      end: r.end + REGION_PADDING_MS,
    }))
    .sort((a, b) => a.start - b.start);

  // Merge overlapping ranges
  const merged = [padded[0]];
  for (let i = 1; i < padded.length; i++) {
    const last = merged[merged.length - 1];
    if (padded[i].start <= last.end + MIN_GAP_MS) {
      last.end = Math.max(last.end, padded[i].end);
    } else {
      merged.push({...padded[i]});
    }
  }

  // Build piecewise mapping: each merged region maps linearly,
  // gaps between regions map to GAP_PX
  const segments = [];
  const gaps = [];
  let pxOffset = 0;

  for (let i = 0; i < merged.length; i++) {
    if (i > 0) {
      const gapStart = merged[i - 1].end;
      const gapEnd = merged[i].start;
      const skippedMs = gapEnd - gapStart;
      gaps.push({px: pxOffset, skippedMs, gapStart, gapEnd});
      pxOffset += GAP_PX;
    }
    const region = merged[i];
    const regionMs = region.end - region.start;
    const regionPx = regionMs * PX_PER_MS;
    segments.push({
      timeStart: region.start,
      timeEnd: region.end,
      pxStart: pxOffset,
      pxEnd: pxOffset + regionPx,
    });
    pxOffset += regionPx;
  }

  const trackWidth = pxOffset;

  function toPixels(time) {
    // Find which segment this time falls into
    for (const seg of segments) {
      if (time <= seg.timeEnd) {
        const t = Math.max(time, seg.timeStart);
        const ratio = (t - seg.timeStart) / (seg.timeEnd - seg.timeStart || 1);
        return seg.pxStart + ratio * (seg.pxEnd - seg.pxStart);
      }
    }
    // Past all segments, clamp to end
    return trackWidth;
  }

  return {toPixels, trackWidth, gaps};
}

function Squiggle() {
  return (
    <svg
      className={styles.squiggle}
      viewBox="0 0 12 24"
      preserveAspectRatio="none">
      <path
        d="M6 0 Q0 4 6 8 Q12 12 6 16 Q0 20 6 24"
        fill="none"
        stroke="#30363d"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function formatDuration(start, end) {
  if (end == null) return '...';
  return `${(end - start).toFixed(1)}ms`;
}

function formatSkipped(ms) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

export default function Timeline({events}) {
  const {transitions, clicks} = useMemo(
    () => buildTransitions(events),
    [events]
  );

  const {toPixels, trackWidth, gaps} = useMemo(
    () => buildTimeMapping(transitions, clicks),
    [transitions, clicks]
  );

  if (transitions.length === 0) {
    return <div className={styles.empty}>No transitions to visualize yet.</div>;
  }

  const rows = [];
  for (const t of transitions) {
    const tEnd = t.endTime || t.startTime;
    rows.push({
      type: 'transition',
      label: t.name,
      left: toPixels(t.startTime),
      width: Math.max(toPixels(tEnd) - toPixels(t.startTime), 3),
      color: barColors[t.status],
      duration: formatDuration(t.startTime, t.endTime),
    });
    for (const m of t.markers.values()) {
      const mEnd = m.endTime || m.startTime;
      rows.push({
        type: 'marker',
        label: m.name,
        left: toPixels(m.startTime),
        width: Math.max(toPixels(mEnd) - toPixels(m.startTime), 3),
        color: barColors[m.status],
        duration: formatDuration(m.startTime, m.endTime),
      });
    }
  }

  const clickPixels = clicks.map(click => ({
    px: toPixels(click.timestamp),
    label: click.label,
  }));

  return (
    <div className={styles.container}>
      <div className={styles.scrollArea}>
        <div className={styles.axis} style={{width: trackWidth}}>
          {clickPixels.map((click, i) => (
            <div
              key={`click-axis-${i}`}
              className={styles.clickTick}
              style={{left: click.px}}
              title={click.label}>
              <span className={styles.clickTickLabel}>{click.label}</span>
            </div>
          ))}
          {gaps.map((gap, i) => (
            <div
              key={`gap-axis-${i}`}
              className={styles.gapAxis}
              style={{left: gap.px, width: GAP_PX}}>
              <Squiggle />
              <span className={styles.gapLabel}>
                {formatSkipped(gap.skippedMs)}
              </span>
            </div>
          ))}
        </div>
        <div className={styles.chart}>
          <div className={styles.trackArea} style={{width: trackWidth}}>
            {clickPixels.map((click, i) => (
              <div
                key={`click-${i}`}
                className={styles.clickLine}
                style={{left: click.px}}
                title={`click: ${click.label}`}
              />
            ))}
            {gaps.map((gap, i) => (
              <div
                key={`gap-${i}`}
                className={styles.gapLine}
                style={{left: gap.px, width: GAP_PX}}>
                <Squiggle />
              </div>
            ))}
          </div>
          {rows.map((row, i) => (
            <div
              key={i}
              className={
                row.type === 'marker' ? styles.markerRow : styles.transitionRow
              }>
              <div className={styles.rowLabel}>
                <span className={styles.rowName}>{row.label}</span>
                <span className={styles.rowDuration}>{row.duration}</span>
              </div>
              <div className={styles.rowTrack} style={{width: trackWidth}}>
                <div
                  className={styles.bar}
                  style={{
                    left: row.left,
                    width: row.width,
                    backgroundColor: row.color,
                  }}
                  title={`${row.label} (${row.duration})`}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
