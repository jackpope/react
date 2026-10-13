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
  OffscreenComponent,
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
  // Fragments that are on neither path but get an enter event, outermost first.
  extraEnter: null | Array<FragmentInstanceType>,
};

// Fragments with enter/leave handlers, keyed by the host node their children
// are inserted into. When the pointer is over that node itself, it may be in a
// gap between a Fragment's children.
const fragmentsByParentNode: WeakMap<
  Node,
  Set<FragmentInstanceType>,
> = new WeakMap();
const parentNodeByFragment: WeakMap<FragmentInstanceType, Node> = new WeakMap();
let registeredFragmentCount = 0;

// For each pointer, the Fragments the pointer is inside of only because it's
// over a gap between their children. Mouse events and each pointerId are
// tracked separately because they dispatch separate enter/leave events.
const gapHoveredFragments: Map<string, Array<FragmentInstanceType>> = new Map();

const enterLeaveHandlerNames = [
  'onMouseEnter',
  'onMouseLeave',
  'onPointerEnter',
  'onPointerLeave',
];

function getParentHostNode(fragmentFiber: Fiber): null | Node {
  let node = fragmentFiber.return;
  while (node !== null) {
    switch (node.tag) {
      case HostComponent:
      case HostSingleton:
        return node.stateNode;
      case HostRoot:
      case HostPortal:
        return node.stateNode.containerInfo;
    }
    node = node.return;
  }
  return null;
}

function unregister(instance: FragmentInstanceType): void {
  const parentNode = parentNodeByFragment.get(instance);
  if (parentNode === undefined) {
    return;
  }
  parentNodeByFragment.delete(instance);
  const fragments = fragmentsByParentNode.get(parentNode);
  if (fragments !== undefined) {
    fragments.delete(instance);
    if (fragments.size === 0) {
      fragmentsByParentNode.delete(parentNode);
    }
  }
  registeredFragmentCount--;
}

export function updateFragmentEnterLeaveRegistration(
  instance: FragmentInstanceType,
  props: null | {+[propKey: string]: mixed},
): void {
  let hasHandler = false;
  if (props !== null) {
    for (let i = 0; i < enterLeaveHandlerNames.length; i++) {
      if (props[enterLeaveHandlerNames[i]] != null) {
        hasHandler = true;
        break;
      }
    }
  }
  if (!hasHandler) {
    unregister(instance);
    return;
  }
  if (parentNodeByFragment.has(instance)) {
    return;
  }
  const parentNode = getParentHostNode(instance._fragmentFiber);
  if (parentNode === null) {
    return;
  }
  parentNodeByFragment.set(instance, parentNode);
  let fragments = fragmentsByParentNode.get(parentNode);
  if (fragments === undefined) {
    fragments = new Set();
    fragmentsByParentNode.set(parentNode, fragments);
  }
  fragments.add(instance);
  registeredFragmentCount++;
}

export function hasFragmentGapCandidates(
  pointerKey: string,
  node: null | Node,
): boolean {
  return (
    gapHoveredFragments.has(pointerKey) ||
    (registeredFragmentCount > 0 &&
      node !== null &&
      fragmentsByParentNode.has(node))
  );
}

type Rect = {left: number, top: number, right: number, bottom: number, ...};

function collectChildRects(child: null | Fiber, rects: Array<Rect>): void {
  while (child !== null) {
    if (child.tag === HostComponent || child.tag === HostSingleton) {
      const element: Element = child.stateNode;
      // $FlowFixMe[method-unbinding]
      rects.push.apply(rects, element.getClientRects());
    } else if (child.tag === HostText) {
      const textNode: Text = child.stateNode;
      const range = textNode.ownerDocument.createRange();
      range.selectNodeContents(textNode);
      // $FlowFixMe[method-unbinding] Some environments don't lay out ranges.
      if (typeof range.getClientRects === 'function') {
        // $FlowFixMe[method-unbinding]
        rects.push.apply(rects, range.getClientRects());
      }
    } else if (
      child.tag === HostPortal ||
      (child.tag === OffscreenComponent && child.memoizedState !== null)
    ) {
      // Portaled and hidden children aren't laid out with the others.
    } else {
      collectChildRects(child.child, rects);
    }
    child = child.sibling;
  }
}

