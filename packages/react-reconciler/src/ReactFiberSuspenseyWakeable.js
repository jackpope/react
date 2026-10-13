/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Wakeable} from 'shared/ReactTypes';
import type {Fiber} from './ReactInternalTypes';
import type {Lanes} from './ReactFiberLane';
import type {SuspendedState} from './ReactFiberConfig';

import {HostComponent, OffscreenComponent} from './ReactWorkTags';
import {NoFlags, MaySuspendCommit} from './ReactFiberFlags';
import {includesOnlySuspenseyCommitEligibleLanes} from './ReactFiberLane';
import {
  maySuspendCommitInSyncRender,
  preloadInstance,
  startSuspendingCommit,
  suspendInstance,
  waitForCommitToBeReady,
} from './ReactFiberConfig';

const suspenseyWakeables: WeakSet<Wakeable> = new WeakSet();

export function includesSuspenseyInstancesWakeable(
  wakeables: Set<Wakeable>,
): boolean {
  let found = false;
  wakeables.forEach(wakeable => {
    if (suspenseyWakeables.has(wakeable)) {
      found = true;
    }
  });
  return found;
}

// Collects the suspensey instances (e.g. images) in a boundary's primary tree
// that would be revealed by this render but aren't ready yet, and returns a
// Wakeable that resolves once the renderer is done waiting on them (loaded,
// errored or timed out). Returns null if nothing needs to be waited on.
//
// This is the render phase counterpart to accumulateSuspenseyCommit. It lets a
// Suspense boundary treat unloaded images like suspended data, so that a
// SuspenseList can decide which rows are ready to reveal.
export function getPendingSuspenseyInstancesWakeable(
  primaryChildFragment: Fiber,
  renderLanes: Lanes,
): null | Wakeable {
  if ((primaryChildFragment.subtreeFlags & MaySuspendCommit) === NoFlags) {
    return null;
  }
  const state = startSuspendingCommit();
  if (
    !accumulatePendingSuspenseyChildren(
      primaryChildFragment,
      renderLanes,
      state,
    )
  ) {
    return null;
  }
  const subscribe = waitForCommitToBeReady(state, 0);
  if (subscribe === null) {
    return null;
  }
  let listeners: null | Array<() => mixed> = [];
  subscribe(() => {
    const pendingListeners = listeners;
    listeners = null;
    if (pendingListeners !== null) {
      for (let i = 0; i < pendingListeners.length; i++) {
        pendingListeners[i]();
      }
    }
  });
  const wakeable: Wakeable = {
    then(onFulfill: () => mixed, onReject: () => mixed): void {
      if (listeners === null) {
        onFulfill();
      } else {
        listeners.push(onFulfill);
      }
    },
  };
  suspenseyWakeables.add(wakeable);
  return wakeable;
}

function accumulatePendingSuspenseyChildren(
  parentFiber: Fiber,
  renderLanes: Lanes,
  state: SuspendedState,
): boolean {
  let hasPending = false;
  let child = parentFiber.child;
  while (child !== null) {
    if (accumulatePendingSuspenseyFiber(child, renderLanes, state)) {
      hasPending = true;
    }
    child = child.sibling;
  }
  return hasPending;
}

function accumulatePendingSuspenseyFiber(
  fiber: Fiber,
  renderLanes: Lanes,
  state: SuspendedState,
): boolean {
  if (fiber.tag === OffscreenComponent && fiber.memoizedState !== null) {
    // Hidden content doesn't block a reveal.
    return false;
  }
  let hasPending = false;
  if ((fiber.subtreeFlags & MaySuspendCommit) !== NoFlags) {
    hasPending = accumulatePendingSuspenseyChildren(fiber, renderLanes, state);
  }
  if (
    fiber.tag === HostComponent &&
    (fiber.flags & MaySuspendCommit) !== NoFlags
  ) {
    const instance = fiber.stateNode;
    const type = fiber.type;
    const props = fiber.memoizedProps;
    if (
      (includesOnlySuspenseyCommitEligibleLanes(renderLanes) ||
        maySuspendCommitInSyncRender(type, props)) &&
      !preloadInstance(instance, type, props)
    ) {
      suspendInstance(state, instance, type, props);
      hasPending = true;
    }
  }
  return hasPending;
}
