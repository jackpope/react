'use strict';

const fs = require('fs');

const flagsFile = 'packages/shared/ReactFeatureFlags.js';

// Enable the feature flag
const flags = fs.readFileSync(flagsFile, 'utf8');
fs.writeFileSync(
  flagsFile,
  flags.replace(
    'enableTransitionTracing: boolean = false',
    'enableTransitionTracing: boolean = true'
  )
);

// Add TracingMarker to experimental exports if missing
const expFiles = [
  'packages/react/index.experimental.js',
  'packages/react/index.experimental.development.js',
];

for (const expFile of expFiles) {
  const exp = fs.readFileSync(expFile, 'utf8');
  if (!exp.includes('unstable_TracingMarker')) {
    fs.writeFileSync(
      expFile,
      exp.replace(
        'unstable_SuspenseList,',
        'unstable_SuspenseList,\n  unstable_TracingMarker,'
      )
    );
  }
}
