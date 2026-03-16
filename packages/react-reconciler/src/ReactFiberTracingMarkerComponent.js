/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  TransitionTracingCallbacks,
  Fiber,
  FiberRoot,
} from './ReactInternalTypes';
import type {Transition} from 'react/src/ReactStartTransition';
import type {OffscreenInstance} from './ReactFiberOffscreenComponent';
import type {StackCursor} from './ReactFiberStack';

import {enableTransitionTracing} from 'shared/ReactFeatureFlags';
import {createCursor, push, pop} from './ReactFiberStack';
import {getWorkInProgressTransitions} from './ReactFiberWorkLoop';
import {
  logTransitionTracingStart,
  logTransitionTracingComplete,
  logTransitionTracingIncomplete,
  logMarkerTracingComplete,
  logMarkerTracingIncomplete,
  logMarkerTracingProgress,
} from './ReactFiberPerformanceTrack';

export type SuspenseInfo = {name: string | null};

export type PendingTransitionCallbacks = {
  transitionStart: Array<Transition> | null,
  transitionProgress: Map<Transition, PendingBoundaries> | null,
  transitionComplete: Array<Transition> | null,
  transitionIncomplete: Map<
    Transition,
    {aborts: Array<TransitionAbort>},
  > | null,
  markerProgress: Map<
    string,
    {pendingBoundaries: PendingBoundaries, transitions: Set<Transition>},
  > | null,
  markerIncomplete: Map<
    string,
    {aborts: Array<TransitionAbort>, transitions: Set<Transition>},
  > | null,
  markerComplete: Map<string, Set<Transition>> | null,
};

// TODO: Is there a way to not include the tag or name here?
export type TracingMarkerInstance = {
  tag?: TracingMarkerTag,
  transitions: Set<Transition> | null,
  pendingBoundaries: PendingBoundaries | null,
  aborts: Array<TransitionAbort> | null,
  name: string | null,
};

export type TransitionAbort = {
  reason: 'error' | 'unknown' | 'marker' | 'suspense',
  name?: string | null,
  newName?: string | null,
  endTime: number,
  error?: mixed,
  componentStack?: string | null,
};

export const TransitionRoot = 0;
export const TransitionTracingMarker = 1;
export type TracingMarkerTag = 0 | 1;

export type PendingBoundaries = Map<OffscreenInstance, SuspenseInfo>;

