/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from 'react-reconciler/src/ReactInternalTypes';
import type {FragmentInstanceType} from '../client/ReactFiberConfigDOM';

import {
  Fragment,
  HostComponent,
  HostPortal,
  HostRoot,
  HostSingleton,
  HostText,
} from 'react-reconciler/src/ReactWorkTags';

// How the pointer's position relative to Fragments changes in one enter/leave
// transition, beyond what the React tree path between `from` and `to` says.
export type FragmentGapTransition = {
  // Fragments on the leave path that the pointer is still inside of.
  stillInside: null | Set<FragmentInstanceType>,
  // Fragments on the enter path that the pointer was already inside of.
  alreadyInside: null | Set<FragmentInstanceType>,
  // Fragments that are on neither path but get a leave event, innermost first.
  extraLeave: null | Array<FragmentInstanceType>,
};

// For each pointer, the Fragments the pointer is inside of only because it
// moved from one of their host nodes onto their parent host node (a gap
// between their children). Mouse events and each pointerId are tracked
// separately because they dispatch separate enter/leave events.
const pendingLeaves: Map<string, Array<FragmentInstanceType>> = new Map();

function hasEnterLeaveHandler(
  instance: FragmentInstanceType,
  enterName: string,
  leaveName: string,
): boolean {
  const props = instance._eventHandlerProps;
  return (
    props !== null && (props[enterName] != null || props[leaveName] != null)
  );
}

function isMounted(instance: FragmentInstanceType): boolean {
  let node: Fiber = instance._fragmentFiber;
  while (node.return !== null) {
    node = node.return;
  }
  return node.tag === HostRoot;
}

function isFragmentAncestorOf(
  instance: FragmentInstanceType,
  fiber: null | Fiber,
): boolean {
  let node = fiber;
  while (node !== null) {
    if (node.tag === Fragment && node.stateNode === instance) {
      return true;
    }
    node = node.return;
  }
  return false;
}

function getHostNode(fiber: Fiber): null | Node {
  switch (fiber.tag) {
    case HostComponent:
    case HostSingleton:
      return fiber.stateNode;
    case HostRoot:
    case HostPortal:
      return fiber.stateNode.containerInfo;
    default:
      return null;
  }
}

// Fragments that are ancestors of `from` and whose parent host node is
// `toNode`, innermost first. These are the Fragments the pointer leaves by
// moving onto the bare parent between their children.
function getFragmentsLeftForParent(
  from: null | Fiber,
  toNode: null | Node,
  enterName: string,
  leaveName: string,
): null | Array<FragmentInstanceType> {
  if (
    toNode === null ||
    from === null ||
    (from.tag !== HostComponent &&
      from.tag !== HostSingleton &&
      from.tag !== HostText) ||
    // Only an ancestor of `from` can be the parent of a Fragment around it.
    !toNode.contains(from.stateNode)
  ) {
    return null;
  }
  let fragments: null | Array<FragmentInstanceType> = null;
  let node: null | Fiber = from;
  while (node !== null) {
    if (node.tag === Fragment) {
      const instance: null | FragmentInstanceType = node.stateNode;
      if (
        instance !== null &&
        hasEnterLeaveHandler(instance, enterName, leaveName)
      ) {
        if (fragments === null) {
          fragments = [];
        }
        fragments.push(instance);
      }
    } else {
      const hostNode = getHostNode(node);
      if (hostNode !== null) {
        if (hostNode === toNode) {
          return fragments;
        }
        // Fragments above this host node have a different parent.
        fragments = null;
      }
    }
    node = node.return;
  }
  return null;
}

export function getFragmentGapTransition(
  pointerKey: string,
  from: null | Fiber,
  to: null | Fiber,
  toNode: null | Node,
  enterName: string,
  leaveName: string,
): null | FragmentGapTransition {
  const before = pendingLeaves.get(pointerKey);
  const after = getFragmentsLeftForParent(from, toNode, enterName, leaveName);
  if (before === undefined && after === null) {
    return null;
  }

  let alreadyInside: null | Set<FragmentInstanceType> = null;
  let extraLeave: null | Array<FragmentInstanceType> = null;
  if (before !== undefined) {
    for (let i = 0; i < before.length; i++) {
      const instance = before[i];
      if (
        !isMounted(instance) ||
        !hasEnterLeaveHandler(instance, enterName, leaveName)
      ) {
        continue;
      }
      if (isFragmentAncestorOf(instance, to)) {
        // Back on one of the Fragment's own nodes: it never left.
        if (alreadyInside === null) {
          alreadyInside = new Set();
        }
        alreadyInside.add(instance);
      } else {
        // The pointer moved from the gap to somewhere outside the Fragment.
        if (extraLeave === null) {
          extraLeave = [];
        }
        extraLeave.push(instance);
      }
    }
  }

  if (after === null) {
    pendingLeaves.delete(pointerKey);
  } else {
    pendingLeaves.set(pointerKey, after);
  }

  return {
    stillInside: after === null ? null : new Set(after),
    alreadyInside,
    extraLeave,
  };
}
