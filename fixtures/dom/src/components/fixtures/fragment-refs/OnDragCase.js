import TestCase from '../../TestCase';
import Fixture from '../../Fixture';

const React = window.React;
const {Fragment, useState} = React;

export default function OnDragCase() {
  const [eventLog, setEventLog] = useState([]);

  const log = msg => setEventLog(prev => [...prev, msg]);
  const clear = () => setEventLog([]);

  return (
    <TestCase title="onDrag / onDrop Handlers">
      <TestCase.Steps>
        <li>Drag the draggable box — observe Fragment onDragStart fires</li>
        <li>Drag over the drop zone — observe Fragment onDragOver fires</li>
        <li>Drop on the drop zone — observe Fragment onDrop fires</li>
      </TestCase.Steps>

      <TestCase.ExpectedResult>
        <p>
          Fragment drag event handlers (onDragStart, onDrag, onDragEnd,
          onDragEnter, onDragLeave, onDragOver, onDrop) participate in
          synthetic event dispatch, bubbling from children through the Fragment.
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
            onDragStart={() => log('Fragment onDragStart')}
            onDragEnd={() => log('Fragment onDragEnd')}
            onDragOver={e => {
              e.preventDefault();
              log('Fragment onDragOver');
            }}
            onDrop={e => {
              e.preventDefault();
              log('Fragment onDrop');
            }}>
            <div style={{display: 'flex', gap: '20px', alignItems: 'center'}}>
              <div
                draggable="true"
                onDragStart={() => log('Child onDragStart')}
                style={{
                  padding: '16px 24px',
                  backgroundColor: '#e3f2fd',
                  border: '2px solid #1976d2',
                  borderRadius: '4px',
                  cursor: 'grab',
                }}>
                Drag me
              </div>
              <div
                onDrop={() => log('Drop zone onDrop')}
                onDragOver={e => e.preventDefault()}
                style={{
                  padding: '16px 24px',
                  backgroundColor: '#f5f5f5',
                  border: '2px dashed #999',
                  borderRadius: '4px',
                  minWidth: '120px',
                  textAlign: 'center',
                }}>
                Drop zone
              </div>
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
