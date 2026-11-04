import"./modulepreload-polyfill.js";import{A as e,B as t,E as n,F as r,I as i,K as a,O as o,U as s,X as c,Y as ee,Z as l,_t as u,at as d,b as f,c as p,ct as m,d as te,f as ne,gt as h,ht as re,i as ie,it as g,j as _,k as v,mt as y,o as ae,ot as oe,pt as b,q as se,s as x,st as ce,tt as le,vt as ue,w as de,x as fe,z as pe}from"./three.module.js";var me={type:`change`},he={type:`start`},ge={type:`end`},_e=new le,ve=new se,ye=Math.cos(70*i.DEG2RAD),S=new y,C=2*Math.PI,w={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6},be=1e-6,xe=class extends ne{constructor(e,t=null){super(e,t),this.state=w.NONE,this.target=new y,this.cursor=new y,this.minDistance=0,this.maxDistance=1/0,this.minZoom=0,this.maxZoom=1/0,this.minTargetRadius=0,this.maxTargetRadius=1/0,this.minPolarAngle=0,this.maxPolarAngle=Math.PI,this.minAzimuthAngle=-1/0,this.maxAzimuthAngle=1/0,this.enableDamping=!1,this.dampingFactor=.05,this.enableZoom=!0,this.zoomSpeed=1,this.enableRotate=!0,this.rotateSpeed=1,this.keyRotateSpeed=1,this.enablePan=!0,this.panSpeed=1,this.screenSpacePanning=!0,this.keyPanSpeed=7,this.zoomToCursor=!1,this.autoRotate=!1,this.autoRotateSpeed=2,this.keys={LEFT:`ArrowLeft`,UP:`ArrowUp`,RIGHT:`ArrowRight`,BOTTOM:`ArrowDown`},this.mouseButtons={LEFT:r.ROTATE,MIDDLE:r.DOLLY,RIGHT:r.PAN},this.touches={ONE:m.ROTATE,TWO:m.DOLLY_PAN},this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this._cursorStyle=`auto`,this._domElementKeyEvents=null,this._lastPosition=new y,this._lastQuaternion=new c,this._lastTargetPosition=new y,this._quat=new c().setFromUnitVectors(e.up,new y(0,1,0)),this._quatInverse=this._quat.clone().invert(),this._spherical=new ce,this._sphericalDelta=new ce,this._scale=1,this._panOffset=new y,this._rotateStart=new b,this._rotateEnd=new b,this._rotateDelta=new b,this._panStart=new b,this._panEnd=new b,this._panDelta=new b,this._dollyStart=new b,this._dollyEnd=new b,this._dollyDelta=new b,this._dollyDirection=new y,this._mouse=new b,this._performCursorZoom=!1,this._pointers=[],this._pointerPositions={},this._controlActive=!1,this._onPointerMove=Ce.bind(this),this._onPointerDown=Se.bind(this),this._onPointerUp=we.bind(this),this._onContextMenu=je.bind(this),this._onMouseWheel=De.bind(this),this._onKeyDown=Oe.bind(this),this._onTouchStart=ke.bind(this),this._onTouchMove=Ae.bind(this),this._onMouseDown=Te.bind(this),this._onMouseMove=Ee.bind(this),this._interceptControlDown=Me.bind(this),this._interceptControlUp=Ne.bind(this),this.domElement!==null&&this.connect(this.domElement),this.update()}set cursorStyle(e){this._cursorStyle=e,e===`grab`?this.domElement.style.cursor=`grab`:this.domElement.style.cursor=`auto`}get cursorStyle(){return this._cursorStyle}connect(e){super.connect(e),this.domElement.addEventListener(`pointerdown`,this._onPointerDown),this.domElement.addEventListener(`pointercancel`,this._onPointerUp),this.domElement.addEventListener(`contextmenu`,this._onContextMenu),this.domElement.addEventListener(`wheel`,this._onMouseWheel,{passive:!1}),this.domElement.getRootNode().addEventListener(`keydown`,this._interceptControlDown,{passive:!0,capture:!0}),this.domElement.style.touchAction=`none`}disconnect(){this.domElement.removeEventListener(`pointerdown`,this._onPointerDown),this.domElement.ownerDocument.removeEventListener(`pointermove`,this._onPointerMove),this.domElement.ownerDocument.removeEventListener(`pointerup`,this._onPointerUp),this.domElement.removeEventListener(`pointercancel`,this._onPointerUp),this.domElement.removeEventListener(`wheel`,this._onMouseWheel),this.domElement.removeEventListener(`contextmenu`,this._onContextMenu),this.stopListenToKeyEvents(),this.domElement.getRootNode().removeEventListener(`keydown`,this._interceptControlDown,{capture:!0}),this.domElement.style.touchAction=``}dispose(){this.disconnect()}getPolarAngle(){return this._spherical.phi}getAzimuthalAngle(){return this._spherical.theta}getDistance(){return this.object.position.distanceTo(this.target)}listenToKeyEvents(e){e.addEventListener(`keydown`,this._onKeyDown),this._domElementKeyEvents=e}stopListenToKeyEvents(){this._domElementKeyEvents!==null&&(this._domElementKeyEvents.removeEventListener(`keydown`,this._onKeyDown),this._domElementKeyEvents=null)}saveState(){this.target0.copy(this.target),this.position0.copy(this.object.position),this.zoom0=this.object.zoom}reset(){this.target.copy(this.target0),this.object.position.copy(this.position0),this.object.zoom=this.zoom0,this.object.updateProjectionMatrix(),this.dispatchEvent(me),this.update(),this.state=w.NONE}pan(e,t){this._pan(e,t),this.update()}dollyIn(e){this._dollyIn(e),this.update()}dollyOut(e){this._dollyOut(e),this.update()}rotateLeft(e){this._rotateLeft(e),this.update()}rotateUp(e){this._rotateUp(e),this.update()}update(e=null){let t=this.object.position;S.copy(t).sub(this.target),S.applyQuaternion(this._quat),this._spherical.setFromVector3(S),this.autoRotate&&this.state===w.NONE&&this._rotateLeft(this._getAutoRotationAngle(e)),this.enableDamping?(this._spherical.theta+=this._sphericalDelta.theta*this.dampingFactor,this._spherical.phi+=this._sphericalDelta.phi*this.dampingFactor):(this._spherical.theta+=this._sphericalDelta.theta,this._spherical.phi+=this._sphericalDelta.phi);let n=this.minAzimuthAngle,r=this.maxAzimuthAngle;isFinite(n)&&isFinite(r)&&(n<-Math.PI?n+=C:n>Math.PI&&(n-=C),r<-Math.PI?r+=C:r>Math.PI&&(r-=C),n<=r?this._spherical.theta=Math.max(n,Math.min(r,this._spherical.theta)):this._spherical.theta=this._spherical.theta>(n+r)/2?Math.max(n,this._spherical.theta):Math.min(r,this._spherical.theta)),this._spherical.phi=Math.max(this.minPolarAngle,Math.min(this.maxPolarAngle,this._spherical.phi)),this._spherical.makeSafe(),this.enableDamping===!0?this.target.addScaledVector(this._panOffset,this.dampingFactor):this.target.add(this._panOffset),this.target.sub(this.cursor),this.target.clampLength(this.minTargetRadius,this.maxTargetRadius),this.target.add(this.cursor);let i=!1;if(this.zoomToCursor&&this._performCursorZoom||this.object.isOrthographicCamera)this._spherical.radius=this._clampDistance(this._spherical.radius);else{let e=this._spherical.radius;this._spherical.radius=this._clampDistance(this._spherical.radius*this._scale),i=e!=this._spherical.radius}if(S.setFromSpherical(this._spherical),S.applyQuaternion(this._quatInverse),t.copy(this.target).add(S),this.object.lookAt(this.target),this.enableDamping===!0?(this._sphericalDelta.theta*=1-this.dampingFactor,this._sphericalDelta.phi*=1-this.dampingFactor,this._panOffset.multiplyScalar(1-this.dampingFactor)):(this._sphericalDelta.set(0,0,0),this._panOffset.set(0,0,0)),this.zoomToCursor&&this._performCursorZoom){let e=null;if(this.object.isPerspectiveCamera){let t=S.length();e=this._clampDistance(t*this._scale);let n=t-e;this.object.position.addScaledVector(this._dollyDirection,n),this.object.updateMatrixWorld(),i=!!n}else if(this.object.isOrthographicCamera){let t=new y(this._mouse.x,this._mouse.y,0);t.unproject(this.object);let n=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),this.object.updateProjectionMatrix(),i=n!==this.object.zoom;let r=new y(this._mouse.x,this._mouse.y,0);r.unproject(this.object),this.object.position.sub(r).add(t),this.object.updateMatrixWorld(),e=S.length()}else console.warn(`WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled.`),this.zoomToCursor=!1;e!==null&&(this.screenSpacePanning?this.target.set(0,0,-1).transformDirection(this.object.matrix).multiplyScalar(e).add(this.object.position):(_e.origin.copy(this.object.position),_e.direction.set(0,0,-1).transformDirection(this.object.matrix),Math.abs(this.object.up.dot(_e.direction))<ye?this.object.lookAt(this.target):(ve.setFromNormalAndCoplanarPoint(this.object.up,this.target),_e.intersectPlane(ve,this.target))))}else if(this.object.isOrthographicCamera){let e=this.object.zoom;this.object.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.object.zoom/this._scale)),e!==this.object.zoom&&(this.object.updateProjectionMatrix(),i=!0)}return this._scale=1,this._performCursorZoom=!1,i||this._lastPosition.distanceToSquared(this.object.position)>be||8*(1-this._lastQuaternion.dot(this.object.quaternion))>be||this._lastTargetPosition.distanceToSquared(this.target)>be?(this.dispatchEvent(me),this._lastPosition.copy(this.object.position),this._lastQuaternion.copy(this.object.quaternion),this._lastTargetPosition.copy(this.target),!0):!1}_getAutoRotationAngle(e){return e===null?C/60/60*this.autoRotateSpeed:C/60*this.autoRotateSpeed*e}_getZoomScale(e){let t=Math.abs(e*.01);return .95**(this.zoomSpeed*t)}_rotateLeft(e){this._sphericalDelta.theta-=e}_rotateUp(e){this._sphericalDelta.phi-=e}_panLeft(e,t){S.setFromMatrixColumn(t,0),S.multiplyScalar(-e),this._panOffset.add(S)}_panUp(e,t){this.screenSpacePanning===!0?S.setFromMatrixColumn(t,1):(S.setFromMatrixColumn(t,0),S.crossVectors(this.object.up,S)),S.multiplyScalar(e),this._panOffset.add(S)}_pan(e,t){let n=this.domElement;if(this.object.isPerspectiveCamera){let r=this.object.position;S.copy(r).sub(this.target);let i=S.length();i*=Math.tan(this.object.fov/2*Math.PI/180),this._panLeft(2*e*i/n.clientHeight,this.object.matrix),this._panUp(2*t*i/n.clientHeight,this.object.matrix)}else this.object.isOrthographicCamera?(this._panLeft(e*(this.object.right-this.object.left)/this.object.zoom/n.clientWidth,this.object.matrix),this._panUp(t*(this.object.top-this.object.bottom)/this.object.zoom/n.clientHeight,this.object.matrix)):(console.warn(`WARNING: OrbitControls.js encountered an unknown camera type - pan disabled.`),this.enablePan=!1)}_dollyOut(e){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale/=e:(console.warn(`WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled.`),this.enableZoom=!1)}_dollyIn(e){this.object.isPerspectiveCamera||this.object.isOrthographicCamera?this._scale*=e:(console.warn(`WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled.`),this.enableZoom=!1)}_updateZoomParameters(e,t){if(!this.zoomToCursor)return;this._performCursorZoom=!0;let n=this.domElement.getBoundingClientRect(),r=e-n.left,i=t-n.top,a=n.width,o=n.height;this._mouse.x=r/a*2-1,this._mouse.y=-(i/o)*2+1,this._dollyDirection.set(this._mouse.x,this._mouse.y,1).unproject(this.object).sub(this.object.position).normalize()}_clampDistance(e){return Math.max(this.minDistance,Math.min(this.maxDistance,e))}_handleMouseDownRotate(e){this._rotateStart.set(e.clientX,e.clientY)}_handleMouseDownDolly(e){this._updateZoomParameters(e.clientX,e.clientX),this._dollyStart.set(e.clientX,e.clientY)}_handleMouseDownPan(e){this._panStart.set(e.clientX,e.clientY)}_handleMouseMoveRotate(e){this._rotateEnd.set(e.clientX,e.clientY),this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);let t=this.domElement;this._rotateLeft(C*this._rotateDelta.x/t.clientHeight),this._rotateUp(C*this._rotateDelta.y/t.clientHeight),this._rotateStart.copy(this._rotateEnd),this.update()}_handleMouseMoveDolly(e){this._dollyEnd.set(e.clientX,e.clientY),this._dollyDelta.subVectors(this._dollyEnd,this._dollyStart),this._dollyDelta.y>0?this._dollyOut(this._getZoomScale(this._dollyDelta.y)):this._dollyDelta.y<0&&this._dollyIn(this._getZoomScale(this._dollyDelta.y)),this._dollyStart.copy(this._dollyEnd),this.update()}_handleMouseMovePan(e){this._panEnd.set(e.clientX,e.clientY),this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd),this.update()}_handleMouseWheel(e){this._updateZoomParameters(e.clientX,e.clientY),e.deltaY<0?this._dollyIn(this._getZoomScale(e.deltaY)):e.deltaY>0&&this._dollyOut(this._getZoomScale(e.deltaY)),this.update()}_handleKeyDown(e){let t=!1;switch(e.code){case this.keys.UP:e.ctrlKey||e.metaKey||e.shiftKey?this.enableRotate&&this._rotateUp(C*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(0,this.keyPanSpeed),t=!0;break;case this.keys.BOTTOM:e.ctrlKey||e.metaKey||e.shiftKey?this.enableRotate&&this._rotateUp(-C*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(0,-this.keyPanSpeed),t=!0;break;case this.keys.LEFT:e.ctrlKey||e.metaKey||e.shiftKey?this.enableRotate&&this._rotateLeft(C*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(this.keyPanSpeed,0),t=!0;break;case this.keys.RIGHT:e.ctrlKey||e.metaKey||e.shiftKey?this.enableRotate&&this._rotateLeft(-C*this.keyRotateSpeed/this.domElement.clientHeight):this.enablePan&&this._pan(-this.keyPanSpeed,0),t=!0}t&&(e.preventDefault(),this.update())}_handleTouchStartRotate(e){if(this._pointers.length===1)this._rotateStart.set(e.pageX,e.pageY);else{let t=this._getSecondPointerPosition(e),n=.5*(e.pageX+t.x),r=.5*(e.pageY+t.y);this._rotateStart.set(n,r)}}_handleTouchStartPan(e){if(this._pointers.length===1)this._panStart.set(e.pageX,e.pageY);else{let t=this._getSecondPointerPosition(e),n=.5*(e.pageX+t.x),r=.5*(e.pageY+t.y);this._panStart.set(n,r)}}_handleTouchStartDolly(e){let t=this._getSecondPointerPosition(e),n=e.pageX-t.x,r=e.pageY-t.y,i=Math.sqrt(n*n+r*r);this._dollyStart.set(0,i)}_handleTouchStartDollyPan(e){this.enableZoom&&this._handleTouchStartDolly(e),this.enablePan&&this._handleTouchStartPan(e)}_handleTouchStartDollyRotate(e){this.enableZoom&&this._handleTouchStartDolly(e),this.enableRotate&&this._handleTouchStartRotate(e)}_handleTouchMoveRotate(e){if(this._pointers.length==1)this._rotateEnd.set(e.pageX,e.pageY);else{let t=this._getSecondPointerPosition(e),n=.5*(e.pageX+t.x),r=.5*(e.pageY+t.y);this._rotateEnd.set(n,r)}this._rotateDelta.subVectors(this._rotateEnd,this._rotateStart).multiplyScalar(this.rotateSpeed);let t=this.domElement;this._rotateLeft(C*this._rotateDelta.x/t.clientHeight),this._rotateUp(C*this._rotateDelta.y/t.clientHeight),this._rotateStart.copy(this._rotateEnd)}_handleTouchMovePan(e){if(this._pointers.length===1)this._panEnd.set(e.pageX,e.pageY);else{let t=this._getSecondPointerPosition(e),n=.5*(e.pageX+t.x),r=.5*(e.pageY+t.y);this._panEnd.set(n,r)}this._panDelta.subVectors(this._panEnd,this._panStart).multiplyScalar(this.panSpeed),this._pan(this._panDelta.x,this._panDelta.y),this._panStart.copy(this._panEnd)}_handleTouchMoveDolly(e){let t=this._getSecondPointerPosition(e),n=e.pageX-t.x,r=e.pageY-t.y,i=Math.sqrt(n*n+r*r);this._dollyEnd.set(0,i),this._dollyDelta.set(0,(this._dollyEnd.y/this._dollyStart.y)**+this.zoomSpeed),this._dollyOut(this._dollyDelta.y),this._dollyStart.copy(this._dollyEnd);let a=(e.pageX+t.x)*.5,o=(e.pageY+t.y)*.5;this._updateZoomParameters(a,o)}_handleTouchMoveDollyPan(e){this.enableZoom&&this._handleTouchMoveDolly(e),this.enablePan&&this._handleTouchMovePan(e)}_handleTouchMoveDollyRotate(e){this.enableZoom&&this._handleTouchMoveDolly(e),this.enableRotate&&this._handleTouchMoveRotate(e)}_addPointer(e){this._pointers.push(e.pointerId)}_removePointer(e){delete this._pointerPositions[e.pointerId];for(let t=0;t<this._pointers.length;t++)if(this._pointers[t]==e.pointerId){this._pointers.splice(t,1);return}}_isTrackingPointer(e){for(let t=0;t<this._pointers.length;t++)if(this._pointers[t]==e.pointerId)return!0;return!1}_trackPointer(e){let t=this._pointerPositions[e.pointerId];t===void 0&&(t=new b,this._pointerPositions[e.pointerId]=t),t.set(e.pageX,e.pageY)}_getSecondPointerPosition(e){let t=e.pointerId===this._pointers[0]?this._pointers[1]:this._pointers[0];return this._pointerPositions[t]}_customWheelEvent(e){let t=e.deltaMode,n={clientX:e.clientX,clientY:e.clientY,deltaY:e.deltaY};switch(t){case 1:n.deltaY*=16;break;case 2:n.deltaY*=100}return e.ctrlKey&&!this._controlActive&&(n.deltaY*=10),n}};function Se(e){this.enabled!==!1&&(this._pointers.length===0&&(this.domElement.setPointerCapture(e.pointerId),this.domElement.ownerDocument.addEventListener(`pointermove`,this._onPointerMove),this.domElement.ownerDocument.addEventListener(`pointerup`,this._onPointerUp)),!this._isTrackingPointer(e)&&(this._addPointer(e),e.pointerType===`touch`?this._onTouchStart(e):this._onMouseDown(e),this._cursorStyle===`grab`&&(this.domElement.style.cursor=`grabbing`)))}function Ce(e){this.enabled!==!1&&(e.pointerType===`touch`?this._onTouchMove(e):this._onMouseMove(e))}function we(e){switch(this._removePointer(e),this._pointers.length){case 0:this.domElement.releasePointerCapture(e.pointerId),this.domElement.ownerDocument.removeEventListener(`pointermove`,this._onPointerMove),this.domElement.ownerDocument.removeEventListener(`pointerup`,this._onPointerUp),this.dispatchEvent(ge),this.state=w.NONE,this._cursorStyle===`grab`&&(this.domElement.style.cursor=`grab`);break;case 1:let t=this._pointers[0],n=this._pointerPositions[t];this._onTouchStart({pointerId:t,pageX:n.x,pageY:n.y})}}function Te(e){let t;switch(e.button){case 0:t=this.mouseButtons.LEFT;break;case 1:t=this.mouseButtons.MIDDLE;break;case 2:t=this.mouseButtons.RIGHT;break;default:t=-1}switch(t){case r.DOLLY:if(this.enableZoom===!1)return;this._handleMouseDownDolly(e),this.state=w.DOLLY;break;case r.ROTATE:if(e.ctrlKey||e.metaKey||e.shiftKey){if(this.enablePan===!1)return;this._handleMouseDownPan(e),this.state=w.PAN}else{if(this.enableRotate===!1)return;this._handleMouseDownRotate(e),this.state=w.ROTATE}break;case r.PAN:if(e.ctrlKey||e.metaKey||e.shiftKey){if(this.enableRotate===!1)return;this._handleMouseDownRotate(e),this.state=w.ROTATE}else{if(this.enablePan===!1)return;this._handleMouseDownPan(e),this.state=w.PAN}break;default:this.state=w.NONE}this.state!==w.NONE&&this.dispatchEvent(he)}function Ee(e){switch(this.state){case w.ROTATE:if(this.enableRotate===!1)return;this._handleMouseMoveRotate(e);break;case w.DOLLY:if(this.enableZoom===!1)return;this._handleMouseMoveDolly(e);break;case w.PAN:if(this.enablePan===!1)return;this._handleMouseMovePan(e)}}function De(e){this.enabled!==!1&&this.enableZoom!==!1&&this.state===w.NONE&&(e.preventDefault(),this.dispatchEvent(he),this._handleMouseWheel(this._customWheelEvent(e)),this.dispatchEvent(ge))}function Oe(e){this.enabled!==!1&&this._handleKeyDown(e)}function ke(e){switch(this._trackPointer(e),this._pointers.length){case 1:switch(this.touches.ONE){case m.ROTATE:if(this.enableRotate===!1)return;this._handleTouchStartRotate(e),this.state=w.TOUCH_ROTATE;break;case m.PAN:if(this.enablePan===!1)return;this._handleTouchStartPan(e),this.state=w.TOUCH_PAN;break;default:this.state=w.NONE}break;case 2:switch(this.touches.TWO){case m.DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchStartDollyPan(e),this.state=w.TOUCH_DOLLY_PAN;break;case m.DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchStartDollyRotate(e),this.state=w.TOUCH_DOLLY_ROTATE;break;default:this.state=w.NONE}break;default:this.state=w.NONE}this.state!==w.NONE&&this.dispatchEvent(he)}function Ae(e){switch(this._trackPointer(e),this.state){case w.TOUCH_ROTATE:if(this.enableRotate===!1)return;this._handleTouchMoveRotate(e),this.update();break;case w.TOUCH_PAN:if(this.enablePan===!1)return;this._handleTouchMovePan(e),this.update();break;case w.TOUCH_DOLLY_PAN:if(this.enableZoom===!1&&this.enablePan===!1)return;this._handleTouchMoveDollyPan(e),this.update();break;case w.TOUCH_DOLLY_ROTATE:if(this.enableZoom===!1&&this.enableRotate===!1)return;this._handleTouchMoveDollyRotate(e),this.update();break;default:this.state=w.NONE}}function je(e){this.enabled!==!1&&e.preventDefault()}function Me(e){e.key===`Control`&&(this._controlActive=!0,this.domElement.getRootNode().addEventListener(`keyup`,this._interceptControlUp,{passive:!0,capture:!0}))}function Ne(e){e.key===`Control`&&(this._controlActive=!1,this.domElement.getRootNode().removeEventListener(`keyup`,this._interceptControlUp,{passive:!0,capture:!0}))}var Pe=`
uniform sampler2D uFrame;     // the whole Metavido frame, v up
uniform mat4 uCamToWorld;     // recording camera -> clip world (three.js convention)
uniform vec4 uRay;            // centre shift xy, tan(fov/2)*16/9, tan(fov/2)
uniform vec2 uRange;          // depth range: near, far
uniform float uMaxDepth;      // drop samples further than this (metres)
uniform float uEdge;          // max surface slope, tan(angle to the view ray), before a sample is an edge
uniform float uCurve;         // max curvature of inverse depth before a sample is an edge
uniform int uEdgeMode;        // what to do with edge samples: 0 keep, 1 drop, 2 snap to a side

const float QW = 960.0;
const float QH = 540.0;

// mtvd_RGB2Hue + mtvd_DecodeDepth, keijiro/Metavido Common/Shaders/Common.hlsl
float mtvdHue(vec3 c) {
  float minc = min(min(c.r, c.g), c.b);
  float maxc = max(max(c.r, c.g), c.b);
  float div = 1.0 / (6.0 * max(maxc - minc, 1e-5));
  float r = (c.g - c.b) * div;
  float g = 1.0 / 3.0 + (c.b - c.r) * div;
  float b = 2.0 / 3.0 + (c.r - c.g) * div;
  float d = mix(r, mix(g, b, float(c.g < c.b)), float(c.r < max(c.g, c.b)));
  return fract(d + 1.0 - 0.005) + 0.005;
}

// q: pixel in the depth quadrant, x right, y up from the quadrant's bottom edge.
// Kept a few pixels off the seams with the colour half and the S/M quadrant,
// where compression bleeds one into the other (the Unity decoder's _Margin).
float mtvdDepth(ivec2 q) {
  q = clamp(q, ivec2(0, 3), ivec2(int(QW) - 4, int(QH) - 1));
  vec3 rgb = texelFetch(uFrame, ivec2(q.x, q.y + int(QH)), 0).rgb;
  float d = mtvdHue(rgb);
  d = (d - 0.01) / 0.98;   // margin
  d = (d - 0.01) / 0.98;   // padding
  return mix(uRange.x, uRange.y, d);
}

// Human stencil, with Demux.shader's compression noise filter.
float mtvdStencil(ivec2 q) {
  q = clamp(q, ivec2(0), ivec2(int(QW) - 4, int(QH) - 4));
  return clamp(texelFetch(uFrame, q, 0).r * 1.1 - 0.1, 0.0, 1.0);
}

// Colour at depth-quadrant uv. Linear filtering, kept off the left seam.
vec3 mtvdColor(vec2 uv) {
  return texture(uFrame, vec2(0.5 + 0.5 * max(uv.x, 1.5 / QW), uv.y)).rgb;
}

// Camera-space position (three.js: camera looks down -Z) for uv at depth z.
// mtvd_DistanceToWorldPosition, keijiro/Metavido Decoder/Shaders/Utils.hlsl.
vec3 mtvdCamPos(vec2 uv, float z) {
  return vec3(((uv - 0.5) * 2.0 + uRay.xy) * uRay.zw * z, -z);
}

struct MtvdSample {
  vec3 world;     // position in clip world
  vec3 tu, tv;    // world-space size of one grid cell along x and y, following the surface
  float z;        // depth (m)
  float stencil;  // 0..1, people
  float slope;    // tan of the angle between surface normal and view ray
  vec2 uv;
  bool edge;      // on a depth ramp (before uEdgeMode is applied)
  bool ok;
};

// Decode one sample.
//
// Edges. ARKit's depth is smooth across object boundaries. Around a person at
// 2 m in front of a wall at 6.5 m the depth ramps over 20-26 quadrant pixels
// (about six LiDAR cells), and the ramp bleeds 30-40 px out beyond the human
// stencil's silhouette. Reconstructed naively, that is a "rubber sheet" from
// every silhouette to the background.
//
// A sample is on a ramp when either
//   - the surface it implies is steeper than uEdge to the view ray, judged
//     over EDGE_PX pixels on its smoother side (so a sample right on a
//     silhouette, flat on one side, is not an edge), or
//   - inverse depth bends: over +-CURVE_PX it is not linear. Any plane — floor,
//     table, wall, at any angle — has inverse depth linear in image space, so
//     planes pass; the shoulders of a ramp, where it meets a plateau, do not.
//
// Dropping ramp samples (uEdgeMode 1) removes the sheets but leaves a dark
// halo as wide as the ramp. Snapping them (uEdgeMode 2) moves each one onto one
// side of the boundary instead. The human stencil is far sharper than the
// depth, so it decides where people are: a person sample takes the nearest
// person depth around it; a background sample next to a person takes the far
// plateau if it lies behind the person (wall), the near one if in front
// (table). Edges with no person involved go to whichever side the sample's own
// depth is closer to, which splits the ramp at its middle.
const int EDGE_PX = 4;
const int CURVE_PX = 12;
const vec2 SNAP_DIRS[8] = vec2[8](vec2(1.0, 0.0), vec2(0.7071, 0.7071), vec2(0.0, 1.0), vec2(-0.7071, 0.7071),
                                  vec2(-1.0, 0.0), vec2(-0.7071, -0.7071), vec2(0.0, -1.0), vec2(0.7071, -0.7071));
const float SNAP_R[4] = float[4](6.0, 14.0, 24.0, 36.0);
float mtvdSnap(ivec2 q, float z, float stencil) {
  float zmin = 1e9, zmax = -1e9, pmin = 1e9, bmin = 1e9, bmax = -1e9;
  bool nearPerson = false;
  for (int r = 0; r < 4; r++) {
    for (int d = 0; d < 8; d++) {
      ivec2 o = q + ivec2(round(SNAP_DIRS[d] * SNAP_R[r]));
      float zz = mtvdDepth(o);
      zmin = min(zmin, zz);
      zmax = max(zmax, zz);
      if (mtvdStencil(o) > 0.5) { pmin = min(pmin, zz); nearPerson = true; }
      else { bmin = min(bmin, zz); bmax = max(bmax, zz); }
    }
  }
  // A person sample is only moved if it sits clearly behind the person's
  // nearest depth around it (pulled back by the ramp), not for the few
  // centimetres a body curves away from the camera.
  if (stencil > 0.5) return z - pmin > 0.12 + 0.04 * z ? pmin : z;
  if (nearPerson) return z > pmin ? max(bmax, z) : min(bmin, z);
  return z - zmin < zmax - z ? zmin : zmax;
}

const int BOUNDARY_PX = 10;
MtvdSample mtvdSample(ivec2 q, float cell) {
  MtvdSample s;
  float z = mtvdDepth(q);
  float zl = mtvdDepth(q - ivec2(EDGE_PX, 0)), zr = mtvdDepth(q + ivec2(EDGE_PX, 0));
  float zd = mtvdDepth(q - ivec2(0, EDGE_PX)), zu = mtvdDepth(q + ivec2(0, EDGE_PX));
  // Slope on the smoother side, for the edge test.
  float ex = abs(zr - z) < abs(z - zl) ? zr - z : z - zl;
  float ey = abs(zu - z) < abs(z - zd) ? zu - z : z - zd;
  float span = 2.0 * uRay.w / QH * float(EDGE_PX) * z;   // lateral metres across EDGE_PX at depth z
  s.slope = max(abs(ex), abs(ey)) / span;
  s.stencil = mtvdStencil(q);
  float w = 1.0 / z, curv = 0.0;
  bool boundary = false;   // a stencil edge within BOUNDARY_PX
  bool person = s.stencil > 0.5;
  for (int a = 0; a < 4; a++) {
    ivec2 o = ivec2(round(SNAP_DIRS[a] * float(CURVE_PX)));
    curv = max(curv, abs(1.0 / mtvdDepth(q + o) + 1.0 / mtvdDepth(q - o) - 2.0 * w) / w);
    ivec2 b = ivec2(round(SNAP_DIRS[a] * float(BOUNDARY_PX)));
    boundary = boundary || (mtvdStencil(q + b) > 0.5) != person || (mtvdStencil(q - b) > 0.5) != person;
  }
  bool edge = s.slope >= uEdge || curv >= uCurve;
  s.edge = edge;
  // Geometry from central differences, and the depth itself lightly smoothed
  // (a 5-tap plus): the hue encoding quantises depth to ~6 mm, which shows as
  // shingles on oblique surfaces otherwise. Planes are unaffected, being
  // symmetric about the centre.
  float dx = (zr - zl) * 0.5, dy = (zu - zd) * 0.5;
  if (!edge) z = 0.5 * z + 0.125 * (zl + zr + zu + zd);
  // Person samples near their silhouette are checked even when they look
  // smooth: the ramp bleeds a few pixels into the stencil, and a gentle start
  // of it passes both tests. Background samples are only moved when on a ramp.
  if (uEdgeMode == 2 && (edge || (boundary && person))) {
    float zs = mtvdSnap(q, z, s.stencil);
    if (zs != z || edge) {
      z = zs;
      dx = 0.0;   // facing the camera: its real slope is unknown
      dy = 0.0;
    }
    edge = false;
  }
  s.ok = z > uRange.x + 0.05 && z < uMaxDepth && !(edge && uEdgeMode == 1);

  vec2 uv = (vec2(q) + 0.5) / vec2(QW, QH);
  vec3 c = mtvdCamPos(uv, z);
  // One grid cell (cell depth pixels) along x and y, sloped like the surface.
  float k = cell / float(EDGE_PX);
  vec3 cx = mtvdCamPos(uv + vec2(cell / QW, 0.0), z + dx * k) - c;
  vec3 cy = mtvdCamPos(uv + vec2(0.0, cell / QH), z + dy * k) - c;
  mat3 r = mat3(uCamToWorld);
  s.world = (uCamToWorld * vec4(c, 1.0)).xyz;
  s.tu = r * cx;
  s.tv = r * cy;
  s.z = z;
  s.uv = uv;
  return s;
}

// Cheap stable per-sample random number, for thinning.
float mtvdHash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}
`,Fe=class e{static async load(t,{fps:n}={}){let r=await fetch(t+`.json`);if(!r.ok)throw Error(`sidecar ${t}.json: HTTP ${r.status}`);let i=await r.json(),a=new e(i,t+`.mp4`);return await a.ready,a}constructor(e,t){this.side=e,this.fps=e.fps,this.frames=e.frames,this.duration=e.frames/e.fps,this.frame=0,this.serial=0,this.onFrame=null;let n=document.createElement(`video`);n.muted=!0,n.loop=!0,n.playsInline=!0,n.preload=`auto`,n.setAttribute(`playsinline`,``),n.src=t,this.video=n;let r=new h(n);if(r.colorSpace=``,r.minFilter=_,r.magFilter=_,r.generateMipmaps=!1,this.texture=r,this.camToWorld=new pe,this.uniforms={uFrame:{value:r},uCamToWorld:{value:this.camToWorld},uRay:{value:new re},uRange:{value:new b(.2,10)}},this._p=new y,this._q=new c,this._s=new y(1,1,1),this.setFrame(0),this.ready=new Promise((e,r)=>{n.addEventListener(`loadeddata`,()=>e(),{once:!0}),n.addEventListener(`error`,()=>r(Error(`video ${t}: ${n.error?.message||`failed to load`}`)),{once:!0})}),`requestVideoFrameCallback`in n){let e=(t,r)=>{this._present(Math.round(r.mediaTime*this.fps)),n.requestVideoFrameCallback(e)};n.requestVideoFrameCallback(e),this.hasFrameCallback=!0}else this.hasFrameCallback=!1}poll(){if(this.hasFrameCallback)return;let e=Math.floor(this.video.currentTime*this.fps+.25);e!==this.frame&&this._present(e)}_present(e){this.setFrame(e),this.serial++,this.onFrame?.(this.frame)}setFrame(e){let t=this.side;e=Math.min(Math.max(e,0),this.frames-1),this.frame=e,this.pose(e,this.camToWorld);let n=Math.tan(t.fov[e]/2);this.uniforms.uRay.value.set(t.shift[2*e],t.shift[2*e+1],n*16/9,n),this.uniforms.uRange.value.set(t.range[2*e],t.range[2*e+1])}pose(e,t=new pe){let n=this.side;return this._p.fromArray(n.p,3*e),this._q.fromArray(n.q,4*e),t.compose(this._p,this._q,this._s)}fovDeg(e){return i.radToDeg(this.side.fov[e])}seekFrame(e){e=Math.min(Math.max(e,0),this.frames-1),this.video.currentTime=(e+.5)/this.fps}dispose(){this.video.pause(),this.video.removeAttribute(`src`),this.video.load(),this.texture.dispose()}},T={OPAQUE:0,DEPTH:1,ACCUM:2},Ie=[`PASS_OPAQUE`,`PASS_DEPTH`,`PASS_ACCUM`],Le=`vec4(0.0, 0.0, -2.0, 1.0)`;function Re(){return{uMaxDepth:{value:8},uEdge:{value:8},uCurve:{value:.15},uEdgeMode:{value:2},uWhy:{value:0},uSize:{value:1},uSharp:{value:2.5},uProjScale:{value:500},uPeople:{value:new re(1,1,1,1)},uDepthBias:{value:.015},uOpacity:{value:1}}}var ze=`
in vec3 vColor;
in float vWeight;
#ifdef PRIM_SURFEL
in vec2 vCorner;
#else
in float vPx;
#endif
uniform float uSharp;
void main() {
#ifdef PRIM_SURFEL
  vec2 c = vCorner;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
#else
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  // A sprite of a pixel or two is a square anyway: cutting it round only
  // leaves holes between neighbours.
  if (r2 > 1.0 && vPx > 3.0) discard;
#endif
#if defined(PASS_ACCUM)
  float w = exp(-r2 * uSharp) * vWeight;
  gl_FragColor = vec4(vColor * w, w);
#elif defined(PASS_DEPTH)
  gl_FragColor = vec4(0.0);
#else
  gl_FragColor = vec4(vColor * vWeight, 1.0);
#endif
}
`;function Be(e,{vertexShader:t,uniforms:n,defines:r}){let i=new d({vertexShader:t,fragmentShader:ze,uniforms:n,defines:{...r,[Ie[e]]:``}});return e===T.DEPTH?i.colorWrite=!1:e===T.ACCUM&&(i.transparent=!0,i.depthWrite=!1,i.blending=5,i.blendEquation=100,i.blendSrc=i.blendSrcAlpha=201,i.blendDst=i.blendDstAlpha=201),i}var Ve=class{constructor(e,t,{writesDepth:n=!0}={}){this.object=e,this.materials=t,this.writesDepth=n,this.enabled=!0,e.frustumCulled=!1,e.matrixAutoUpdate=!1,e.geometry.boundingSphere=new oe(new y,1/0)}get uniforms(){return this.materials[0].uniforms}setPass(e){this.object.material=this.materials[e],this.object.visible=this.enabled&&(e!==T.DEPTH||this.writesDepth)}dispose(){this.object.geometry.dispose();for(let e of this.materials)e.dispose()}},He=`
${Pe}
uniform int uStep;
uniform int uGridW;
uniform float uSize;
uniform float uProjScale;
uniform vec4 uPeople;
uniform float uDepthBias;
uniform float uOpacity;
uniform int uWhy;   // debug: tint edge samples (snapped magenta / dropped red), people green
out vec3 vColor;
out float vWeight;
#ifdef PRIM_SURFEL
out vec2 vCorner;
#else
out float vPx;
#endif

void main() {
#ifdef PRIM_SURFEL
  int id = gl_InstanceID;
#else
  int id = gl_VertexID;
#endif
  ivec2 q = ivec2(id % uGridW, id / uGridW) * uStep + uStep / 2;
  MtvdSample s = mtvdSample(q, float(uStep));
  bool person = s.stencil > 0.5;
  bool ok = s.ok && mtvdHash(vec2(q)) < (person ? 1.0 : uPeople.z);
  float size = uSize * (person ? uPeople.w : 1.0);
  vColor = mtvdColor(s.uv) * (person ? uPeople.x : uPeople.y);
  vWeight = uOpacity;
  if (uWhy == 1) {
    if (s.edge) vColor = uEdgeMode == 2 ? vec3(1.0, 0.2, 1.0) : vec3(1.0, 0.1, 0.1);
    else if (person) vColor = mix(vColor, vec3(0.2, 1.0, 0.3), 0.5);
    if (s.edge && uEdgeMode == 1 && s.z < uMaxDepth) ok = true;   // show what would be dropped
  }
#ifdef PRIM_SURFEL
  vCorner = position.xy;
  vec4 mv = modelViewMatrix * vec4(s.world + (position.x * s.tu + position.y * s.tv) * 0.5 * size, 1.0);
#else
  vec4 mv = modelViewMatrix * vec4(s.world, 1.0);
  float footprint = float(uStep) * 2.0 * uRay.w / QH * s.z;   // metres covered by one grid cell
  gl_PointSize = clamp(size * footprint * uProjScale / max(-mv.z, 0.05), 1.0, 96.0);
  vPx = gl_PointSize;
#endif
#ifdef PASS_DEPTH
  mv.xyz += normalize(mv.xyz) * uDepthBias * -mv.z;
#endif
  gl_Position = ok ? projectionMatrix * mv : ${Le};
}
`,Ue=class extends Ve{constructor(e,{primitive:r=`points`,step:i=1}={}){let a=Math.floor(960/i),o=a*Math.floor(540/i),s={...e.uniforms,...Re(),uStep:{value:i},uGridW:{value:a}},c,l,u=r===`surfels`?{PRIM_SURFEL:``}:{},d=[T.OPAQUE,T.DEPTH,T.ACCUM].map(e=>Be(e,{vertexShader:He,uniforms:s,defines:u}));r===`surfels`?(c=new n,c.setAttribute(`position`,new f([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3)),c.setIndex([0,1,2,0,2,3]),c.instanceCount=o,l=new t(c,d[0])):(c=new x,c.setAttribute(`position`,new ae(new Uint8Array(o),1)),l=new ee(c,d[0])),super(l,d),this.clip=e,this.primitive=r,this.step=i,this.count=o}},We=`
${Pe}
uniform int uStep;
uniform int uWho;   // 0 room only, 1 people only, 2 everything
void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  ivec2 q = cell * uStep + uStep / 2;
  MtvdSample s = mtvdSample(q, float(uStep));
  bool person = s.stencil > 0.5;
  bool want = uWho == 2 || ((uWho == 1) == person);
  if (!s.ok || !want) { gl_FragColor = vec4(0.0); return; }
  vec3 c = floor(clamp(mtvdColor(s.uv), 0.0, 1.0) * 255.0 + 0.5);
  float packed = c.r * 65536.0 + c.g * 256.0 + c.b + 1.0;
  gl_FragColor = vec4(s.world, person ? -packed : packed);
}
`,Ge=`
uniform highp sampler2DArray uRing;
uniform int uGridW;
uniform int uGridH;
uniform vec4 uSlotWeight[MAX_SLOTS / 4];
uniform float uWorldSize;   // splat diameter in metres
uniform float uSize;
uniform float uFadeSize;    // 0: weight only fades colour, 1: also shrinks the splat
uniform float uProjScale;
uniform vec4 uPeople;
uniform float uDepthBias;
uniform float uOpacity;
uniform vec3 uTint;
out vec3 vColor;
out float vWeight;
out float vPx;

void main() {
  int per = uGridW * uGridH;
  int slot = gl_VertexID / per;
  int cell = gl_VertexID - slot * per;
  vec4 t = texelFetch(uRing, ivec3(cell % uGridW, cell / uGridW, slot), 0);
  float w = uSlotWeight[slot >> 2][slot & 3];
  if (t.w == 0.0 || w <= 0.0) { gl_Position = ${Le}; return; }
  float packed = abs(t.w) - 1.0;
  vec3 col = vec3(floor(packed / 65536.0), mod(floor(packed / 256.0), 256.0), mod(packed, 256.0)) / 255.0;
  bool person = t.w < 0.0;
  vColor = col * uTint * (person ? uPeople.x : uPeople.y);
  vWeight = w * uOpacity;
  vec4 mv = modelViewMatrix * vec4(t.xyz, 1.0);
  gl_PointSize = clamp(uSize * uWorldSize * mix(1.0, w, uFadeSize) * uProjScale / max(-mv.z, 0.05), 1.0, 64.0);
  vPx = gl_PointSize;
#ifdef PASS_DEPTH
  mv.xyz += normalize(mv.xyz) * uDepthBias * -mv.z;
#endif
  gl_Position = projectionMatrix * mv;
}
`,Ke=class extends Ve{constructor(e,{slots:n,step:r=4,who:i=`room`,writesDepth:a=!0}={}){let o=Math.ceil(n/4)*4,c=Math.floor(960/r),m=Math.floor(540/r),ne=new u(c,m,n,{type:fe,format:l,minFilter:s,magFilter:s,depthBuffer:!1,generateMipmaps:!1}),h={...Re(),uRing:{value:ne.texture},uGridW:{value:c},uGridH:{value:m},uSlotWeight:{value:Array.from({length:o/4},()=>new re)},uWorldSize:{value:.012*r/2},uFadeSize:{value:0},uTint:{value:new te(1,1,1)}},ie={MAX_SLOTS:o},_=[T.OPAQUE,T.DEPTH,T.ACCUM].map(e=>Be(e,{vertexShader:Ge,uniforms:h,defines:ie})),v=new x;v.setAttribute(`position`,new ae(new Uint8Array(c*m*n),1)),super(new ee(v,_[0]),_,{writesDepth:a}),this.clip=e,this.target=ne,this.slots=n,this.gw=c,this.gh=m,this.slotFrame=new Int32Array(n).fill(-1),this._capture=new t(new x().setAttribute(`position`,new f([-1,-1,0,3,-1,0,-1,3,0],3)),new d({vertexShader:`void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,fragmentShader:We,uniforms:{...e.uniforms,uMaxDepth:h.uMaxDepth,uEdge:h.uEdge,uCurve:h.uCurve,uEdgeMode:h.uEdgeMode,uStep:{value:r},uWho:{value:{room:0,people:1,all:2}[i]}},depthTest:!1,depthWrite:!1})),this._capture.frustumCulled=!1,this._captureScene=new g().add(this._capture),this._captureCam=new p}capture(e,t){let n=e.getRenderTarget();e.setRenderTarget(this.target,t),e.render(this._captureScene,this._captureCam),e.setRenderTarget(n),this.slotFrame[t]=this.clip.frame}weigh(e){let t=this.uniforms.uSlotWeight.value;for(let n=0;n<this.slots;n++){let r=this.slotFrame[n];t[n>>2].setComponent(n&3,r<0?0:Math.max(0,e(n,r)))}}clear(){this.slotFrame.fill(-1)}dispose(){super.dispose(),this.target.dispose(),this._capture.geometry.dispose(),this._capture.material.dispose()}},qe=class{constructor(){this.target=new ue(1,1,{type:de,format:l,minFilter:s,magFilter:s,depthBuffer:!0,generateMipmaps:!1}),this.resolveMaterial=new d({vertexShader:`out vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,fragmentShader:`
        uniform sampler2D uAcc;
        uniform float uCoverage;
        in vec2 vUv;
        void main() {
          vec4 a = texture(uAcc, vUv);
          if (a.a < 1e-4) discard;
          gl_FragColor = vec4(a.rgb / a.a, 1.0 - exp(-a.a * uCoverage));
        }`,uniforms:{uAcc:{value:this.target.texture},uCoverage:{value:3}},transparent:!0,depthTest:!1,depthWrite:!1});let e=new t(new x().setAttribute(`position`,new f([-1,-1,0,3,-1,0,-1,3,0],3)),this.resolveMaterial);e.frustumCulled=!1,this.scene=new g().add(e),this.camera=new p}setSize(e,t){this.target.setSize(e,t)}render(e,t,n,r){let i=e.getRenderTarget(),a=new te;e.getClearColor(a);let o=e.getClearAlpha();e.setRenderTarget(this.target),e.setClearColor(0,0),e.clear(!0,!0,!1);for(let e of r)e.setPass(T.DEPTH);e.render(t,n);for(let e of r)e.setPass(T.ACCUM);e.render(t,n),e.setRenderTarget(i),e.setClearColor(a,o),e.render(this.scene,this.camera)}dispose(){this.target.dispose(),this.resolveMaterial.dispose()}},Je=class{constructor(e){this.clip=e,this.target=new ue(1,1,{depthBuffer:!1}),this.material=new d({vertexShader:`void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,fragmentShader:`
        uniform sampler2D uFrame;
        void main() {
          uint acc = 0u;
          for (int i = 0; i < 32; i++) {
            int y = i * 8 + 4;
            float b = texelFetch(uFrame, ivec2(11 * 8 + 3, y), 0).b + texelFetch(uFrame, ivec2(11 * 8 + 5, y), 0).b;
            if (b > 0.4) acc |= 1u << uint(i);
          }
          gl_FragColor = vec4(float(acc & 255u), float((acc >> 8u) & 255u), float((acc >> 16u) & 255u), float(acc >> 24u)) / 255.0;
        }`,uniforms:{uFrame:e.uniforms.uFrame},depthTest:!1,depthWrite:!1});let n=new t(new x().setAttribute(`position`,new f([-1,-1,0,3,-1,0,-1,3,0],3)),this.material);n.frustumCulled=!1,this.scene=new g().add(n),this.camera=new p,this._px=new Uint8Array(4),this._f32=new Float32Array(1),this._u32=new Uint32Array(this._f32.buffer),this.stats={checked:0,exact:0,bitFlip:0,offByOne:0,miss:0,misses:[]}}check(e){let t=e.getRenderTarget();e.setRenderTarget(this.target),e.render(this.scene,this.camera),e.readRenderTargetPixels(this.target,0,0,1,1,this._px),e.setRenderTarget(t);let n=(this._px[0]|this._px[1]<<8|this._px[2]<<16|this._px[3]<<24)>>>0,r=this.clip.frame,i=this.clip.side.hash,a=e=>(this._f32[0]=i[e],this._u32[0]),o=(e,t)=>{let n=(e^t)>>>0,r=0;for(;n;)r+=n&1,n>>>=1;return r},s=this.stats;s.checked++;let c=o(n,a(r));return c===0?s.exact++:c<=2?s.bitFlip++:r>0&&o(n,a(r-1))<=2||r+1<i.length&&o(n,a(r+1))<=2?(s.offByOne++,s.misses.length<20&&s.misses.push({frame:r,kind:`off-by-one`})):(s.miss++,s.misses.length<20&&s.misses.push({frame:r,kind:`miss`})),s}colourCheck(e){let t=new ue(960,540,{depthBuffer:!1}),n=new d({vertexShader:`void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,fragmentShader:`uniform sampler2D uFrame; void main() { gl_FragColor = vec4(texelFetch(uFrame, ivec2(gl_FragCoord.xy) + ivec2(0, 540), 0).rgb, 1.0); }`,uniforms:{uFrame:this.clip.uniforms.uFrame},depthTest:!1}),r=this.scene.children[0],i=r.material;r.material=n;let a=e.getRenderTarget();e.setRenderTarget(t),e.render(this.scene,this.camera);let o=new Uint8Array(2073600);e.readRenderTargetPixels(t,0,0,960,540,o),e.setRenderTarget(a),r.material=i,n.dispose(),t.dispose(),this.lastQuadrant={w:960,h:540,frame:this.clip.frame,px:o};let s=0,c=0,ee=0,l=0,u=0;for(let e=20;e<520;e+=2)for(let t=20;t<940;t+=2){let n=(e*960+t)*4,r=o[n]/255,i=o[n+1]/255,a=o[n+2]/255,d=Math.max(r,i,a),f=Math.min(r,i,a);c+=d,ee+=f,l+=d*d,u+=f*f,s++}let f=c/s,p=ee/s;return{maxMean:f,maxSd:Math.sqrt(l/s-f*f),minMean:p,minSd:Math.sqrt(u/s-p*p)}}},E={clip:`../assets/video/moment2-16pro`,caption:`Workshop 1, moment 2 · iPhone 16 Pro`,fov:55,near:.03,far:60,startBack:1.6,startUp:.55,startAside:.35,focusDistance:2.5,maxDepth:9.5,edge:8,curve:.15,edgeModes:{snap:2,drop:1,keep:0},edgeLabels:{snap:`Kanter: skärpta`,drop:`Kanter: bortklippta`,keep:`Kanter: råa`},looks:{punkter:{primitive:`points`,step:1,size:1.4,splat:!1},mjuk:{primitive:`points`,step:2,size:2.3,sharp:2.2,splat:!0},ytor:{primitive:`surfels`,step:2,size:2,sharp:2,splat:!0}},depthBias:.02,people:{peopleGain:1.12,roomGain:.34,roomKeep:.32,peopleSize:1.15},memory:{every:10,step:4,gain:.62},trails:{every:2,slots:14,step:2,gain:.95}},D=e=>document.getElementById(e),O=D(`view`),k=matchMedia(`(pointer: coarse)`).matches||Math.min(innerWidth,innerHeight)<600,A=new URLSearchParams(location.search),j=(e,t)=>A.has(e)?A.get(e)!==`0`:t,M={look:E.looks[A.get(`look`)]?A.get(`look`):`punkter`,people:j(`people`,!1),memory:j(`memory`,!1),trails:j(`trails`,!1),camera:j(`camera`,!0),edges:E.edgeModes[A.get(`edges`)]===void 0?`snap`:A.get(`edges`),why:A.has(`why`),res:Math.max(1,+A.get(`res`)||(k?2:1)),debug:A.has(`debug`),follow:j(`follow`,!1)},N=new ie({canvas:O,antialias:!1,powerPreference:`high-performance`});N.setPixelRatio(Math.min(devicePixelRatio,k?1.5:2)),N.setClearColor(0,1),N.autoClear=!1;var P=new g,Ye=new g,F=new a(E.fov,1,E.near,E.far),I=new xe(F,O);I.enableDamping=!0,I.dampingFactor=.08,I.screenSpacePanning=!0,I.zoomSpeed=.9,I.minDistance=.15,I.maxDistance=25;var Xe=new qe,L,R,z,B,V,H=()=>[z,R,B].filter(Boolean);async function Ze(){if(!N.capabilities.isWebGL2)throw Error(`WebGL 2 saknas i den här webbläsaren.`);L=await Fe.load(E.clip),D(`caption`).textContent=E.caption,D(`scrub`).max=String(L.frames-1),Qe(),nt(),G(),K(),M.debug&&(V=new Je(L));let e=parseFloat(A.get(`t`));Number.isFinite(e)&&L.seekFrame(Math.round(e*L.fps)),A.get(`paused`)===`1`?Y(!1):await L.video.play().catch(()=>Y(!1)),pt(),D(`loading`).classList.add(`gone`),setTimeout(()=>D(`hint`).classList.add(`gone`),6e3),wt=performance.now()-Tt,requestAnimationFrame(Mt)}function Qe(){R?.dispose(),R&&P.remove(R.object);let e=E.looks[M.look];R=new Ue(L,{primitive:e.primitive,step:e.step*M.res}),P.add(R.object);let t=R.uniforms;t.uSize.value=e.size,t.uSharp.value=e.sharp??2.5,U(R)}function U(e){let t=e.uniforms;t.uMaxDepth.value=E.maxDepth,t.uEdge.value=E.edge,t.uCurve.value=E.curve,t.uEdgeMode.value=E.edgeModes[M.edges],t.uWhy.value=+!!M.why,t.uDepthBias.value=E.depthBias;let n=E.people;M.people?t.uPeople.value.set(n.peopleGain,n.roomGain,e===R?n.roomKeep:1,e===R?n.peopleSize:1):t.uPeople.value.set(1,1,1,1)}function $e(){let e=E.memory,t=k?e.every*2:e.every;z=new Ke(L,{slots:Math.ceil(L.frames/t),step:e.step*(k?1.5:1)|0,who:`room`}),z.every=t,z.uniforms.uOpacity.value=e.gain,z.uniforms.uSize.value=E.looks[M.look].splat?2:1,P.add(z.object),U(z)}function et(){let e=E.trails;B=new Ke(L,{slots:e.slots,step:e.step,who:`people`,writesDepth:!1}),B.every=e.every,B.uniforms.uOpacity.value=e.gain,B.uniforms.uFadeSize.value=.6,B.uniforms.uSize.value=E.looks[M.look].splat?2:1,P.add(B.object),U(B)}var W,tt;function nt(){let t=Math.tan(L.side.fov[0]/2)*.18,n=t*16/9,r=[[-n,-t],[n,-t],[n,t],[-n,t]],i=[];for(let[e,t]of r)i.push(0,0,0,e,t,-.18);for(let e=0;e<4;e++)i.push(...r[e],-.18,...r[(e+1)%4],-.18);i.push(-n*.4,t,-.18,0,t*1.5,-.18,0,t*1.5,-.18,n*.4,t,-.18);let a=new x().setAttribute(`position`,new f(i,3));W=new e(a,new v({color:16052972,transparent:!0,opacity:.4})),W.matrixAutoUpdate=!1,Ye.add(W);let s=new x().setAttribute(`position`,new f(L.side.p,3));tt=new o(s,new v({color:16052972,transparent:!0,opacity:.14})),Ye.add(tt)}var rt=new pe,it=new y,at=new c,ot=new y;function st(e){L.pose(e,rt).decompose(it,at,ot);let t=new y(0,0,-1).applyQuaternion(at),n=new y(0,1,0),r=new y().crossVectors(t,n).normalize();return{pos:it.clone(),quat:at.clone(),fwd:t,up:n,right:r}}function G(){let e=st(0),t=e.fwd.clone().setY(0).normalize();I.target.copy(e.pos).addScaledVector(e.fwd,E.focusDistance),F.position.copy(e.pos).addScaledVector(t,-E.startBack).addScaledVector(e.up,E.startUp).addScaledVector(e.right,E.startAside),F.fov=E.fov,F.updateProjectionMatrix(),I.update()}function ct(){let e=st(L.frame);F.position.copy(e.pos),F.quaternion.copy(e.quat),F.fov=L.fovDeg(L.frame),F.updateProjectionMatrix(),I.target.copy(e.pos).addScaledVector(e.fwd,E.focusDistance)}function K(){for(let e of document.querySelectorAll(`[data-look]`))e.setAttribute(`aria-checked`,String(e.dataset.look===M.look));for(let e of document.querySelectorAll(`[data-toggle]`))e.setAttribute(`aria-pressed`,String(M[e.dataset.toggle]));D(`follow`).setAttribute(`aria-pressed`,String(M.follow)),D(`edges`).textContent=E.edgeLabels[M.edges],I.enabled=!M.follow,M.follow&&ct(),M.memory&&!z&&$e(),!M.memory&&z&&(P.remove(z.object),z.dispose(),z=null),M.trails&&!B&&et(),!M.trails&&B&&(P.remove(B.object),B.dispose(),B=null);for(let e of H())U(e);let e=E.looks[M.look].splat;for(let t of[z,B])t&&(t.uniforms.uSize.value=e?2:1);W.visible=tt.visible=M.camera&&!M.follow,D(`debug`).hidden=!M.debug;let t=new URLSearchParams;M.look!==`punkter`&&t.set(`look`,M.look);for(let e of[`people`,`memory`,`trails`,`follow`])M[e]&&t.set(e,`1`);M.camera||t.set(`camera`,`0`),M.edges!==`snap`&&t.set(`edges`,M.edges),M.why&&t.set(`why`,``),A.has(`res`)&&t.set(`res`,String(M.res)),M.debug&&t.set(`debug`,``),history.replaceState(null,``,t.toString()?`?${t}`:location.pathname)}for(let e of document.querySelectorAll(`[data-look]`))e.addEventListener(`click`,()=>{M.look!==e.dataset.look&&(M.look=e.dataset.look,Qe(),K())});for(let e of document.querySelectorAll(`[data-toggle]`))e.addEventListener(`click`,()=>{M[e.dataset.toggle]=!M[e.dataset.toggle],K()});D(`edges`).addEventListener(`click`,()=>{let e=Object.keys(E.edgeModes);M.edges=e[(e.indexOf(M.edges)+1)%e.length],K()}),D(`follow`).addEventListener(`click`,lt),D(`reset`).addEventListener(`click`,()=>{M.follow=!1,K(),G()});function lt(){M.follow=!M.follow,M.follow||(F.fov=E.fov,F.updateProjectionMatrix()),K()}var ut=D(`play`),q=D(`scrub`),dt=D(`time`),J=!1,ft=!1;function Y(e){e?L.video.play().catch(()=>{}):L.video.pause()}function pt(){let e=L.video.paused;ut.textContent=e?`▶`:`❚❚`,ut.setAttribute(`aria-label`,e?`Spela`:`Pausa`)}ut.addEventListener(`click`,()=>Y(L.video.paused)),q.addEventListener(`pointerdown`,()=>{J=!0,ft=!L.video.paused,L.video.pause()}),q.addEventListener(`input`,()=>L.seekFrame(+q.value));var mt=()=>{J&&(J=!1,ft&&Y(!0))};q.addEventListener(`pointerup`,mt),q.addEventListener(`change`,mt);var ht=[1,.5,.25];D(`speed`).addEventListener(`click`,e=>{let t=(ht.indexOf(L.video.playbackRate)+1)%ht.length;L.video.playbackRate=ht[t],e.currentTarget.textContent=`${String(ht[t]).replace(`.`,`,`)}×`}),D(`loop`).addEventListener(`click`,e=>{L.video.loop=!L.video.loop,e.currentTarget.setAttribute(`aria-pressed`,String(L.video.loop)),L.video.loop&&L.video.ended&&Y(!0)}),addEventListener(`keydown`,e=>{e.target instanceof HTMLInputElement&&e.key!==` `||(e.key===` `?(e.preventDefault(),Y(L.video.paused)):e.key===`ArrowRight`||e.key===`ArrowLeft`?(e.preventDefault(),L.video.pause(),L.seekFrame(L.frame+(e.key===`ArrowRight`?1:-1)*(e.shiftKey?10:1))):e.key===`f`||e.key===`F`?lt():e.key===`c`||e.key===`C`?(M.camera=!M.camera,K()):(e.key===`r`||e.key===`R`)&&(M.follow=!1,K(),G()))});function gt(){let e=innerWidth,t=innerHeight;N.setSize(e,t,!1),F.aspect=e/t,F.updateProjectionMatrix();let n=N.getDrawingBufferSize(new b);Xe.setSize(n.x,n.y)}addEventListener(`resize`,gt);var _t=-1,vt=performance.now(),yt=0,bt=0,xt=0,St=0,Ct=0,wt=0,Tt=performance.now(),Et=D(`stats`),Dt=D(`debug`),Ot=!1;O.addEventListener(`webglcontextlost`,e=>{e.preventDefault(),Ot=!0;let t=D(`loading`);t.classList.remove(`gone`),t.classList.add(`error`),t.querySelector(`p`).textContent=`Grafikkortet tappade sammanhanget (WebGL). Ladda om sidan.`});var X=N.getContext(),Z=M.debug?X.getExtension(`EXT_disjoint_timer_query_webgl2`):null,Q=[],$=0;function kt(){if(!Z||Q.length>4)return null;let e=X.createQuery();return X.beginQuery(Z.TIME_ELAPSED_EXT,e),e}function At(e){e&&(X.endQuery(Z.TIME_ELAPSED_EXT),Q.push(e))}function jt(){for(;Q.length&&X.getQueryParameter(Q[0],X.QUERY_RESULT_AVAILABLE);){let e=Q.shift();if(!X.getParameter(Z.GPU_DISJOINT_EXT)){let t=X.getQueryParameter(e,X.QUERY_RESULT)/1e6;$=$?$*.9+t*.1:t}X.deleteQuery(e)}}function Mt(e){if(requestAnimationFrame(Mt),Ot)return;L.poll(),Z&&jt();let t=kt();O.width!==Math.floor(innerWidth*N.getPixelRatio())&&gt(),L.serial!==_t&&(_t=L.serial,xt++,Pt()),M.follow?ct():I.update(),F.updateMatrixWorld();let n=N.getDrawingBufferSize(Nt).y/(2*Math.tan(i.degToRad(F.fov)/2));for(let e of H())e.uniforms.uProjScale.value=n;if(N.setRenderTarget(null),N.clear(),E.looks[M.look].splat)Xe.render(N,P,F,H());else{for(let e of H())e.setPass(T.OPAQUE);N.render(P,F)}if(N.render(Ye,F),At(t),Ct||(X.finish(),Ct=performance.now()-Tt),J||(q.value=String(L.frame)),dt.textContent=`${It(L.frame/L.fps)} / ${It(L.duration)}`,pt(),yt++,e-vt>1e3){bt=yt*1e3/(e-vt),St=xt*1e3/(e-vt),vt=e,yt=0,xt=0;let t=H().reduce((e,t)=>e+(t.count??t.gw*t.gh*t.slots),0);Et.textContent=`${bt.toFixed(0)} fps · video ${St.toFixed(0)} fps · ${(t/1e6).toFixed(2)} M punkter`,M.debug&&Ft()}}var Nt=new b;function Pt(){let e=L.frame;if(W.matrix.copy(L.camToWorld),W.matrixWorldNeedsUpdate=!0,z){let t=Math.floor(e/z.every)%z.slots;z.slotFrame[t]<0&&z.capture(N,t),z.weigh((t,n)=>1-.45*Math.min(1,Math.abs(n-e)/L.frames*2))}if(B){let t=Math.floor(e/B.every)%B.slots;B.slotFrame[t]!==e&&(e%B.every===0||Math.abs(B.slotFrame[t]-e)>=B.every)&&B.capture(N,t);let n=B.slots*B.every;B.weigh((t,r)=>{let i=e-r;return i<=0||i>n?0:(1-i/(n+1))**1.6})}V&&e%5==0&&V.check(N)}function Ft(){let e=V?.stats,t=N.getContext(),n=t.getExtension(`WEBGL_debug_renderer_info`);Dt.textContent=[`frame ${L.frame}/${L.frames}  rVFC ${L.hasFrameCallback}`,Z?`GPU ${$.toFixed(2)} ms/frame`:`GPU timer unavailable`,e?`sync: ${e.exact}/${e.checked} exact, ${e.bitFlip} bit flips, ${e.offByOne} off by one, ${e.miss} miss`:``,n?t.getParameter(n.UNMASKED_RENDERER_WEBGL):``].join(`
`)}function It(e){let t=Math.floor(e/60);return`${t}:${(e-t*60).toFixed(1).padStart(4,`0`)}`}window.__mv={get clip(){return L},state:M,camera:F,controls:I,renderer:N,applyState:K,buildLive:Qe,startView:G,get probe(){return V},get fps(){return{fps:bt,vfps:St,gpuMs:$,readyMs:wt,firstFrameMs:Ct}},setView(e,t,n=E.fov){M.follow=!1,K(),F.position.fromArray(e),I.target.fromArray(t),F.fov=n,F.updateProjectionMatrix(),I.update()},recorderAxes:st},Ze().catch(e=>{console.error(e);let t=D(`loading`);t.classList.add(`error`),t.querySelector(`p`).textContent=`Kunde inte starta: ${e.message}`});