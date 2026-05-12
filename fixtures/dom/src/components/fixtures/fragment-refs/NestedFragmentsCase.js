import TestCase from '../../TestCase';
import Fixture from '../../Fixture';

const React = window.React;
const {Fragment, useState} = React;

export default function NestedFragmentsCase() {
  const [eventLog, setEventLog] = useState([]);

  const log = msg => setEventLog(prev => [...prev, msg]);
  const clear = () => setEventLog([]);

  return (
    <TestCase title="Nested Fragment Handlers">
      <TestCase.Steps>
        <li>Click the button and observe the event log</li>
        <li>
          Verify bubble order: button → inner Fragment → outer Fragment → parent
          div
        </li>
        <li>
          Verify capture order: parent div capture → outer Fragment capture →
          inner Fragment capture → button
        </li>
      </TestCase.Steps>

      <TestCase.ExpectedResult>
        <p>
          Nested Fragments stack handlers the same way nested divs do. Bubble
          order is inside-out, capture order is outside-in. The full order for a
          click should be: parent capture → outer capture → inner capture →
          button bubble → inner bubble → outer bubble → parent bubble.
        </p>
      </TestCase.ExpectedResult>

      <Fixture>
        <Fixture.Controls>
          <button onClick={clear}>Clear log</button>
        </Fixture.Controls>
        <div
          onClick={() => log('7. Parent div onClick')}
          onClickCapture={() => log('1. Parent div onClickCapture')}
          style={{
            padding: '12px',
            border: '2px solid #999',
            borderRadius: '4px',
          }}>
          <span style={{fontSize: '12px', color: '#666'}}>Parent div</span>
          <Fragment
            onClick={() => log('6. Outer Fragment onClick')}
            onClickCapture={() => log('2. Outer Fragment onClickCapture')}>
            <div
              style={{
                padding: '8px',
                margin: '8px 0',
                border: '2px dashed #2196F3',
                borderRadius: '4px',
              }}>
              <span style={{fontSize: '11px', color: '#2196F3'}}>
                Outer Fragment child
              </span>
              <Fragment
                onClick={() => log('5. Inner Fragment onClick')}
                onClickCapture={() => log('3. Inner Fragment onClickCapture')}>
                <button
                  onClick={() => log('4. Button onClick')}
                  style={{
                    display: 'block',
                    margin: '8px 0',
                    padding: '8px 16px',
                  }}>
                  Click me
                </button>
              </Fragment>
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