export function processTransitionCallbacks(
  pendingTransitions: PendingTransitionCallbacks,
  endTime: number,
  callbacks: TransitionTracingCallbacks,
): void {
  if (enableTransitionTracing) {
    if (pendingTransitions !== null) {
      const transitionStart = pendingTransitions.transitionStart;
      const onTransitionStart = callbacks.onTransitionStart;
      if (transitionStart !== null) {
        transitionStart.forEach(transition => {
          const name = transition.name;
          if (name != null) {
            if (onTransitionStart != null) {
              onTransitionStart(name, transition.startTime);
            }
            logTransitionTracingStart(name, transition.startTime);
          }
        });
      }

      const markerProgress = pendingTransitions.markerProgress;
      const onMarkerProgress = callbacks.onMarkerProgress;
      if (markerProgress !== null) {
        markerProgress.forEach((markerInstance, markerName) => {
          if (markerInstance.transitions !== null) {
            // TODO: Clone the suspense object so users can't modify it
            const pending =
              markerInstance.pendingBoundaries !== null
                ? Array.from(markerInstance.pendingBoundaries.values())
                : [];
            markerInstance.transitions.forEach(transition => {
              const name = transition.name;
              if (name != null) {
                if (onMarkerProgress != null) {
                  onMarkerProgress(
                    name,
                    markerName,
                    transition.startTime,
                    endTime,
                    pending,
                  );
                }
                logMarkerTracingProgress(name, markerName, endTime, pending);
              }
            });
          }
        });
      }

      const markerComplete = pendingTransitions.markerComplete;
      const onMarkerComplete = callbacks.onMarkerComplete;
      if (markerComplete !== null) {
        markerComplete.forEach((transitions, markerName) => {
          transitions.forEach(transition => {
            const name = transition.name;
            if (name != null) {
              if (onMarkerComplete != null) {
                onMarkerComplete(
                  name,
                  markerName,
                  transition.startTime,
                  endTime,
                );
              }
              logMarkerTracingComplete(
                name,
                markerName,
                transition.startTime,
                endTime,
              );
            }
          });
        });
      }

      const markerIncomplete = pendingTransitions.markerIncomplete;
      const onMarkerIncomplete = callbacks.onMarkerIncomplete;
      if (markerIncomplete !== null) {
        markerIncomplete.forEach(({transitions, aborts}, markerName) => {
          transitions.forEach(transition => {
            const filteredAborts: Array<{
              type: string,
              name?: string | null,
              newName?: string | null,
              endTime: number,
              error?: mixed,
              componentStack?: string | null,
            }> = [];
            aborts.forEach(abort => {
              const abortEndTime =
                abort.endTime != null ? abort.endTime : endTime;
              switch (abort.reason) {
                case 'marker': {
                  const deletion: {
                    type: string,
                    name?: string | null,
                    newName?: string | null,
                    endTime: number,
                    error?: mixed,
                    componentStack?: string | null,
                  } = {
                    type: 'marker',
                    name: abort.name,
                    endTime: abortEndTime,
                  };
                  if (abort.newName != null) {
                    deletion.newName = abort.newName;
                  }
                  filteredAborts.push(deletion);
                  break;
                }
                case 'suspense': {
                  filteredAborts.push({
                    type: 'suspense',
                    name: abort.name,
                    endTime: abortEndTime,
                  });
                  break;
                }
                case 'error': {
                  filteredAborts.push({
                    type: 'error',
                    name: abort.name,
                    endTime: abortEndTime,
                    error: abort.error,
                    componentStack: abort.componentStack,
                  });
                  break;
                }
                case 'unknown': {
                  filteredAborts.push({
                    type: 'unknown',
                    name: abort.name,
                    endTime: abortEndTime,
                  });
                  break;
                }
                default: {
                  break;
                }
              }
            });

            const name = transition.name;
            if (name != null) {
              if (filteredAborts.length > 0 && onMarkerIncomplete != null) {
                onMarkerIncomplete(
                  name,
                  markerName,
                  transition.startTime,
                  filteredAborts,
                );
              }
              logMarkerTracingIncomplete(
                name,
                markerName,
                transition.startTime,
                endTime,
              );
            }
          });
        });
      }

      const transitionProgress = pendingTransitions.transitionProgress;
      const onTransitionProgress = callbacks.onTransitionProgress;
      if (onTransitionProgress != null && transitionProgress !== null) {
        transitionProgress.forEach((pending, transition) => {
          if (transition.name != null) {
            onTransitionProgress(
              transition.name,
              transition.startTime,
              endTime,
              Array.from(pending.values()),
            );
          }
        });
      }

      const transitionComplete = pendingTransitions.transitionComplete;
      const onTransitionComplete = callbacks.onTransitionComplete;
      if (transitionComplete !== null) {
        transitionComplete.forEach(transition => {
          const name = transition.name;
          if (name != null) {
            if (onTransitionComplete != null) {
              onTransitionComplete(name, transition.startTime, endTime);
            }
            logTransitionTracingComplete(name, transition.startTime, endTime);
          }
        });
      }

      const transitionIncomplete = pendingTransitions.transitionIncomplete;
      const onTransitionIncomplete = callbacks.onTransitionIncomplete;
      if (transitionIncomplete !== null) {
        transitionIncomplete.forEach(({aborts}, transition) => {
          const name = transition.name;
          if (name != null) {
            const filteredAborts: Array<{
              type: string,
              name?: string | null,
              newName?: string | null,
              endTime: number,
              error?: mixed,
              componentStack?: string | null,
            }> = [];
            aborts.forEach(abort => {
              const abortEndTime =
                abort.endTime != null ? abort.endTime : endTime;
              switch (abort.reason) {
                case 'marker': {
                  const deletion: {
                    type: string,
                    name?: string | null,
                    newName?: string | null,
                    endTime: number,
                    error?: mixed,
                    componentStack?: string | null,
                  } = {
                    type: 'marker',
                    name: abort.name,
                    endTime: abortEndTime,
                  };
                  if (abort.newName != null) {
                    deletion.newName = abort.newName;
                  }
                  filteredAborts.push(deletion);
                  break;
                }
                case 'suspense': {
                  filteredAborts.push({
                    type: 'suspense',
                    name: abort.name,
                    endTime: abortEndTime,
                  });
                  break;
                }
                case 'error': {
                  filteredAborts.push({
                    type: 'error',
                    name: abort.name,
                    endTime: abortEndTime,
                    error: abort.error,
                    componentStack: abort.componentStack,
                  });
                  break;
                }
                case 'unknown': {
                  filteredAborts.push({
                    type: 'unknown',
                    name: abort.name,
                    endTime: abortEndTime,
                  });
                  break;
                }
                default: {
                  break;
                }
              }
            });

            if (filteredAborts.length > 0 && onTransitionIncomplete != null) {
              onTransitionIncomplete(
                name,
                transition.startTime,
                filteredAborts,
              );
            }
            logTransitionTracingIncomplete(name, transition.startTime, endTime);
          }
        });
      }
    }
  }
}

