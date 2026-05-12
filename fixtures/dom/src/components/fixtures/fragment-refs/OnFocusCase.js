import TestCase from '../../TestCase';
import Fixture from '../../Fixture';

const React = window.React;
const {Fragment, useState} = React;

export default function OnFocusCase() {
  const [eventLog, setEventLog] = useState([]);

  const log = msg => setEventLog(prev => [...prev, msg]);
  const clear = () => setEventLog([]);

  return (
    <TestCase title="onFocus / onBlur Handlers">
      <TestCase.Steps>
        <li>Click "Input A" to focus it — observe onFocus fires</li>
        <li>Click "Input B" to move focus within the Fragment</li>
        <li>
          Observe that Fragment onBlur fires for Input A leaving, then Fragment
          onFocus fires for Input B entering
        </li>
        <li>Click outside to blur — observe onBlur fires</li>
        <li>Try the same with the buttons to see focus/blur on non-inputs</li>
      </TestCase.Steps>

      <TestCase.ExpectedResult>
        <p>
          Fragment onFocus fires when any child within the Fragment receives
          focus. Fragment onBlur fires when any child loses focus. These are
          bubbling focus events (like React's onFocus), so moving between
          children will fire both onBlur and onFocus on the Fragment.
        </p>
        <p>
          The order should match a wrapper div: child onFocus → Fragment onFocus
          → parent onFocus (bubble), and similarly for blur.
        </p>
      </TestCase.ExpectedResult>

      <Fixture>
        <Fixture.Controls>
          <button onClick={clear}>Clear log</button>
        </Fixture.Controls>
        <div
          onFocus={() => log('Parent div onFocus')}
          onBlur={() => log('Parent div onBlur')}
          style={{
            padding: '12px',
            border: '2px solid #999',
            borderRadius: '4px',
          }}>
          <span style={{fontSize: '12px', color: '#666'}}>Parent div</span>
          <Fragment
            onFocus={e => log(`Fragment onFocus (from: ${e.target.tagName})`)}
            onBlur={e => log(`Fragment onBlur (from: ${e.target.tagName})`)}>
            <div
              style={{
                display: 'flex',
                gap: '8px',
                marginTop: '8px',
                flexWrap: 'wrap',
              }}>
              <input
                type="text"
                placeholder="Input A"
                onFocus={() => log('Input A onFocus')}
                onBlur={() => log('Input A onBlur')}
                style={{padding: '6px'}}
              />
              <input
                type="text"
                placeholder="Input B"
                onFocus={() => log('Input B onFocus')}
                onBlur={() => log('Input B onBlur')}
                style={{padding: '6px'}}
              />
              <button
                onFocus={() => log('Button onFocus')}
                onBlur={() => log('Button onBlur')}>
                Focusable Button
              </button>
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
        maxHeight: '200px',
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
