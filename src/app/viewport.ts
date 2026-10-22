/** Renderer, camera, controls, gizmo, frame loop, frame-time stats and WebGL context-loss handling. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

export class FrameStats {
  private buf = new Float64Array(240); private n = 0; private i = 0;
  push(ms: number) { this.buf[this.i] = ms; this.i = (this.i + 1) % this.buf.length; this.n = Math.min(this.n + 1, this.buf.length); }
  pct(p: number) { if (!this.n) return 0; const a = Array.from(this.buf.subarray(0, this.n)).sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; }
  reset() { this.n = 0; this.i = 0; }
  get count() { return this.n; }
}

export class Viewport {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  gizmo: TransformControls;
  cursor: THREE.Mesh;
  grid: THREE.LineSegments;
  needsRender = true;
  continuous = false;
  frameCpu = new FrameStats();
  frameInterval = new FrameStats();
  private lastFrameT = 0;
  contextLost = false;
  contextEvents: string[] = [];
  onFrame: () => void = () => {};
  onContext: (lost: boolean) => void = () => {};
  rendererInfo = '';
  /** Device-pixel budget for the drawing buffer; DPR is capped so w*h*dpr² stays under it (tablets have huge native panels). */
  quality: 'balanced' | 'sharp' | 'fast' = 'balanced';
  pixelRatio = 1;
  static BUDGET = { fast: 1.6e6, balanced: 3.2e6, sharp: 8.5e6 } as const;
  static effectiveDpr(cssW: number, cssH: number, dpr: number, budget: number) {
    const cap = Math.sqrt(budget / Math.max(1, cssW * cssH));
    return Math.max(1, Math.min(dpr, 3, cap));
  }

  constructor(public host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setClearColor(0x111214, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const cv = this.renderer.domElement; cv.id = 'viewport-canvas'; cv.setAttribute('aria-label', '3D sculpt viewport'); cv.tabIndex = 0;
    host.appendChild(cv);
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.rendererInfo = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.01, 500);
    this.camera.position.set(0.0, 1.1, 4.0);
    this.controls = new OrbitControls(this.camera, cv);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.18;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener('change', () => (this.needsRender = true));

    this.gizmo = new TransformControls(this.camera, cv);
    this.gizmo.setSize(0.8);
    this.gizmo.addEventListener('dragging-changed', (e: any) => { this.controls.enabled = !e.value; });
    this.gizmo.addEventListener('change', () => (this.needsRender = true));
    this.scene.add(this.gizmo.getHelper());

    // studio light rig for exported/standard materials (matcap ignores lights)
    this.scene.add(new THREE.HemisphereLight(0xdedad2, 0x1a1b1e, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-3, 4, 5); this.scene.add(key);

    // floor grid: hairline graphite, fades with distance via fog
    const gridHelper = new THREE.GridHelper(12, 24, 0x34373c, 0x222428);
    (gridHelper.material as THREE.Material).transparent = true; (gridHelper.material as THREE.LineBasicMaterial).opacity = 0.45;
    gridHelper.position.y = -1.25; this.grid = gridHelper; this.scene.add(gridHelper);
    this.scene.fog = new THREE.Fog(0x111214, 8, 22);

    // brush cursor: ring oriented to the surface
    const ring = new THREE.RingGeometry(0.96, 1, 64);
    this.cursor = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xe2a03f, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
    this.cursor.renderOrder = 999; this.cursor.visible = false; this.scene.add(this.cursor);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.03, 16), new THREE.MeshBasicMaterial({ color: 0xe2a03f, depthTest: false }));
    dot.renderOrder = 999; this.cursor.add(dot);

    cv.addEventListener('webglcontextlost', e => { e.preventDefault(); this.contextLost = true; this.contextEvents.push('lost@' + Math.round(performance.now())); this.onContext(true); });
    cv.addEventListener('webglcontextrestored', () => { this.contextLost = false; this.contextEvents.push('restored@' + Math.round(performance.now())); this.needsRender = true; this.onContext(false); });

    new ResizeObserver(() => this.resize()).observe(host);
    window.visualViewport?.addEventListener('resize', () => this.resize());
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener?.('change', () => this.resize());
    this.resize();
    const loop = (t: number) => {
      requestAnimationFrame(loop);
      if (this.lastFrameT) this.frameInterval.push(t - this.lastFrameT);
      this.lastFrameT = t;
      if (this.controls.update()) this.needsRender = true;
      this.onFrame();
      if ((this.needsRender || this.continuous) && !this.contextLost) {
        const c0 = performance.now();
        this.renderer.render(this.scene, this.camera);
        this.frameCpu.push(performance.now() - c0);
        this.needsRender = false;
      }
    };
    requestAnimationFrame(loop);
  }

  setQuality(q: 'balanced' | 'sharp' | 'fast') { this.quality = q; this.resize(); }
  resize() {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    const pr = Viewport.effectiveDpr(w, h, window.devicePixelRatio || 1, Viewport.BUDGET[this.quality]);
    if (pr !== this.pixelRatio || this.renderer.getPixelRatio() !== pr) { this.pixelRatio = pr; this.renderer.setPixelRatio(pr); }
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.needsRender = true;
  }

  ndc(clientX: number, clientY: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }
  /** World-space length of `px` screen pixels at distance `dist` from the camera. */
  pixelsToWorld(px: number, dist: number) {
    const h = this.renderer.domElement.getBoundingClientRect().height || 1;
    return (px * 2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / h;
  }
  frame(obj: THREE.Object3D | null) {
    const box = new THREE.Box3();
    if (obj) box.setFromObject(obj); if (box.isEmpty()) box.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    const s = box.getBoundingSphere(new THREE.Sphere());
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov) / 2, hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const dist = s.radius / Math.sin(Math.min(vHalf, hHalf)) * 1.15; // fit both width and height (portrait phones/tablets)
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(s.center); this.camera.position.copy(s.center).addScaledVector(dir, dist);
    this.camera.near = Math.max(0.001, dist / 1000); this.camera.far = dist * 100; this.camera.updateProjectionMatrix();
    this.grid.position.y = box.min.y - 0.02 * s.radius;
    this.controls.update(); this.needsRender = true;
  }
}
