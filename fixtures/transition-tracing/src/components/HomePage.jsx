import React from 'react';

export default function HomePage() {
  return (
    <div>
      <h1>Transition Tracing</h1>
      <p style={{color: '#8b949e', lineHeight: 1.6, marginBottom: 16}}>
        This fixture demonstrates React's transition tracing API. Navigate
        between pages to see events in the dashboard on the right.
      </p>
      <div style={{color: '#8b949e', fontSize: 13, lineHeight: 1.8}}>
        <p>
          <strong style={{color: '#e6edf3'}}>Profile pages</strong> — Nested
          TracingMarkers, multiple Suspense boundaries, and an independent
          "Load Recommendations" transition. Navigate away while
          recommendations are loading to trigger{' '}
          <code>onMarkerIncomplete</code>.
        </p>
        <p style={{marginTop: 12}}>
          <strong style={{color: '#e6edf3'}}>Search</strong> — Error boundary
          interaction and a "Remove Results" button that unmounts a
          TracingMarker during a pending transition.
        </p>
        <p style={{marginTop: 12}}>
          <strong style={{color: '#e6edf3'}}>Activity</strong> — Re-suspension
          of resolved Suspense boundaries, Activity pre-rendering exclusion,
          and concurrent tab/panel transitions.
        </p>
        <p style={{marginTop: 12}}>
          <strong style={{color: '#e6edf3'}}>CPU Suspense</strong> —{' '}
          <code>{'<Suspense defer>'}</code> deferred rendering tracked by
          transition tracing.
        </p>
        <p style={{marginTop: 16, color: '#6e7681', fontSize: 12}}>
          Tip: Click rapidly between profiles to interrupt transitions and see{' '}
          <code>onTransitionIncomplete</code> fire. Adjust simulated delays in
          the dashboard's Delay Config panel.
        </p>
      </div>
    </div>
  );
}
