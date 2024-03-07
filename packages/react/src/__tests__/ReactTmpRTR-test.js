/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

let React;
let ReactTestRenderer;
let act;
let Scheduler;
let assertLog;

function load() {
  React = require('react');
  ReactTestRenderer = require('react-test-renderer');
  act = require('internal-test-utils').act;
  assertLog = require('internal-test-utils').assertLog;
  Scheduler = require('scheduler');
}

describe('tmp', () => {
  it('renders the correct amount of times', async () => {
    // Mock the Scheduler module so we can track how many times the current
    // time is read
    jest.mock('scheduler', obj => {
      const ActualScheduler = jest.requireActual('scheduler/unstable_mock');
      return {
        ...ActualScheduler,
        unstable_now: function mockUnstableNow() {
          ActualScheduler.log('read current time');
          return ActualScheduler.unstable_now();
        },
      };
    });

    jest.resetModules();

    load();

    class AdvanceTime extends React.Component {
      static defaultProps = {
        byAmount: 10,
        shouldComponentUpdate: true,
        n: 0,
      };
      shouldComponentUpdate(nextProps) {
        return nextProps.shouldComponentUpdate;
      }
      render() {
        Scheduler.log(`Render ${this.props.n}`);
        // Simulate time passing when this component is rendered
        Scheduler.unstable_advanceTime(this.props.byAmount);
        return this.props.children || null;
      }
    }
    // Clear yields in case the current time is read during initialization.
    Scheduler.unstable_clearLog();
    await act(() => {
      ReactTestRenderer.create(
        <div>
          <AdvanceTime n={1} />
          <AdvanceTime n={2} />
          <AdvanceTime n={3} />
        </div>,
        {unstable_isConcurrent: true},
      );
    });
    assertLog([
      'read current time',
      'Render 1',
      'Render 2',
      'Render 3',
      'read current time',
      'read current time',
      'read current time', // extra read with concurrent root
    ]);

    Scheduler.unstable_clearLog();
    await act(() => {
      ReactTestRenderer.create(
        <div>
          <AdvanceTime n={1} />
          <AdvanceTime n={2} />
          <AdvanceTime n={3} />
        </div>,
      );
    });
    assertLog([
      'read current time',
      'Render 1',
      'Render 2',
      'Render 3',
      'read current time',
      'read current time',
    ]);
  });
});
