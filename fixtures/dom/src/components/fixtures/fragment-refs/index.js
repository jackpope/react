import FixtureSet from '../../FixtureSet';
import EventListenerCase from './EventListenerCase';
import EventDispatchCase from './EventDispatchCase';
import IntersectionObserverCase from './IntersectionObserverCase';
import ResizeObserverCase from './ResizeObserverCase';
import FocusCase from './FocusCase';
import GetClientRectsCase from './GetClientRectsCase';
import CompareDocumentPositionCase from './CompareDocumentPositionCase';
import ScrollIntoViewCase from './ScrollIntoViewCase';
import TextNodesCase from './TextNodesCase';
import OnClickCase from './OnClickCase';
import OnClickCaptureCase from './OnClickCaptureCase';
import OnFocusCase from './OnFocusCase';
import OnMouseEnterLeaveCase from './OnMouseEnterLeaveCase';
import StopPropagationCase from './StopPropagationCase';
import NestedFragmentsCase from './NestedFragmentsCase';
import OnChangeCase from './OnChangeCase';
import OnKeyDownCase from './OnKeyDownCase';
import OnPointerCase from './OnPointerCase';
import HandlerWithRefCase from './HandlerWithRefCase';
import OnDoubleClickCase from './OnDoubleClickCase';
import OnSubmitCase from './OnSubmitCase';
import OnScrollCase from './OnScrollCase';
import OnDragCase from './OnDragCase';

const React = window.React;

export default function FragmentRefsPage() {
  return (
    <FixtureSet title="Fragment Refs">
      <EventListenerCase />
      <EventDispatchCase />
      <IntersectionObserverCase />
      <ResizeObserverCase />
      <FocusCase />
      <GetClientRectsCase />
      <CompareDocumentPositionCase />
      <ScrollIntoViewCase />
      <TextNodesCase />
      <OnClickCase />
      <OnClickCaptureCase />
      <OnFocusCase />
      <OnMouseEnterLeaveCase />
      <StopPropagationCase />
      <NestedFragmentsCase />
      <OnChangeCase />
      <OnKeyDownCase />
      <OnPointerCase />
      <HandlerWithRefCase />
      <OnDoubleClickCase />
      <OnSubmitCase />
      <OnScrollCase />
      <OnDragCase />
    </FixtureSet>
  );
}
