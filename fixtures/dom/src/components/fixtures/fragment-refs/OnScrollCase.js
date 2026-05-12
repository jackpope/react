import TestCase from '../../TestCase';
import Fixture from '../../Fixture';

const React = window.React;
const {Fragment, useState} = React;

export default function OnScrollCase() {
  const [eventLog, setEventLog] = useState([]);

  const log = msg => setEventLog(prev => [...prev, msg]);
  const clear = () => setEventLog([]);

  return (
    <TestCase title="onScroll / onWheel">
      <TestCase.Steps>
        <li>Scroll the scrollable area — observe Fragment onScroll fires</li>
        <li>Use mouse wheel over the area — observe Fragment onWheel fires</li>
      </TestCase.Steps>

      <TestCase.ExpectedResult>
        <p>
          Fragment onScroll and onWheel handlers fire when their children are
          scrolled. Note that scroll events don't bubble in the DOM, but React's
          synthetic onScroll does bubble through the React tree.
        </p>
      </TestCase.ExpectedResult>

      <Fixture>
        <Fixture.Controls>
          <button onClick={clear}>Clear log</button>
        </Fixture.Controls>
        <div
          style={{
            padding: '12px',
            border: '2px solid #999',
            borderRadius: '4px',
          }}>
          <Fragment
            onScroll={() => log('Fragment onScroll')}
            onWheel={e => log(`Fragment onWheel (deltaY: ${e.deltaY > 0 ? 'down' : 'up'})`)}>
            <div
              onScroll={() => log('Child onScroll')}
              style={{
                height: '120px',
                overflow: 'auto',
                border: '1px solid #ccc',
                padding: '8px',
              }}>
              {Array.from({length: 20}).map((_, i) => (
                <p key={i} style={{margin: '4px 0'}}>
                  Scrollable content line {i + 1}
                </p>
              ))}
            </div>
          </Fragment>
        </div>

        <EventLog entries={eventLog} />
      </Fixture>
    </TestCase>
  );
}

function EventLog({entries}) {
  if (entries.length === 0) return null;
  return (
    <div
      style={{
        marginTop: '12px',
        padding: '10px',
        backgroundColor: '#f5f5f5',
        border: '1px solid #ddd',
        borderRadius: '4px',
        maxHeight: '150px',
        overflow: 'auto',
        fontFamily: 'monospace',
        fontSize: '13px',
      }}>
      <strong>Event Log:</strong>
      <ul style={{margin: '5px 0', paddingLeft: '20px'}}>
        {entries.map((msg, i) => (
          <li key={i}>{msg}</li>
        ))}
      </ul>
    </div>
  );
}
