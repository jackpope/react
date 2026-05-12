import TestCase from '../../TestCase';
import Fixture from '../../Fixture';

const React = window.React;
const {Fragment, useState} = React;

export default function OnKeyDownCase() {
  const [eventLog, setEventLog] = useState([]);

  const log = msg => setEventLog(prev => [...prev, msg]);
  const clear = () => setEventLog([]);

  return (
    <TestCase title="onKeyDown / onKeyUp Handlers">
      <TestCase.Steps>
        <li>Focus the input and press any key</li>
        <li>Observe onKeyDown and onKeyUp events fire on child then Fragment</li>
        <li>Focus the button and press a key to confirm it works on all children</li>
      </TestCase.Steps>

      <TestCase.ExpectedResult>
        <p>
          Fragment onKeyDown and onKeyUp fire during the bubble phase after the
          child's own key handlers. This allows a Fragment to observe keyboard
          events from any of its children.
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
            onKeyDown={e => log(`Fragment onKeyDown: ${e.key}`)}
            onKeyUp={e => log(`Fragment onKeyUp: ${e.key}`)}>
            <input
              type="text"
              placeholder="Type here..."
              onKeyDown={e => log(`Input onKeyDown: ${e.key}`)}
              onKeyUp={e => log(`Input onKeyUp: ${e.key}`)}
              style={{padding: '6px', marginRight: '8px'}}
            />
            <button
              onKeyDown={e => log(`Button onKeyDown: ${e.key}`)}
              onKeyUp={e => log(`Button onKeyUp: ${e.key}`)}>
              Or press keys here
            </button>
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
