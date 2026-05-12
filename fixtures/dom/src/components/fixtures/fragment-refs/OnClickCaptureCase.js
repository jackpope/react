import TestCase from '../../TestCase';
import Fixture from '../../Fixture';

const React = window.React;
const {Fragment, useState} = React;

export default function OnClickCaptureCase() {
  const [eventLog, setEventLog] = useState([]);

  const log = msg => setEventLog(prev => [...prev, msg]);
  const clear = () => setEventLog([]);

  return (
    <TestCase title="onClickCapture Handler">
      <TestCase.Steps>
        <li>Click "Child" and observe the event log</li>
        <li>
          Verify capture order: parent capture fires first, then Fragment
          capture, then child handler (bubble), then Fragment bubble, then
          parent bubble
        </li>
      </TestCase.Steps>

      <TestCase.ExpectedResult>
        <p>
          Fragment onClickCapture fires during the capture phase, before
          children. The full order should be: parent capture → Fragment capture →
          child bubble → Fragment bubble → parent bubble.
        </p>
      </TestCase.ExpectedResult>

      <Fixture>
        <Fixture.Controls>
          <button onClick={clear}>Clear log</button>
        </Fixture.Controls>
        <div
          onClick={() => log('5. Parent div onClick (bubble)')}
          onClickCapture={() => log('1. Parent div onClickCapture')}
          style={{
            padding: '12px',
            border: '2px solid #999',
            borderRadius: '4px',
          }}>
          <span style={{fontSize: '12px', color: '#666'}}>Parent div</span>
          <Fragment
            onClick={() => log('4. Fragment onClick (bubble)')}
            onClickCapture={() => log('2. Fragment onClickCapture')}>
            <button
              onClick={() => log('3. Child onClick (bubble)')}
              style={{margin: '4px', padding: '8px 16px'}}>
              Child
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