// For every tracing marker, store a pointer to it. We will later access it
// to get the set of suspense boundaries that need to resolve before the
// tracing marker can be logged as complete
// This code lives separate from the ReactFiberTransition code because
// we push and pop on the tracing marker, not the suspense boundary
const markerInstanceStack: StackCursor<Array<TracingMarkerInstance> | null> =
  createCursor(null);

export function pushRootMarkerInstance(workInProgress: Fiber): void {
  if (enableTransitionTracing) {
    // On the root, every transition gets mapped to it's own map of
    // suspense boundaries. The transition is marked as complete when
    // the suspense boundaries map is empty. We do this because every
    // transition completes at different times and depends on different
    // suspense boundaries to complete. We store all the transitions
    // along with its map of suspense boundaries in the root incomplete
    // transitions map. Each entry in this map functions like a tracing
    // marker does, so we can push it onto the marker instance stack
    const transitions = getWorkInProgressTransitions();
    const root: FiberRoot = workInProgress.stateNode;

    if (transitions !== null) {
      transitions.forEach(transition => {
        if (!root.incompleteTransitions.has(transition)) {
          const markerInstance: TracingMarkerInstance = {
            tag: TransitionRoot,
            transitions: new Set([transition]),
            pendingBoundaries: null,
            aborts: null,
            name: null,
          };
          root.incompleteTransitions.set(transition, markerInstance);
        }
      });
    }

    const markerInstances = [];
    // Push marker instances onto the stack. When rendering with specific
    // transitions, only push markers for those transitions to avoid
    // cross-attribution. When rendering without transitions (e.g., a
    // setState that deletes a Suspense boundary), push all incomplete
    // markers so deletion handlers can find them on the stack.
    if (transitions !== null) {
      transitions.forEach(transition => {
        const markerInstance = root.incompleteTransitions.get(transition);
        if (markerInstance != null) {
          markerInstances.push(markerInstance);
        }
      });
    } else {
      root.incompleteTransitions.forEach(markerInstance => {
        markerInstances.push(markerInstance);
      });
    }
    push(markerInstanceStack, markerInstances, workInProgress);
  }
}

export function popRootMarkerInstance(workInProgress: Fiber) {
  if (enableTransitionTracing) {
    pop(markerInstanceStack, workInProgress);
  }
}

export function pushMarkerInstance(
  workInProgress: Fiber,
  markerInstance: TracingMarkerInstance,
): void {
  if (enableTransitionTracing) {
    if (markerInstanceStack.current === null) {
      push(markerInstanceStack, [markerInstance], workInProgress);
    } else {
      push(
        markerInstanceStack,
        markerInstanceStack.current.concat(markerInstance),
        workInProgress,
      );
    }
  }
}

export function popMarkerInstance(workInProgress: Fiber): void {
  if (enableTransitionTracing) {
    pop(markerInstanceStack, workInProgress);
  }
}

export function getMarkerInstances(): Array<TracingMarkerInstance> | null {
  if (enableTransitionTracing) {
    return markerInstanceStack.current;
  }
  return null;
}
