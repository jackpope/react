import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import {createTracingCallbacks} from './dashboard/TracingDashboard';

if (typeof React.unstable_TracingMarker === 'undefined') {
  document.getElementById('root').innerHTML =
    '<div style="padding:2rem;font-family:sans-serif">' +
    '<h1>Feature Not Enabled</h1>' +
    '<p><code>enableTransitionTracing</code> is not enabled in this build.</p>' +
    '<p>Run <code>yarn build-for-tt-dev</code> from the repo root first.</p>' +
    '</div>';
} else {
  const {callbacks, eventEmitter} = createTracingCallbacks();

  const root = createRoot(document.getElementById('root'), {
    unstable_transitionCallbacks: callbacks,
  });

  root.render(<App eventEmitter={eventEmitter} />);
}
