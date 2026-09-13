import {useEffect, useId, useRef, useState} from 'react';
import {constrainCamera, FIT_CAMERA, MAX_ZOOM, MIN_ZOOM, pointerGesture, wheelZoomFactor, zoomCamera} from './boardCamera';
import './BoardViewport.css';

export default function BoardViewport({children, cameraKey, cameraState}) {
  const initialView = cameraState?.current && cameraState.current.key === cameraKey ? cameraState.current.view : FIT_CAMERA;
  const viewport = useRef(null), camera = useRef(initialView), points = useRef(new Map());
  const gesture = useRef(null), dragged = useRef(false);
  const [view, setView] = useState(initialView), [panning, setPanning] = useState(false);
  const helpId = useId();
  const size = () => viewport.current.getBoundingClientRect();
  const commit = next => {
    camera.current = next;
    if (cameraState) cameraState.current = {key: cameraKey, view: next};
    setView(next);
  };
  const update = next => commit(constrainCamera(next, size()));
  const reset = () => commit(FIT_CAMERA);
  const localPoint = event => {
    const rect = size();
    return {x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2};
  };
  const rebase = () => { gesture.current = points.current.size ? { ...pointerGesture([...points.current.values()]), camera: camera.current } : null; };
  useEffect(() => {
    commit(cameraState?.current && cameraState.current.key === cameraKey ? cameraState.current.view : FIT_CAMERA);
    points.current.clear(); gesture.current = null; setPanning(false);
  }, [cameraKey, cameraState]);
  useEffect(() => {
    const element = viewport.current;
    const wheel = event => {
      event.preventDefault();
      update(zoomCamera(camera.current, camera.current.scale * wheelZoomFactor(event.deltaY, event.deltaMode, size().height), localPoint(event), size()));
      if (points.current.size) rebase();
    };
    // React's delegated wheel listener is passive in browsers.
    element.addEventListener('wheel', wheel, {passive: false});
    const resize = new ResizeObserver(() => update(camera.current));
    resize.observe(element);
    return () => { element.removeEventListener('wheel', wheel); resize.disconnect(); };
  }, [cameraKey, cameraState]);
  const pointerDown = event => {
    if (event.button !== 0 || event.target.closest('.board-view-controls')) return;
    if (!points.current.size) dragged.current = false;
    points.current.set(event.pointerId, localPoint(event));
    if (points.current.size > 1) dragged.current = true;
    rebase();
  };
  const pointerMove = event => {
    if (!points.current.has(event.pointerId) || !gesture.current) return;
    points.current.set(event.pointerId, localPoint(event));
    const current = pointerGesture([...points.current.values()]), start = gesture.current;
    const dx = current.point.x - start.point.x, dy = current.point.y - start.point.y;
    if (!dragged.current && Math.hypot(dx, dy) < 6) return;
    dragged.current = true; setPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (points.current.size > 1 && start.distance > 0) {
      update(zoomCamera(start.camera, start.camera.scale * current.distance / start.distance, start.point, size(), current.point));
    } else update({...start.camera, x: start.camera.x + dx, y: start.camera.y + dy});
  };
  const pointerEnd = event => {
    points.current.delete(event.pointerId);
    rebase();
    if (!points.current.size) setPanning(false);
  };
  const keyDown = event => {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key;
    if (!['+', '=', '-', '0', 'Home', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return;
    event.preventDefault();
    if (key === '0' || key === 'Home') reset();
    else if (key === '+' || key === '=' || key === '-') update(zoomCamera(camera.current, camera.current.scale * (key === '-' ? 1 / 1.2 : 1.2), {x: 0, y: 0}, size()));
    else update({...camera.current, x: camera.current.x + (key === 'ArrowLeft' ? 40 : key === 'ArrowRight' ? -40 : 0), y: camera.current.y + (key === 'ArrowUp' ? 40 : key === 'ArrowDown' ? -40 : 0)});
  };
  const revealFocusedTarget = event => {
    if (!event.target.closest('svg') || !event.target.getBoundingClientRect) return;
    const target = event.target.getBoundingClientRect(), rect = size(), margin = 28;
    const dx = target.left < rect.left + margin ? rect.left + margin - target.left : target.right > rect.right - margin ? rect.right - margin - target.right : 0;
    const dy = target.top < rect.top + margin ? rect.top + margin - target.top : target.bottom > rect.bottom - margin ? rect.bottom - margin - target.bottom : 0;
    if (dx || dy) update({...camera.current, x: camera.current.x + dx, y: camera.current.y + dy});
  };
  return <div ref={viewport} className={`board-viewport${panning ? ' is-panning' : ''}`} role="region" aria-label="Board navigation" aria-describedby={helpId} tabIndex={0}
    onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd}
    onPointerLeave={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) pointerEnd(event); }}
    onClickCapture={event => { if (dragged.current && event.detail !== 0 && !event.target.closest('.board-view-controls')) { event.preventDefault(); event.stopPropagation(); } }}
    onKeyDown={keyDown} onFocusCapture={revealFocusedTarget}>
    <span id={helpId} className="board-navigation-help">Scroll or pinch to zoom. Drag to pan. With the board focused, use + or − to zoom, arrow keys to pan, and 0 to fit.</span>
    <div className="board-camera" style={{transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`}}>{children}</div>
    <div className="board-view-controls" role="group" aria-label="Board zoom">
      <button type="button" aria-label="Zoom out" title="Zoom out (−)" disabled={view.scale <= MIN_ZOOM} onClick={() => update(zoomCamera(camera.current, camera.current.scale / 1.2, {x: 0, y: 0}, size()))}>−</button>
      <button type="button" className="board-fit" aria-label={`Fit board, current zoom ${Math.round(view.scale * 100)} percent`} title="Fit board (0)" onClick={reset}>{Math.round(view.scale * 100)}% <span>Fit</span></button>
      <button type="button" aria-label="Zoom in" title="Zoom in (+)" disabled={view.scale >= MAX_ZOOM} onClick={() => update(zoomCamera(camera.current, camera.current.scale * 1.2, {x: 0, y: 0}, size()))}>+</button>
    </div>
  </div>;
}