// The point is inside the Fragment if it's on one of the Fragment's host
// nodes (e.g. its text, which can't be an event target), or if it lies
// between two of them: one on each side, horizontally or vertically.
function isPointInFragment(
  instance: FragmentInstanceType,
  x: number,
  y: number,
): boolean {
  const rects: Array<Rect> = [];
  collectChildRects(instance._fragmentFiber.child, rects);
  let left = false;
  let right = false;
  let above = false;
  let below = false;
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    if (rect.right <= rect.left && rect.bottom <= rect.top) {
      continue;
    }
    const inRow = y >= rect.top && y <= rect.bottom;
    const inColumn = x >= rect.left && x <= rect.right;
    if (inRow && inColumn) {
      return true;
    }
    if (inRow) {
      if (rect.right < x) {
        left = true;
      } else {
        right = true;
      }
    } else if (inColumn) {
      if (rect.bottom < y) {
        above = true;
      } else {
        below = true;
      }
    }
    if ((left && right) || (above && below)) {
      return true;
    }
  }
  return false;
}

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

function getFragmentDepth(instance: FragmentInstanceType): number {
  let depth = 0;
  let node = instance._fragmentFiber.return;
  while (node !== null) {
    depth++;
    node = node.return;
  }
  return depth;
}

export function getFragmentGapTransition(
  pointerKey: string,
  from: null | Fiber,
  to: null | Fiber,
  toNode: null | Node,
  x: number,
  y: number,
  enterName: string,
  leaveName: string,
): null | FragmentGapTransition {
  const before = gapHoveredFragments.get(pointerKey);
  const candidates =
    registeredFragmentCount > 0 && toNode !== null
      ? fragmentsByParentNode.get(toNode)
      : undefined;
  if (before === undefined && candidates === undefined) {
    return null;
  }

  let after: null | Array<FragmentInstanceType> = null;
  if (candidates !== undefined) {
    candidates.forEach(instance => {
      if (!isMounted(instance)) {
        unregister(instance);
      } else if (
        hasEnterLeaveHandler(instance, enterName, leaveName) &&
        isPointInFragment(instance, x, y)
      ) {
        if (after === null) {
          after = [];
        }
        after.push(instance);
      }
    });
  }

  let alreadyInside: null | Set<FragmentInstanceType> = null;
  let extraLeave: null | Array<FragmentInstanceType> = null;
  if (before !== undefined) {
    for (let i = 0; i < before.length; i++) {
      const instance = before[i];
      if (!isMounted(instance)) {
        continue;
      }
      if (alreadyInside === null) {
        alreadyInside = new Set();
      }
      alreadyInside.add(instance);
      if (
        (after === null || !after.includes(instance)) &&
        !isFragmentAncestorOf(instance, to)
      ) {
        if (extraLeave === null) {
          extraLeave = [];
        }
        extraLeave.push(instance);
      }
    }
  }

  let extraEnter: null | Array<FragmentInstanceType> = null;
  if (after !== null) {
    const afterList: Array<FragmentInstanceType> = after;
    for (let i = 0; i < afterList.length; i++) {
      const instance = afterList[i];
      if (
        (alreadyInside === null || !alreadyInside.has(instance)) &&
        !isFragmentAncestorOf(instance, from)
      ) {
        if (extraEnter === null) {
          extraEnter = [];
        }
        extraEnter.push(instance);
      }
    }
    gapHoveredFragments.set(pointerKey, afterList);
  } else {
    gapHoveredFragments.delete(pointerKey);
  }

  if (extraLeave !== null && extraLeave.length > 1) {
    extraLeave.sort((a, b) => getFragmentDepth(b) - getFragmentDepth(a));
  }
  if (extraEnter !== null && extraEnter.length > 1) {
    extraEnter.sort((a, b) => getFragmentDepth(a) - getFragmentDepth(b));
  }

  return {
    stillInside: after === null ? null : new Set(after),
    alreadyInside,
    extraLeave,
    extraEnter,
  };
}
