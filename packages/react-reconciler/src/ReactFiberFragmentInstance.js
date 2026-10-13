/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {FragmentInstanceType} from './ReactFiberConfig';
import type {Fiber} from './ReactInternalTypes';

import {
  HostRoot,
  HostComponent,
  HostSingleton,
  HostText,
  Fragment,
} from './ReactWorkTags';
import {
  supportsSingletons,
  commitNewChildToFragmentInstance,
  deleteChildFromFragmentInstance,
  createFragmentInstance,
  updateFragmentInstanceEventHandlers,
} from './ReactFiberConfig';
import {getFragmentEventHandlerProps} from './ReactFiber';

// Syncs a Fragment's committed event handler props to its FragmentInstance so
// the event system can read them at dispatch time. A FragmentInstance is
// created when the Fragment has handlers but no ref has created one yet.
export function commitFragmentEventHandlers(finishedWork: Fiber): void {
  const props = getFragmentEventHandlerProps(finishedWork);
  const existingInstance: null | FragmentInstanceType = finishedWork.stateNode;
  if (existingInstance !== null) {
    updateFragmentInstanceEventHandlers(existingInstance, props);
    return;
  }
  if (props === null) {
    return;
  }
  // Some renderers don't support FragmentInstances and return null here.
  const instance: null | FragmentInstanceType =
    createFragmentInstance(finishedWork);
  if (instance === null) {
    return;
  }
  finishedWork.stateNode = instance;
  // Events are dispatched by walking up from a host node's Fiber, which may be
  // either version of the Fragment, so both need the instance.
  const alternate = finishedWork.alternate;
  if (alternate !== null) {
    alternate.stateNode = instance;
  }
  updateFragmentInstanceEventHandlers(instance, props);
}

export function commitFragmentEventHandlersDeletion(deletedFiber: Fiber): void {
  const instance: null | FragmentInstanceType = deletedFiber.stateNode;
  if (instance !== null) {
    updateFragmentInstanceEventHandlers(instance, null);
  }
}

export function commitNewChildToFragmentInstances(
  fiber: Fiber,
  parentFragmentInstances: null | Array<FragmentInstanceType>,
): void {
  if (
    (fiber.tag !== HostComponent &&
      fiber.tag !== HostSingleton &&
      fiber.tag !== HostText) ||
    // Only run fragment insertion effects for initial insertions
    fiber.alternate !== null ||
    parentFragmentInstances === null
  ) {
    return;
  }
  for (let i = 0; i < parentFragmentInstances.length; i++) {
    const fragmentInstance = parentFragmentInstances[i];
    commitNewChildToFragmentInstance(fiber.stateNode, fragmentInstance);
  }
}

export function commitFragmentInstanceInsertionEffects(fiber: Fiber): void {
  let parent = fiber.return;
  while (parent !== null) {
    if (isFragmentInstanceParent(parent)) {
      const fragmentInstance: FragmentInstanceType = parent.stateNode;
      commitNewChildToFragmentInstance(fiber.stateNode, fragmentInstance);
    }

    if (isFragmentInstanceHostBoundary(parent)) {
      return;
    }

    parent = parent.return;
  }
}

export function commitFragmentInstanceDeletionEffects(fiber: Fiber): void {
  let parent = fiber.return;
  while (parent !== null) {
    if (isFragmentInstanceParent(parent)) {
      const fragmentInstance: FragmentInstanceType = parent.stateNode;
      deleteChildFromFragmentInstance(fiber.stateNode, fragmentInstance);
    }

    if (isFragmentInstanceHostBoundary(parent)) {
      return;
    }

    parent = parent.return;
  }
}

export function getParentFragmentInstances(
  fiber: Fiber,
): null | Array<FragmentInstanceType> {
  let parentFragmentInstances = null;
  let parent = fiber.return;
  while (parent !== null) {
    if (isFragmentInstanceParent(parent)) {
      const fragmentInstance: FragmentInstanceType = parent.stateNode;
      if (parentFragmentInstances === null) {
        parentFragmentInstances = [fragmentInstance];
      } else {
        parentFragmentInstances.push(fragmentInstance);
      }
    }
    if (isFragmentInstanceHostBoundary(parent)) {
      break;
    }
    parent = parent.return;
  }
  return parentFragmentInstances;
}

// HostPortal / HostHoistable are host parents for placement, but not for
// fragment instance ancestry — commit bookkeeping walks past them so it
// matches getFragmentParentInstanceOrContainerFiber. HostSingleton is a
// fragment host boundary (and a collected child) even when it is not a
// placement scope.
function isFragmentInstanceHostBoundary(fiber: Fiber): boolean {
  return (
    fiber.tag === HostComponent ||
    fiber.tag === HostRoot ||
    (supportsSingletons ? fiber.tag === HostSingleton : false)
  );
}

function isFragmentInstanceParent(fiber: Fiber): boolean {
  return fiber && fiber.tag === Fragment && fiber.stateNode !== null;
}
