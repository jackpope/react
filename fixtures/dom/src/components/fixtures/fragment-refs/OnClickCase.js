import TestCase from '../../TestCase';
import Fixture from '../../Fixture';

const React = window.React;
const {Fragment, useState} = React;

export default function OnClickCase() {
  const [eventLog, setEventLog] = useState([]);

  const log = msg => setEventLog(prev => [...prev, msg]);
  const clear = () => setEventLog([]);

  return (
    <TestCase title="onClick Handler">
      <TestCase.Steps>
        <li>Click "Child A" and observe the event log</li>
        <li>Click "Child B" and observe</li>
        <li>
          Verify order: child handler fires first, then Fragment handler, then
          parent div handler (standard bubble order)
        </li>
      </TestCase.Steps>

      <TestCase.ExpectedResult>
        <p>
          Fragment onClick handlers participate in React's synthetic event
          dispatch. They fire during the bubble phase, just like a parent div
          would. The order should be: child → Fragment → parent.
        </p>
      </TestCase.ExpectedResult>

      <Fixture>
        <Fixture.Controls>
          <button onClick={clear}>Clear log</button>
        </Fixture.Controls>
        <div
          onClick={() => log('3. Parent div onClick')}
          style={{
            padding: '12px',
            border: '2px solid #999',
            borderRadius: '4px',
          }}>
          <span style={{fontSize: '12px', color: '#666'}}>Parent div</span>
          <Fragment onClick={() => log('2. Fragment onClick')}>
            <button
              onClick={() => log('1. Child A onClick')}
              style={{margin: '4px', padding: '8px 16px'}}>
              Child A
            </button>
            <button
              onClick={() => log('1. Child B onClick')}
              style={{margin: '4px', padding: '8px 16px'}}>
              Child B
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
